use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "bmp", "ico",
];

#[derive(Debug, Serialize)]
struct ImageRead {
    path: String,
    bytes: Vec<u8>,
    mime: String,
}

#[tauri::command]
fn read_image(path: String) -> Result<ImageRead, String> {
    let p = Path::new(&path);
    let bytes = fs::read(p).map_err(|e| format_io_err(&path, e))?;
    let mime = mime_for(p);
    Ok(ImageRead {
        path: absolute_path(p),
        bytes,
        mime,
    })
}

#[derive(Debug, Serialize)]
struct Siblings {
    paths: Vec<String>,
    index: usize,
}

/// List all images in the parent dir of `path`, sorted case-insensitive
/// lexicographically. Hidden files (leading `.`) are excluded unless the
/// opened file itself is hidden. Returns the index of the opened file, or 0
/// if not found among siblings.
#[tauri::command]
fn list_siblings(path: String) -> Result<Siblings, String> {
    let p = Path::new(&path);
    let parent = p.parent().ok_or_else(|| format!("{path}: no parent dir"))?;
    let current_name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let include_hidden = current_name.starts_with('.');

    let mut entries: Vec<(String, String, String)> = Vec::new(); // (sort_key, name, full)
    let dir = fs::read_dir(parent).map_err(|e| format_io_err(&parent.to_string_lossy(), e))?;
    for entry in dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if name.starts_with('.') && !include_hidden {
            continue;
        }
        let ext_ok = Path::new(&name)
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() {
                continue;
            }
        }
        let full = entry.path().to_string_lossy().into_owned();
        entries.push((name.to_lowercase(), name, full));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let index = entries
        .iter()
        .position(|(_, name, _)| name == current_name)
        .unwrap_or(0);
    let paths: Vec<String> = entries.into_iter().map(|(_, _, full)| full).collect();
    Ok(Siblings { paths, index })
}

fn mime_for(p: &Path) -> String {
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct AppState {
    window: Option<WindowState>,
    recent: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

fn state_path() -> Option<PathBuf> {
    let base = dirs::state_dir().or_else(dirs::data_local_dir)?;
    Some(base.join("krill-image-viewer").join("state.json"))
}

#[tauri::command]
fn load_state() -> Option<AppState> {
    let p = state_path()?;
    let raw = fs::read_to_string(p).ok()?;
    serde_json::from_str(&raw).ok()
}

#[tauri::command]
fn save_state(state: AppState) -> Result<(), String> {
    let p = state_path().ok_or_else(|| "no state dir available".to_string())?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn dev_test_file() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    for name in ["test.png", "test.jpg", "test.webp"] {
        let path = Path::new(manifest).parent()?.join(name);
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

fn absolute_path(p: &Path) -> String {
    fs::canonicalize(p)
        .map(|abs| abs.to_string_lossy().into_owned())
        .unwrap_or_else(|_| p.to_string_lossy().into_owned())
}

fn format_io_err(path: &str, e: io::Error) -> String {
    format!("{path}: {e}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_image,
            list_siblings,
            load_state,
            save_state,
            dev_test_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
