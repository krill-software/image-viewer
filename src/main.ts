import "@krill-software/desktop-ui/styles";
import { mountChrome } from "@krill-software/desktop-ui";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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

let img: HTMLImageElement;
let viewportEl: HTMLElement;
let titleEl: HTMLElement;
let dimensionsEl: HTMLElement;
let zoomLabelEl: HTMLElement;
let positionEl: HTMLElement;
let emptyState: HTMLElement;
let errorState: HTMLElement;
let errorName: HTMLElement;

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

// ---- Click-drag pan + wheel zoom (wired in initChrome) ----------------

let dragging = false;
let dragStartX = 0, dragStartY = 0, dragStartScrollX = 0, dragStartScrollY = 0;

function installViewportInteractions() {
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

  viewportEl.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!img.naturalWidth) return;
    e.preventDefault();

    const rect = viewportEl.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const oldFactor = zoomState.mode === "fit" ? fitFactor() : zoomState.factor;
    const ix = (viewportEl.scrollLeft + cursorX) / oldFactor;
    const iy = (viewportEl.scrollTop  + cursorY) / oldFactor;

    const mult = Math.exp(-e.deltaY * 0.002);
    setMode("free", oldFactor * mult);

    viewportEl.scrollLeft = ix * zoomState.factor - cursorX;
    viewportEl.scrollTop  = iy * zoomState.factor - cursorY;
  }, { passive: false });
}

type Display = "empty" | "image" | "error";
function setDisplay(s: Display) {
  document.body.dataset.state = s;
  emptyState.hidden = s !== "empty";
  errorState.hidden = s !== "error";
  if (s !== "image") {
    img.removeAttribute("src");
    img.style.width = "";
    img.style.height = "";
    titleEl.textContent = "Image Viewer";
    dimensionsEl.textContent = "";
    zoomLabelEl.textContent = "";
  }
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function imageTypeLabel(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "JPEG", jpeg: "JPEG", png: "PNG", webp: "WebP",
    gif: "GIF", avif: "AVIF", svg: "SVG", bmp: "BMP", ico: "ICO",
  };
  return map[ext] ?? ext.toUpperCase();
}

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
  dimensionsEl.textContent = `${imageTypeLabel(res.path)} · ${img.naturalWidth} × ${img.naturalHeight}`;
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

// Canonical actions are passed inline to mountChrome via the `actions` map.

async function toggleFullscreen(): Promise<void> {
  const w = getCurrentWindow();
  const isFs = await w.isFullscreen().catch(() => false);
  await w.setFullscreen(!isFs).catch(() => {});
  document.body.dataset.fullscreen = isFs ? "false" : "true";
  requestAnimationFrame(() => {
    if (zoomState.mode === "fit") applyZoom();
    else updatePannable();
  });
}

// Esc out of fullscreen — the only app-specific keybinding the package
// can't cover via the action registry.
function installFullscreenEscape() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.dataset.fullscreen === "true") {
      e.preventDefault();
      void toggleFullscreen();
    }
  }, { capture: true });
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

function initChrome() {
  const chrome = mountChrome({
    productName: "Image Viewer",
    actions: {
      "open":        openViaDialog,
      "fullscreen":  toggleFullscreen,
      "zoom-in":     () => zoomBy(1.25),
      "zoom-out":    () => zoomBy(0.8),
      "zoom-fit":    () => setMode("fit"),
      "zoom-actual": () => setMode("free", 1),
      "previous":    () => goTo(view.index - 1),
      "next":        () => goTo(view.index + 1),
      "first":       () => goTo(0),
      "last":        () => goTo(view.paths.length - 1),
    },
    showStatusLine: true,
  });
  titleEl = chrome.title;
  viewportEl = chrome.viewport;

  // Image + empty/error states inside the viewport.
  img = document.createElement("img");
  img.id = "image";
  img.alt = "";
  viewportEl.appendChild(img);

  emptyState = document.createElement("div");
  emptyState.id = "empty-state";
  emptyState.innerHTML = `
    <p>No image open.</p>
    <p class="hint">Drop a file here, or press <kbd>Ctrl</kbd>+<kbd>O</kbd>.</p>
  `;
  viewportEl.appendChild(emptyState);

  errorState = document.createElement("div");
  errorState.id = "error-state";
  errorState.hidden = true;
  errorState.innerHTML = `
    <p>Can't display this format.</p>
    <p class="hint" id="error-name"></p>
  `;
  viewportEl.appendChild(errorState);
  errorName = errorState.querySelector("#error-name") as HTMLElement;

  // Status line halves:
  //   LEFT  (file identity) — "JPEG · 1456×5678"
  //   RIGHT (state)         — "100% · 7 / 142"
  dimensionsEl = document.createElement("span");
  dimensionsEl.classList.add("mono");
  chrome.statusInfo!.appendChild(dimensionsEl);

  zoomLabelEl = document.createElement("span");
  zoomLabelEl.classList.add("mono");
  chrome.statusState!.appendChild(zoomLabelEl);

  positionEl = document.createElement("span");
  positionEl.classList.add("mono");
  chrome.statusState!.appendChild(positionEl);

  installViewportInteractions();
  document.body.dataset.state = "empty";
  setDisplay("empty");
}

async function boot() {
  initChrome();
  installFullscreenEscape();
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
