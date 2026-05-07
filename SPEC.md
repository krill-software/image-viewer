# Image Viewer — Spec (v1)

A minimal, single-window Linux image viewer. Open one image, see it. Step through siblings in the same folder. Zoom, pan, fullscreen. **The product is the calm** — the bar is `eog` / `qView` minus the settings panel, not a Lightroom-shaped library tool.

## Naming (this app)

| Where        | Value                                  |
|--------------|----------------------------------------|
| Slug         | `image-viewer`                         |
| Binary       | `fippli-image-viewer`                  |
| Cargo lib    | `fippli_image_viewer_lib`              |
| productName  | `Image Viewer`                         |
| Identifier   | `com.fippli.image-viewer`              |
| Directory    | `linux-apps/image-viewer/`             |
| Repo         | `fippli/image-viewer`                  |
| State dir    | `$XDG_STATE_HOME/fippli-image-viewer/` |

Convention lives in [STYLE.md](../STYLE.md) → Naming.

## Goals

- Open a single image instantly. Cold launch to first pixel under ~150 ms on a typical Linux laptop.
- Browse the rest of the folder with the arrow keys, the way every Linux user already expects.
- Render the image truthfully — fit-to-window by default, 100% on demand, smooth zoom and pan in between.
- Feel like a native Linux desktop app (`.desktop` entry, file associations, XDG dirs).

## Non-goals (v1)

