use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use krill_desktop_core::{fs as kfs, state as kstate, dev as kdev};

const SLUG: &str = "krill-image-viewer";

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
    let bytes = kfs::read_bytes(p)?;
    Ok(ImageRead {
        path: kfs::absolute_path(p),
        bytes,
        mime: mime_for(p),
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
    let dir = fs::read_dir(parent)
        .map_err(|e| kfs::format_io_err(&parent.to_string_lossy(), e))?;
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
    window: Option<kstate::WindowGeometry>,
    recent: Option<Vec<String>>,
}

#[tauri::command]
fn load_state() -> Option<AppState> {
    kstate::load(SLUG, "state.json")
}

#[tauri::command]
fn save_state(state: AppState) -> Result<(), String> {
    kstate::save(SLUG, "state.json", &state)
}

#[tauri::command]
fn dev_test_file() -> Option<String> {
    kdev::test_file(
        env!("CARGO_MANIFEST_DIR"),
        &["test.png", "test.jpg", "test.webp"],
    )
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
