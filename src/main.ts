import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { installMenuBar, type MenuDef } from "./menu";

interface ImageRead {
  path: string;
  bytes: number[] | Uint8Array;
  mime: string;
}

interface Siblings {
  paths: string[];
  index: number;
}

interface ViewState {
  paths: string[];
  index: number;
}

const view: ViewState = { paths: [], index: 0 };
let currentBlobUrl: string | null = null;

const img = document.getElementById("image") as HTMLImageElement;
const viewportEl = document.getElementById("viewport")!;
const titleEl = document.getElementById("titlebar-title")!;
const dimensionsEl = document.getElementById("status-dimensions")!;
const zoomLabelEl = document.getElementById("status-zoom")!;
const positionEl = document.getElementById("status-position")!;
const emptyState = document.getElementById("empty-state")!;
const errorState = document.getElementById("error-state")!;
const errorName = document.getElementById("error-name")!;

type ZoomMode = "fit" | "free";
const zoomState = { mode: "fit" as ZoomMode, factor: 1 };
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 32;

function fitFactor(): number {
  if (!img.naturalWidth || !img.naturalHeight) return 1;
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  return Math.min(vw / img.naturalWidth, vh / img.naturalHeight, 1);
}

function applyZoom() {
  if (!img.naturalWidth) return;
  if (zoomState.mode === "fit") zoomState.factor = fitFactor();
  const w = img.naturalWidth * zoomState.factor;
  const h = img.naturalHeight * zoomState.factor;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  updateZoomLabel();
  updatePannable();
}

function updatePannable() {
  const overflow =
    viewportEl.scrollWidth > viewportEl.clientWidth + 1 ||
    viewportEl.scrollHeight > viewportEl.clientHeight + 1;
  viewportEl.classList.toggle("pannable", overflow);
}

function updateZoomLabel() {
  const pct = Math.round(zoomState.factor * 100);
  zoomLabelEl.textContent = `${pct}%`;
}

function setMode(m: ZoomMode, factor?: number) {
  zoomState.mode = m;
  if (m === "free" && factor !== undefined) {
    zoomState.factor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
  }
  applyZoom();
}

function zoomBy(mult: number) {
  // Coming out of "fit" snaps to the current effective factor first.
  const base = zoomState.mode === "fit" ? fitFactor() : zoomState.factor;
  setMode("free", base * mult);
}

window.addEventListener("resize", () => {
  if (zoomState.mode === "fit") applyZoom();
  else updatePannable();
});

// ---- Click-drag pan (when overflow exists) ---------------------------------

let dragging = false;
let dragStartX = 0, dragStartY = 0, dragStartScrollX = 0, dragStartScrollY = 0;

viewportEl.addEventListener("pointerdown", (e) => {
  if (!viewportEl.classList.contains("pannable")) return;
  if (e.button !== 0 && e.button !== 1) return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartScrollX = viewportEl.scrollLeft;
  dragStartScrollY = viewportEl.scrollTop;
  viewportEl.setPointerCapture(e.pointerId);
  viewportEl.classList.add("panning");
  e.preventDefault();
});
viewportEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  viewportEl.scrollLeft = dragStartScrollX - (e.clientX - dragStartX);
  viewportEl.scrollTop = dragStartScrollY - (e.clientY - dragStartY);
});
const endDrag = (e: PointerEvent) => {
  if (!dragging) return;
  dragging = false;
  viewportEl.releasePointerCapture(e.pointerId);
  viewportEl.classList.remove("panning");
};
viewportEl.addEventListener("pointerup", endDrag);
viewportEl.addEventListener("pointercancel", endDrag);

// ---- Wheel-zoom centered on cursor -----------------------------------------