- No editing. Not even rotate-and-save. (Use `fippli-image` for that.)
- No thumbnails strip, no folder grid, no library, no tags, no ratings.
- No EXIF panel, no metadata inspector, no histogram.
- No slideshow timer, no transitions.
- No multi-window comparison view, no split view.
- No RAW, HEIC, TIFF, PSD, or animated formats beyond what the webview natively renders (animated GIF/WebP/AVIF play; we don't expose frame controls).
- No settings panel, no preferences, no theme switcher.
- No plugin system, no cloud, no telemetry.
- No Windows/macOS builds.

## Stack

- **Shell:** Tauri 2 (Rust backend + system webview). Mirrors image-editor.
- **Frontend:** TypeScript + Vite.
- **Rendering:** plain `<img>` element inside a zoom/pan container. Webview decodes everything; we don't touch pixels.
- **Folder enumeration:** Rust — given the opened path, `read_dir` the parent, filter by extension, sort case-insensitive lexicographically. Returns the list and the index of the current file.

Rationale: the webview is already a world-class image renderer. The only thing Rust does is file I/O and folder listing. This is the smallest fippli app by far, and it should stay that way.

## Architecture

```
[CLI arg / drag-drop / Open dialog]
        │
        ▼
  Rust: resolve path, list siblings  ──►  [path, neighbors[], index]
        │
        ▼
  Frontend: <img src="asset://...">  ──►  zoom/pan transform on a wrapper div
        │
        ▼
  Arrow keys  ──►  index ± 1  ──►  swap <img src>
```

- **No buffering / preloading in v1.** The webview's image cache is enough. If next/prev feels laggy on big folders, add a 1-ahead/1-behind preload in v2.
- **No decoding fallbacks.** If the webview can't render the file (e.g. someone passes a TIFF), show a centered "Can't display this format" message with the filename. Don't try to convert.

## Features (v1)

### File I/O
- **Open:** drag-drop onto window, CLI arg (`fippli-image-viewer photo.jpg`), `Ctrl+O` dialog.
- **Recent files:** last 10, persisted in XDG state, reachable via `Ctrl+R` or a small recents submenu in the titlebar menu.
- **No save, no export.** Read-only viewer.

### Navigation within a folder
- Arrow keys (`←` / `→`) step to the previous / next image in the current folder, sorted case-insensitive by filename.
- `Home` / `End` jump to first / last.
- Wrap-around at both ends (going past the last image returns to the first).
- Opening a new file from outside the current folder rebuilds the sibling list and resets the index.

### Viewport
- **Fit-to-window** is the default on every image load. The image scales down to fit; small images are *not* scaled up past 100%.
- **Zoom:** `Ctrl+=` / `Ctrl+-`, mouse-wheel with `Ctrl`, pinch on touchpads. `Ctrl+0` returns to fit, `Ctrl+1` snaps to 100%.
- **Pan:** click-drag when zoomed past fit. Cursor changes to a hand. Space-drag also pans (matches image-editor muscle memory).
- **Smooth zoom centers on the cursor**, not the image center.

### Fullscreen
- `F` or `F11` enters chrome-free fullscreen: no titlebar, no menu, just the image on the window's background color, fit-to-window. `Esc` or the same key returns.
- Arrow keys still navigate while fullscreen.

### Animated images
- Animated GIF / APNG / animated WebP / animated AVIF play on loop automatically. No play/pause/scrub controls in v1 — that's a different app.

### What the titlebar shows
- Left of center: filename.
- Right of center, smaller: `current / total` (e.g. `7 / 142`) for the folder, plus zoom % when not at fit.
- Standard min/max/close on the right.

## UX principles

1. **One window, one image.** Opening a second file from the OS launches a second window/process.
2. **No chrome on the working surface.** No rail, no toolbar, no status bar at the bottom. The titlebar carries everything.
3. **Keyboard-first, mouse-honest.** Every action has a key; pan and zoom also work naturally with the mouse and touchpad.
4. **No modal dialogs.** Open is the only OS dialog.
5. **Fit-to-window always wins on load.** The user starts every image from the same baseline.

## Window chrome

- Custom titlebar (matches image-editor: drag region + min/max/close, inline menu).
- Window background: palette `--surface-2` (the locked palette — see STYLE.md). Letterboxing on fit shows this color, not pure black.
- No status line.

## Keybindings (v1)

| Action | Key |
|---|---|
| Open | `Ctrl+O` |
| Recent files | `Ctrl+R` |
| Previous / next image | `←` / `→` |
| First / last image | `Home` / `End` |
| Zoom in / out | `Ctrl+=` / `Ctrl+-` |
| Fit to window | `Ctrl+0` |
| Actual size (100%) | `Ctrl+1` |
| Pan (when zoomed) | drag, or space-drag |
| Fullscreen | `F` or `F11` |
| Close window | `Ctrl+W` |
| Quit | `Ctrl+Q` |

## File handling

- **Formats in:** PNG, JPEG, WebP, GIF, AVIF, SVG, BMP, ICO. Whatever the system webview renders.
- **Sort order:** case-insensitive lexicographic on filename within the parent directory. Hidden files (leading `.`) excluded unless the opened file itself is hidden.
- **External changes:** not watched in v1.
- **Symlinks:** followed.

## Linux integration

- Binary name: `fippli-image-viewer` (TBC).
- `.desktop` file with MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`, `image/svg+xml`, `image/bmp`, `image/x-icon`.
- Registered as a candidate handler, not the default — users opt in via "Open with…".
- Config: `$XDG_CONFIG_HOME/fippli-image-viewer/config.toml` (empty in v1).
- State: `$XDG_STATE_HOME/fippli-image-viewer/` — window geometry, recent files.
- Distribution: AppImage primary; `.deb` secondary.

## Out of scope / open questions

- Preloading neighbors for instant `←`/`→` — defer to v2 if the naive version feels snappy.
- EXIF orientation — the webview honors it on JPEG via the `image-orientation` CSS default in modern engines; verify in M1 and add a manual fallback only if a sample phone photo lands sideways.
- Wrap-around vs hard stop at folder ends — drafted as wrap; revisit if it feels disorienting.
- A "reveal in file manager" action — tempting, low-cost, but adds a dependency on `xdg-open`. Defer.

## Milestones

1. **M1 — Skeleton + display:** Tauri app launches, opens an image via CLI arg / drag-drop / `Ctrl+O`, shows it fit-to-window in the custom-titlebar shell. No navigation yet.
2. **M2 — Folder navigation:** sibling enumeration in Rust, arrow-key prev/next, `Home`/`End`, titlebar position indicator, wrap-around.
3. **M3 — Zoom & pan:** `Ctrl+=` / `Ctrl+-` / `Ctrl+0` / `Ctrl+1`, wheel-zoom centered on cursor, click-drag pan, space-drag pan, zoom % in titlebar.
4. **M4 — Fullscreen + recents:** `F` / `F11` chrome-free mode, recent-files list in XDG state, `Ctrl+R` menu.
5. **M5 — Packaging:** `.desktop`, MIME associations, AppImage + `.deb`, GitHub Actions release workflow, landing page. Mirror image-editor's `scripts/publish.sh`.
