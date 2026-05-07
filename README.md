# Image Viewer

A minimal, single-window image viewer for Linux. Open one image, see it. Step through siblings in the same folder. Zoom, pan, fullscreen.

Built on Tauri 2 (Rust + system webview) with a TypeScript frontend. The webview decodes everything; Rust does only file I/O and folder enumeration. See [SPEC.md](SPEC.md) for the design rationale.

## Features

- **Open** — drag-drop, CLI arg, `Ctrl+O`. Formats: PNG, JPEG, WebP, GIF, AVIF, SVG, BMP, ICO.
- **Folder navigation** — `←` / `→` step through siblings in the current folder; `Home` / `End` jump to ends; wrap-around at both boundaries.
- **Zoom** — Fit-to-window (`Ctrl+0`, default on every load), Original size 1:1 (`Ctrl+1`), incremental zoom (`Ctrl+=` / `Ctrl+-`), wheel-zoom centered on the cursor (`Ctrl+wheel`).
- **Pan** — click-drag when zoomed past fit. Subtle scrollbars also work.
- **Fullscreen** — `F` or `F11`, `Esc` to exit. Hides titlebar and status line.
- **Sanitized rendering** — webview-native decoding only. No JS in image content (it's just bytes).

## Keybindings

| Action                     | Key                  |
|----------------------------|----------------------|
| Open                       | `Ctrl+O`             |
| Previous / next image      | `←` / `→`            |
| First / last image         | `Home` / `End`       |
| Fit to window              | `Ctrl+0`             |
| Original size (100%)       | `Ctrl+1`             |
| Zoom in / out              | `Ctrl+=` / `Ctrl+-`  |
| Wheel zoom (centered)      | `Ctrl+scroll`        |
| Pan (when zoomed)          | click-drag           |
| Fullscreen                 | `F` or `F11`         |
| Exit fullscreen            | `Esc`                |
| Close window               | `Ctrl+W`             |
| Quit                       | `Ctrl+Q`             |

## Install

Pre-built artifacts are produced under `release/v<version>/`:

- **`.deb`** — `sudo dpkg -i Image\ Viewer_*_amd64.deb`. Registers the app with the desktop environment so it appears in "Open with…" menus and can be set as the default for image files.
- **AppImage** — portable single-file binary. `chmod +x Image\ Viewer_*.AppImage && ./Image\ Viewer_*.AppImage`.

Verify with `sha256sum -c SHA256SUMS`.

## Run from CLI

```sh
fippli-image-viewer path/to/photo.jpg
```

Without an arg, the app starts empty — drag-drop or `Ctrl+O` to load.

## Build from source

Requires Rust 1.77+, Node 20+, pnpm, and Tauri 2's Linux build deps.

```sh
pnpm install
pnpm tauri dev      # development with hot reload
pnpm tauri build    # release artifacts in src-tauri/target/release/bundle/
```

## Releasing

Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (all three must match), then:

```sh
pnpm release
```

This runs `tauri build` and gathers AppImage + .deb under `release/v<version>/` with SHA256 checksums. Tag and push to trigger the GitHub Release workflow.

## License

MIT.