viewportEl.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (!img.naturalWidth) return;
  e.preventDefault();

  const rect = viewportEl.getBoundingClientRect();
  const cursorX = e.clientX - rect.left;
  const cursorY = e.clientY - rect.top;
  const oldFactor = zoomState.mode === "fit" ? fitFactor() : zoomState.factor;
  // Image-space coordinates under the cursor before zoom.
  const ix = (viewportEl.scrollLeft + cursorX) / oldFactor;
  const iy = (viewportEl.scrollTop  + cursorY) / oldFactor;

  const mult = Math.exp(-e.deltaY * 0.002);
  setMode("free", oldFactor * mult);

  // After applyZoom, scroll so (ix, iy) is at cursor position.
  viewportEl.scrollLeft = ix * zoomState.factor - cursorX;
  viewportEl.scrollTop  = iy * zoomState.factor - cursorY;
}, { passive: false });

type Display = "empty" | "image" | "error";
function setDisplay(state: Display) {
  document.body.dataset.state = state;
  emptyState.hidden = state !== "empty";
  errorState.hidden = state !== "error";
  if (state !== "image") {
    img.removeAttribute("src");
    img.style.width = "";
    img.style.height = "";
    titleEl.textContent = "";
    dimensionsEl.textContent = "";
    zoomLabelEl.textContent = "";
  }
}
setDisplay("empty");

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Read bytes for `path` and swap the displayed image. Returns the resolved
 *  absolute path on success, or null on failure. */
async function loadImage(path: string): Promise<string | null> {
  let res: ImageRead;
  try {
    res = await invoke<ImageRead>("read_image", { path });
  } catch (e) {
    console.error("read_image failed:", e);
    showError(path);
    return null;
  }

  const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const blob = new Blob([buf], { type: res.mime });
  const url = URL.createObjectURL(blob);
  const oldUrl = currentBlobUrl;
  currentBlobUrl = url;

  // Swap src and wait for the new image to actually decode before revoking
  // the old blob — otherwise revoking can fire a spurious 'error' on the
  // current src.
  const decoded = await new Promise<boolean>((resolve) => {
    const onLoad = () => { cleanup(); resolve(true); };
    const onError = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    img.src = url;
  });

  if (oldUrl) URL.revokeObjectURL(oldUrl);

  if (!decoded) {
    URL.revokeObjectURL(url);
    currentBlobUrl = null;
    showError(res.path);
    return null;
  }

  setDisplay("image");
  const name = basename(res.path);
  titleEl.textContent = name;
  dimensionsEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
  // Reset to fit on every load (per SPEC).
  setMode("fit");
  const title = `${name} — Image Viewer`;
  document.title = title;
  getCurrentWindow().setTitle(title).catch(() => {});
  return res.path;
}

function showError(path: string) {
  errorName.textContent = basename(path);
  setDisplay("error");
}

function updatePosition() {
  if (view.paths.length === 0) {
    positionEl.textContent = "";
    return;
  }
  positionEl.textContent = `${view.index + 1} / ${view.paths.length}`;
}

/** Open a fresh path: load it and rebuild the sibling list. */
async function openPath(path: string): Promise<void> {
  const ok = await loadImage(path);
  if (!ok) return;
  try {
    const sib = await invoke<Siblings>("list_siblings", { path });
    view.paths = sib.paths;
    view.index = sib.index;
  } catch (e) {
    console.warn("list_siblings failed:", e);
    view.paths = [path];
    view.index = 0;
  }
  updatePosition();
}

/** Navigate to a sibling index, wrapping at both ends. */
async function goTo(rawIndex: number): Promise<void> {
  if (view.paths.length === 0) return;
  const n = view.paths.length;
  const next = ((rawIndex % n) + n) % n;
  if (next === view.index && n === 1) return;
  const ok = await loadImage(view.paths[next]);
  if (!ok) return;
  view.index = next;
  updatePosition();
}

async function openViaDialog(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "bmp", "ico"] }],
  });
  if (typeof selected === "string") await openPath(selected);
}

function buildMenus(): MenuDef[] {
  return [
    {
      label: "File",
      items: [
        { label: "Open…", shortcut: "Ctrl+O", action: () => void openViaDialog() },
        { sep: true },
        { label: "Close window", shortcut: "Ctrl+W", action: () => void getCurrentWindow().close() },
        { label: "Quit",         shortcut: "Ctrl+Q", action: () => void getCurrentWindow().close() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Fit to window", shortcut: "Ctrl+0", action: () => setMode("fit") },
        { label: "Original size", shortcut: "Ctrl+1", action: () => setMode("free", 1) },
        { sep: true },
        { label: "Zoom in",       shortcut: "Ctrl+=", action: () => zoomBy(1.25) },
        { label: "Zoom out",      shortcut: "Ctrl+-", action: () => zoomBy(0.8) },
        { sep: true },
        { label: "Fullscreen",    shortcut: "F",      action: () => void toggleFullscreen() },
      ],
    },
  ];
}

async function toggleFullscreen(): Promise<void> {
  const w = getCurrentWindow();
  const isFs = await w.isFullscreen().catch(() => false);
  await w.setFullscreen(!isFs).catch(() => {});
  document.body.dataset.fullscreen = isFs ? "false" : "true";
  // Layout changed; refit on next frame.
  requestAnimationFrame(() => {
    if (zoomState.mode === "fit") applyZoom();
    else updatePannable();
  });
}

function installTitlebar() {
  const w = getCurrentWindow();
  const bind = (id: string, h: () => void | Promise<void>) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); void h(); });
  };
  bind("titlebar-min", () => w.minimize());
  bind("titlebar-max", async () => (await w.isMaximized()) ? w.unmaximize() : w.maximize());
  bind("titlebar-close", () => w.close());
  document.getElementById("titlebar-drag")?.addEventListener("dblclick", async () =>
    (await w.isMaximized()) ? w.unmaximize() : w.maximize(),
  );
}

function installKeybindings() {
  window.addEventListener("keydown", (e) => {
    if (isTextTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openViaDialog(); }
    else if (mod && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "w")) {
      e.preventDefault(); void getCurrentWindow().close();
    }
    else if (mod && e.key === "0") { e.preventDefault(); setMode("fit"); }
    else if (mod && e.key === "1") { e.preventDefault(); setMode("free", 1); }
    else if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomBy(1.25); }
    else if (mod && e.key === "-") { e.preventDefault(); zoomBy(0.8); }
    else if (!mod && (e.key === "f" || e.key === "F" || e.key === "F11")) {
      e.preventDefault(); void toggleFullscreen();
    }
    else if (!mod && e.key === "Escape" && document.body.dataset.fullscreen === "true") {
      e.preventDefault(); void toggleFullscreen();
    }
    else if (!mod && e.key === "ArrowLeft")  { e.preventDefault(); void goTo(view.index - 1); }
    else if (!mod && e.key === "ArrowRight") { e.preventDefault(); void goTo(view.index + 1); }
    else if (!mod && e.key === "Home")       { e.preventDefault(); void goTo(0); }
    else if (!mod && e.key === "End")        { e.preventDefault(); void goTo(view.paths.length - 1); }
  }, { capture: true });
}

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

async function installFileDrop() {
  const wv = getCurrentWebview();
  await wv.onDragDropEvent(async (e) => {
    if (e.payload.type === "drop") {
      const path = e.payload.paths[0];
      if (path) await openPath(path);
    }
  });
}

async function boot() {
  installTitlebar();
  const menuContainer = document.getElementById("menu-bar");
  if (menuContainer) installMenuBar(menuContainer, buildMenus());
  installKeybindings();
  await installFileDrop();

  let opened = false;
  try {
    const matches = await getMatches();
    const arg = matches.args.file?.value;
    if (typeof arg === "string" && arg.length > 0) {
      await openPath(arg);
      opened = true;
    }
  } catch { /* cli plugin unavailable */ }

  if (!opened && import.meta.env.DEV) {
    try {
      const dev = await invoke<string | null>("dev_test_file");
      if (dev) await openPath(dev);
    } catch { /* no test file */ }
  }
}

boot().catch((e) => console.error("boot failed:", e));
