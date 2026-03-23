const state = {
  docs: [],
  selectedDocId: null,
  workspaceFiles: [],
  downloadsByDoc: {},
  mergeSelection: new Set(),
  analysisByDoc: {},
  windowSeed: 1,
  zSeed: 20,
  viewerRevision: Date.now(),
  viewerZoom: 1,
  viewerRotation: 0,
  viewerPage: 1,
  activeToolPanel: "pages",
  loginPollTimer: null,
  account: null,
  layout: {
    leftCollapsed: false,
    rightCollapsed: false,
    leftWidth: 268,
    rightWidth: 320
  },
  paneResize: null,
  models: [],
  defaultModel: null,
  windowInteraction: null,
  pdfViewerTaskId: 0,
  pdfViewerBusy: false,
  pdfViewerPending: false,
  pdfViewerRenderTimer: null,
  placement: null,
  signatureAppearanceMode: "draw",
  signaturePad: {
    drawing: false,
    pointerId: null,
    lastPoint: null,
    hasInk: false
  },
  placementPdf: {
    module: null,
    docId: null,
    revision: null,
    pdfDoc: null
  }
};

const el = {
  accountStatus: document.getElementById("account-status"),
  loginBtn: document.getElementById("login-btn"),
  uploadForm: document.getElementById("upload-form"),
  pdfFileInput: document.getElementById("pdf-file"),
  leftPane: document.getElementById("left-pane"),
  rightPane: document.getElementById("right-pane"),
  leftPaneToggle: document.getElementById("left-pane-toggle"),
  rightPaneToggle: document.getElementById("right-pane-toggle"),
  leftPaneEdgeToggle: document.getElementById("left-pane-edge-toggle"),
  rightPaneEdgeToggle: document.getElementById("right-pane-edge-toggle"),
  leftPaneResizer: document.getElementById("left-pane-resizer"),
  rightPaneResizer: document.getElementById("right-pane-resizer"),
  docList: document.getElementById("doc-list"),
  mergeBtn: document.getElementById("merge-btn"),
  editModule: document.getElementById("edit-module"),
  selectedDocMeta: document.getElementById("selected-doc-meta"),
  downloadViewer: document.getElementById("download-viewer"),
  zoomOutBtn: document.getElementById("zoom-out-btn"),
  zoomFitBtn: document.getElementById("zoom-fit-btn"),
  zoomInBtn: document.getElementById("zoom-in-btn"),
  zoomLevel: document.getElementById("zoom-level"),
  pagePrevBtn: document.getElementById("page-prev-btn"),
  pageReadout: document.getElementById("page-readout"),
  pageJumpForm: document.getElementById("page-jump-form"),
  pageJumpInput: document.getElementById("page-jump-input"),
  pageNextBtn: document.getElementById("page-next-btn"),
  undoBtn: document.getElementById("undo-btn"),
  redoBtn: document.getElementById("redo-btn"),
  rotateViewLeft: document.getElementById("rotate-view-left"),
  rotateViewRight: document.getElementById("rotate-view-right"),
  rotateForm: document.getElementById("rotate-form"),
  deletePagesForm: document.getElementById("delete-pages-form"),
  extractPagesForm: document.getElementById("extract-pages-form"),
  formsForm: document.getElementById("fill-form-fields-form"),
  formsSummary: document.getElementById("form-fields-summary"),
  formsFields: document.getElementById("form-fields-list"),
  formsSubmit: document.getElementById("fill-form-fields-submit"),
  addTextForm: document.getElementById("add-text-form"),
  highlightForm: document.getElementById("highlight-form"),
  signatureForm: document.getElementById("signature-form"),
  placementPageInputs: [...document.querySelectorAll('#add-text-form [name="page"], #highlight-form [name="page"], #signature-form [name="page"]')],
  signatureAppearanceInputs: [...document.querySelectorAll('#signature-form [name="appearanceMode"]')],
  signatureTypeSection: document.getElementById("signature-type-section"),
  signatureDrawSection: document.getElementById("signature-draw-section"),
  signatureModeNote: document.getElementById("signature-mode-note"),
  signatureAppearanceText: document.getElementById("signature-appearance-text"),
  signaturePreviewNote: document.getElementById("signature-preview-note"),
  signaturePad: document.getElementById("signature-pad"),
  clearSignature: document.getElementById("clear-signature"),
  signatureStartBtn: document.getElementById("signature-start-btn"),
  signatureSummary: document.getElementById("signature-summary"),
  extractTextForm: document.getElementById("extract-text-form"),
  extractPagesInput: document.getElementById("extract-pages"),
  extractedText: document.getElementById("extracted-text"),
  workspaceFiles: document.getElementById("workspace-files"),
  canvas: document.querySelector(".canvas"),
  canvasDocTitle: document.getElementById("canvas-doc-title"),
  canvasDocMeta: document.getElementById("canvas-doc-meta"),
  pdfScroll: document.getElementById("pdf-scroll"),
  pdfViewer: document.getElementById("pdf-viewer"),
  pdfStage: document.getElementById("pdf-stage"),
  placementCanvasHost: document.getElementById("placement-canvas-host"),
  placementCanvas: document.getElementById("placement-canvas"),
  pdfEmpty: document.getElementById("pdf-empty"),
  placementLayer: document.getElementById("placement-layer"),
  placementPageFrame: document.getElementById("placement-page-frame"),
  placementPreviewBox: document.getElementById("placement-preview-box"),
  placementHint: document.getElementById("placement-hint"),
  cancelPlacement: document.getElementById("cancel-placement"),
  analysisWindows: document.getElementById("analysis-windows"),
  newAnalysisWindow: document.getElementById("new-analysis-window"),
  workspaceGrid: document.getElementById("workspace-grid"),
  toast: document.getElementById("toast"),
  toolRibbonButtons: [...document.querySelectorAll("[data-tool-panel-target]")],
  toolPanels: [...document.querySelectorAll("[data-tool-panel-id]")]
};

const MIN_LEFT_PANE = 216;
const MAX_LEFT_PANE = 420;
const MIN_RIGHT_PANE = 260;
const MAX_RIGHT_PANE = 520;
const MIN_VIEWER_ZOOM = 0.6;
const MAX_VIEWER_ZOOM = 2.4;
const DRAWN_SIGNATURE_PDF_WIDTH = 220;
const DRAWN_SIGNATURE_PDF_HEIGHT = 72;
const TYPED_SIGNATURE_MIN_WIDTH = 180;
const TYPED_SIGNATURE_MAX_WIDTH = 320;
const TYPED_SIGNATURE_HEIGHT = 72;
const TYPED_SIGNATURE_FONT_STACK = '"Snell Roundhand", "Brush Script MT", "Apple Chancery", "Segoe Script", cursive';

function selectedDoc() {
  return state.docs.find((doc) => doc.id === state.selectedDocId) || null;
}

function docWindows(docId) {
  if (!state.analysisByDoc[docId]) {
    state.analysisByDoc[docId] = [];
  }
  return state.analysisByDoc[docId];
}

function currentWindows() {
  const doc = selectedDoc();
  if (!doc) {
    return [];
  }
  return docWindows(doc.id);
}

function docDownloads(docId) {
  if (!state.downloadsByDoc[docId]) {
    state.downloadsByDoc[docId] = [];
  }
  return state.downloadsByDoc[docId];
}

function findCurrentWindow(windowId) {
  return currentWindows().find((entry) => entry.id === windowId) || null;
}

function showToast(message, timeoutMs = 2800) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.toast.classList.add("hidden");
  }, timeoutMs);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function triggerDownload(file) {
  if (!file?.contentBase64) {
    return;
  }

  const blob = new Blob([decodeBase64ToBytes(file.contentBase64)], {
    type: file.mimeType || "application/octet-stream"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename || "download.txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addGeneratedDownloads(docId, downloads) {
  if (!docId || !Array.isArray(downloads) || !downloads.length) {
    return;
  }

  const bucket = docDownloads(docId);
  const normalized = downloads.map((download, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    filename: download.filename || `download-${index + 1}.txt`,
    mimeType: download.mimeType || "text/plain",
    sizeBytes: Number(download.sizeBytes ?? 0),
    createdAt: new Date().toISOString(),
    contentBase64: String(download.contentBase64 || "")
  }));

  bucket.unshift(...normalized);
  if (state.selectedDocId === docId) {
    state.workspaceFiles = [...bucket];
    renderWorkspaceFiles();
  }

  for (const file of normalized) {
    triggerDownload(file);
  }
}

function compactText(value, length = 5000) {
  const text = (value || "").trim();
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length)}...`;
}

function setFormDisabled(form, disabled) {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  for (const control of [...form.elements]) {
    if ("disabled" in control) {
      control.disabled = disabled;
    }
  }
}

function getSignatureAppearanceMode() {
  return state.signatureAppearanceMode || el.signatureAppearanceInputs.find((input) => input.checked)?.value || "draw";
}

function setSignatureAppearanceMode(mode) {
  state.signatureAppearanceMode = mode;
  for (const input of el.signatureAppearanceInputs) {
    input.checked = input.value === mode;
  }
}

function createTypedSignatureDataUrl(text) {
  const value = String(text || "").trim();
  if (!value) {
    throw new Error("Type the name you want to place as a signature.");
  }

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) {
    throw new Error("Could not prepare the typed signature.");
  }

  const baseFontSize = 54;
  measureContext.font = `${baseFontSize}px ${TYPED_SIGNATURE_FONT_STACK}`;
  const measuredWidth = Math.ceil(measureContext.measureText(value).width);
  const width = Math.min(TYPED_SIGNATURE_MAX_WIDTH, Math.max(TYPED_SIGNATURE_MIN_WIDTH, measuredWidth + 44));
  const height = TYPED_SIGNATURE_HEIGHT;
  const scale = 4;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(width * scale));
  canvas.height = Math.max(8, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare the typed signature.");
  }

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#172229";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let fontSize = baseFontSize;
  ctx.font = `${fontSize}px ${TYPED_SIGNATURE_FONT_STACK}`;
  while (fontSize > 28 && ctx.measureText(value).width > width - 28) {
    fontSize -= 2;
    ctx.font = `${fontSize}px ${TYPED_SIGNATURE_FONT_STACK}`;
  }

  ctx.fillText(value, width / 2, height / 2 + 4);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height
  };
}

function renderSignaturePreview() {
  if (!(el.signaturePreviewNote instanceof HTMLElement)) {
    return;
  }

  const mode = getSignatureAppearanceMode();
  const typedName = el.signatureAppearanceText instanceof HTMLInputElement ? el.signatureAppearanceText.value.trim() : "";

  if (mode === "draw") {
    el.signaturePreviewNote.textContent = "The drawn signature will be placed on the page exactly as sketched.";
    return;
  }

  el.signaturePreviewNote.textContent = typedName
    ? `The typed signature will place "${typedName}" in cursive.`
    : "Type the name you want to render in cursive.";
}

function renderSignatureAppearanceMode() {
  const mode = getSignatureAppearanceMode();

  if (el.signatureTypeSection instanceof HTMLElement) {
    el.signatureTypeSection.hidden = mode !== "type";
  }
  if (el.signatureDrawSection instanceof HTMLElement) {
    el.signatureDrawSection.hidden = mode !== "draw";
  }
  if (el.signatureModeNote instanceof HTMLElement) {
    if (mode === "draw") {
      el.signatureModeNote.textContent = "Draw the signature you want to place, then click Start Placement.";
    } else {
      el.signatureModeNote.textContent = "Type the signature name you want to render in cursive, then click Start Placement.";
    }
  }
  if (el.signatureStartBtn instanceof HTMLButtonElement) {
    if (mode === "draw") {
      el.signatureStartBtn.textContent = "Start Placement With Drawn Signature";
    } else {
      el.signatureStartBtn.textContent = "Start Placement With Typed Signature";
    }
  }
  renderSignaturePreview();
}

function signaturePadContext() {
  if (!(el.signaturePad instanceof HTMLCanvasElement)) {
    return null;
  }

  const ctx = el.signaturePad.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#172229";
  ctx.lineWidth = 6;
  return ctx;
}

function clearSignaturePad() {
  const ctx = signaturePadContext();
  if (!ctx || !(el.signaturePad instanceof HTMLCanvasElement)) {
    return;
  }

  ctx.clearRect(0, 0, el.signaturePad.width, el.signaturePad.height);
  state.signaturePad.drawing = false;
  state.signaturePad.pointerId = null;
  state.signaturePad.lastPoint = null;
  state.signaturePad.hasInk = false;
}

function signaturePadPoint(event) {
  if (!(el.signaturePad instanceof HTMLCanvasElement)) {
    return null;
  }

  const rect = el.signaturePad.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: (event.clientX - rect.left) * (el.signaturePad.width / rect.width),
    y: (event.clientY - rect.top) * (el.signaturePad.height / rect.height)
  };
}

function finishSignatureStroke() {
  state.signaturePad.drawing = false;
  state.signaturePad.pointerId = null;
  state.signaturePad.lastPoint = null;
}

function initSignaturePad() {
  if (!(el.signaturePad instanceof HTMLCanvasElement)) {
    return;
  }

  clearSignaturePad();

  el.signaturePad.addEventListener("pointerdown", (event) => {
    if (!selectedDoc() || el.signaturePad.classList.contains("is-disabled")) {
      return;
    }

    const ctx = signaturePadContext();
    const point = signaturePadPoint(event);
    if (!ctx || !point) {
      return;
    }

    event.preventDefault();
    state.signaturePad.drawing = true;
    state.signaturePad.pointerId = event.pointerId;
    state.signaturePad.lastPoint = point;
    state.signaturePad.hasInk = true;
    el.signaturePad.setPointerCapture(event.pointerId);

    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "#172229";
    ctx.fill();
  });

  el.signaturePad.addEventListener("pointermove", (event) => {
    if (!state.signaturePad.drawing || state.signaturePad.pointerId !== event.pointerId) {
      return;
    }

    const ctx = signaturePadContext();
    const point = signaturePadPoint(event);
    const previous = state.signaturePad.lastPoint;
    if (!ctx || !point || !previous) {
      return;
    }

    event.preventDefault();
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    state.signaturePad.lastPoint = point;
  });

  const endStroke = (event) => {
    if (state.signaturePad.pointerId !== event.pointerId) {
      return;
    }

    if (el.signaturePad.hasPointerCapture(event.pointerId)) {
      el.signaturePad.releasePointerCapture(event.pointerId);
    }
    finishSignatureStroke();
  };

  el.signaturePad.addEventListener("pointerup", endStroke);
  el.signaturePad.addEventListener("pointercancel", endStroke);

  if (el.clearSignature instanceof HTMLButtonElement) {
    el.clearSignature.addEventListener("click", () => {
      clearSignaturePad();
    });
  }
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getPageSize(doc, page) {
  const sizes = Array.isArray(doc?.pageSizes) ? doc.pageSizes : [];
  const row = sizes[page - 1] || sizes[0];
  const width = toNumber(row?.width, 612);
  const height = toNumber(row?.height, 792);
  return { width, height };
}

function markPdfDirty() {
  state.viewerRevision = Date.now();
  renderDocContext();
}

function setSelectedDoc(docId) {
  if (state.selectedDocId !== docId) {
    state.selectedDocId = docId;
    state.viewerRevision = Date.now();
    state.viewerZoom = 1;
    state.viewerRotation = 0;
    state.viewerPage = 1;
    clearPlacementState();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderPaneLayoutState() {
  const leftWidth = state.layout.leftCollapsed ? 0 : state.layout.leftWidth;
  const rightWidth = state.layout.rightCollapsed ? 0 : state.layout.rightWidth;
  el.workspaceGrid.style.setProperty("--left-pane-width", `${leftWidth}px`);
  el.workspaceGrid.style.setProperty("--right-pane-width", `${rightWidth}px`);
  el.workspaceGrid.classList.toggle("left-collapsed", state.layout.leftCollapsed);
  el.workspaceGrid.classList.toggle("right-collapsed", state.layout.rightCollapsed);

  el.leftPaneToggle.textContent = state.layout.leftCollapsed ? "Show" : "Hide";
  el.rightPaneToggle.textContent = state.layout.rightCollapsed ? "Show" : "Hide";
  el.leftPaneEdgeToggle.textContent = "Show Library";
  el.rightPaneEdgeToggle.textContent = "Show Tools";
  el.leftPaneEdgeToggle.hidden = !state.layout.leftCollapsed;
  el.rightPaneEdgeToggle.hidden = !state.layout.rightCollapsed;
}

function renderViewerControls() {
  const doc = selectedDoc();
  const ready = Boolean(doc);
  const pageCount = doc?.pageCount || 0;
  const currentPage = ready ? clamp(state.viewerPage, 1, pageCount || 1) : 0;
  el.zoomLevel.textContent = `${Math.round(state.viewerZoom * 100)}%`;
  el.pageReadout.textContent = ready ? `${currentPage} / ${pageCount}` : "- / -";
  el.zoomOutBtn.disabled = !ready;
  el.zoomFitBtn.disabled = !ready;
  el.zoomInBtn.disabled = !ready;
  el.pagePrevBtn.disabled = !ready || currentPage <= 1;
  el.pageNextBtn.disabled = !ready || currentPage >= pageCount;
  el.pageJumpInput.disabled = !ready;
  el.undoBtn.disabled = !ready || !doc?.canUndo;
  el.redoBtn.disabled = !ready || !doc?.canRedo;
  el.rotateViewLeft.disabled = !ready;
  el.rotateViewRight.disabled = !ready;

  if (ready) {
    el.pageJumpInput.min = "1";
    el.pageJumpInput.max = String(pageCount);
    el.pageJumpInput.placeholder = `1-${pageCount}`;
    if (document.activeElement !== el.pageJumpInput) {
      el.pageJumpInput.value = String(currentPage);
    }
  } else {
    el.pageJumpInput.value = "";
    el.pageJumpInput.min = "1";
    el.pageJumpInput.max = "1";
    el.pageJumpInput.placeholder = "Page";
  }

  if (!ready) {
    el.downloadViewer.classList.add("disabled-link");
    el.downloadViewer.removeAttribute("href");
    return;
  }

  el.downloadViewer.href = `/api/docs/${doc.id}/download`;
  el.downloadViewer.classList.remove("disabled-link");
}

function scrollViewerToPage(pageNumber, behavior = "smooth") {
  const doc = selectedDoc();
  if (!doc) {
    return;
  }

  const targetPage = clamp(Math.round(toNumber(pageNumber, state.viewerPage || 1)), 1, doc.pageCount || 1);
  state.viewerPage = targetPage;

  for (const input of el.placementPageInputs) {
    input.value = String(targetPage);
  }

  renderViewerControls();

  const sheet = el.pdfViewer.querySelector(`.pdf-sheet[data-page-number="${targetPage}"]`);
  if (!(sheet instanceof HTMLElement)) {
    return;
  }

  const top = Math.max(0, sheet.offsetTop - 8);
  el.pdfScroll.scrollTo({ top, behavior });
}

function normalizePageJumpInput() {
  const doc = selectedDoc();
  if (!doc) {
    renderViewerControls();
    return state.viewerPage || 1;
  }

  const rawValue = String(el.pageJumpInput.value || "").trim();
  if (!rawValue) {
    renderViewerControls();
    return clamp(state.viewerPage || 1, 1, doc.pageCount || 1);
  }

  const targetPage = clamp(Math.round(toNumber(rawValue, state.viewerPage || 1)), 1, doc.pageCount || 1);
  el.pageJumpInput.value = String(targetPage);
  return targetPage;
}

function setViewerZoom(nextZoom) {
  const clampedZoom = clamp(nextZoom, MIN_VIEWER_ZOOM, MAX_VIEWER_ZOOM);
  if (Math.abs(clampedZoom - state.viewerZoom) < 0.001) {
    return;
  }
  state.viewerZoom = clampedZoom;
  renderViewerControls();
  schedulePdfViewerRender();
}

function rotateViewer(delta) {
  state.viewerRotation = ((state.viewerRotation + delta) % 360 + 360) % 360;
  schedulePdfViewerRender();
}

function renderToolPanelState() {
  for (const button of el.toolRibbonButtons) {
    const active = button.dataset.toolPanelTarget === state.activeToolPanel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of el.toolPanels) {
    const active = panel.dataset.toolPanelId === state.activeToolPanel;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  }
}

function detectViewerPage() {
  const sheets = [...el.pdfViewer.querySelectorAll(".pdf-sheet")];
  if (!sheets.length) {
    return 1;
  }

  const scrollRect = el.pdfScroll.getBoundingClientRect();
  const viewportCenter = scrollRect.top + scrollRect.height / 2;
  let bestPage = 1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const sheet of sheets) {
    const rect = sheet.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, scrollRect.top);
    const visibleBottom = Math.min(rect.bottom, scrollRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const centerDistance = Math.abs(((rect.top + rect.bottom) / 2) - viewportCenter);
    const score = visibleHeight * 1000 - centerDistance;

    if (score > bestScore) {
      bestScore = score;
      bestPage = Math.max(1, toNumber(sheet.dataset.pageNumber, 1));
    }
  }

  return bestPage;
}

function syncPlacementPageInputs(force = false) {
  const doc = selectedDoc();
  if (!doc) {
    return;
  }

  const nextPage = clamp(detectViewerPage(), 1, doc.pageCount || 1);
  const previousPage = state.viewerPage;
  state.viewerPage = nextPage;

  for (const input of el.placementPageInputs) {
    const currentValue = String(input.value || "").trim();
    const currentPage = toNumber(currentValue, previousPage);
    if (force || !currentValue || currentPage === previousPage) {
      input.value = String(nextPage);
    }
  }

  if (force || nextPage !== previousPage) {
    renderViewerControls();
  }
}

function clearPdfViewer() {
  state.pdfViewerTaskId += 1;
  state.pdfViewerBusy = false;
  state.pdfViewerPending = false;
  el.pdfScroll.classList.remove("single-page");
  el.pdfViewer.classList.remove("single-page");
  el.pdfViewer.innerHTML = "";
}

function setPdfViewerStatus(message) {
  el.pdfViewer.innerHTML = "";
  const note = document.createElement("div");
  note.className = "pdf-viewer-status";
  note.textContent = message;
  el.pdfViewer.append(note);
}

function schedulePdfViewerRender() {
  clearTimeout(state.pdfViewerRenderTimer);
  state.pdfViewerRenderTimer = setTimeout(() => {
    const doc = selectedDoc();
    if (!doc) {
      return;
    }
    void renderPdfViewer(doc);
  }, 80);
}

function startPaneResize(edge, event) {
  event.preventDefault();
  state.paneResize = {
    edge,
    startX: event.clientX,
    leftWidth: state.layout.leftWidth,
    rightWidth: state.layout.rightWidth
  };
  document.body.classList.add("dragging");
}

function updatePaneResize(event) {
  if (!state.paneResize) {
    return;
  }

  const deltaX = event.clientX - state.paneResize.startX;
  if (state.paneResize.edge === "left") {
    state.layout.leftWidth = clamp(state.paneResize.leftWidth + deltaX, MIN_LEFT_PANE, MAX_LEFT_PANE);
  } else {
    state.layout.rightWidth = clamp(state.paneResize.rightWidth - deltaX, MIN_RIGHT_PANE, MAX_RIGHT_PANE);
  }

  renderPaneLayoutState();
  schedulePdfViewerRender();
}

function stopPaneResize() {
  if (!state.paneResize) {
    return;
  }
  state.paneResize = null;
  document.body.classList.remove("dragging");
}

async function renderPdfViewer(doc) {
  if (state.pdfViewerBusy) {
    state.pdfViewerPending = true;
    return;
  }

  state.pdfViewerBusy = true;
  const taskId = ++state.pdfViewerTaskId;
  const revision = state.viewerRevision;
  const singlePage = doc.pageCount <= 1;

  el.pdfScroll.classList.toggle("single-page", singlePage);
  el.pdfViewer.classList.toggle("single-page", singlePage);
  setPdfViewerStatus("Rendering preview...");

  try {
    const pdfDoc = await getPlacementPdfDoc(doc);
    if (taskId !== state.pdfViewerTaskId || state.selectedDocId !== doc.id || revision !== state.viewerRevision) {
      return;
    }

    const gutter = singlePage ? 8 : 10;
    const bounds = {
      width: Math.max(160, el.pdfStage.clientWidth - gutter * 2),
      height: Math.max(160, el.pdfStage.clientHeight - gutter * 2)
    };

    const rotation = state.viewerRotation;
    const firstPage = await pdfDoc.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1, rotation });
    const widthScale = Math.max(0.1, (bounds.width - 8) / firstViewport.width);
    const heightScale = Math.max(0.1, (bounds.height - 8) / firstViewport.height);
    const fitScale = singlePage ? Math.min(widthScale, heightScale) : widthScale;
    const baseScale = fitScale * state.viewerZoom;

    el.pdfViewer.innerHTML = "";

    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      const page = pageNumber === 1 ? firstPage : await pdfDoc.getPage(pageNumber);
      if (taskId !== state.pdfViewerTaskId || state.selectedDocId !== doc.id || revision !== state.viewerRevision) {
        return;
      }

      const cssViewport = page.getViewport({ scale: baseScale, rotation });
      const dpr = window.devicePixelRatio || 1;
      const renderViewport = page.getViewport({ scale: baseScale * dpr, rotation });

      const sheet = document.createElement("section");
      sheet.className = "pdf-sheet";
      sheet.dataset.pageNumber = String(pageNumber);

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.width = Math.max(1, Math.round(renderViewport.width));
      canvas.height = Math.max(1, Math.round(renderViewport.height));
      canvas.style.width = `${Math.round(cssViewport.width)}px`;
      canvas.style.height = `${Math.round(cssViewport.height)}px`;

      const context = canvas.getContext("2d", { alpha: false });
      sheet.append(canvas);
      el.pdfViewer.append(sheet);

      await page.render({
        canvasContext: context,
        viewport: renderViewport
      }).promise;
    }

    if (singlePage) {
      el.pdfScroll.scrollTop = 0;
      el.pdfScroll.scrollLeft = 0;
    }

    syncPlacementPageInputs(true);
  } catch (error) {
    if (taskId !== state.pdfViewerTaskId) {
      return;
    }
    setPdfViewerStatus("Unable to render PDF preview.");
    showToast(`Could not render PDF preview: ${error.message}`);
  } finally {
    state.pdfViewerBusy = false;
    if (state.pdfViewerPending) {
      state.pdfViewerPending = false;
      schedulePdfViewerRender();
    }
  }
}

function bringWindowToFront(entry) {
  entry.z = ++state.zSeed;
}

function sanitizeWindowModels() {
  const ids = new Set(state.models.map((model) => model.id));
  for (const docId of Object.keys(state.analysisByDoc)) {
    for (const entry of state.analysisByDoc[docId]) {
      if (!entry.model || !ids.has(entry.model)) {
        entry.model = state.defaultModel;
      }
    }
  }
}

function normalizeModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  state.models = rows
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: model.model || model.id,
      label: model.displayName || model.model || model.id,
      isDefault: Boolean(model.isDefault)
    }));

  state.defaultModel = state.models.find((model) => model.isDefault)?.id || state.models[0]?.id || null;
  sanitizeWindowModels();
}

function cleanupStateAgainstDocs() {
  const known = new Set(state.docs.map((doc) => doc.id));

  for (const docId of [...state.mergeSelection]) {
    if (!known.has(docId)) {
      state.mergeSelection.delete(docId);
    }
  }

  for (const docId of Object.keys(state.analysisByDoc)) {
    if (!known.has(docId)) {
      delete state.analysisByDoc[docId];
    }
  }

  for (const docId of Object.keys(state.downloadsByDoc)) {
    if (!known.has(docId)) {
      delete state.downloadsByDoc[docId];
    }
  }
}

function renderAccountStatus(account) {
  state.account = account?.account ?? null;

  if (!state.account) {
    el.accountStatus.textContent = "Not signed in";
    el.loginBtn.textContent = "Sign In";
    return;
  }

  if (state.account.type === "chatgpt") {
    const plan = state.account.planType ? ` (${state.account.planType})` : "";
    el.accountStatus.textContent = `${state.account.email}${plan}`;
    el.loginBtn.textContent = "Sign Out";
    return;
  }

  el.accountStatus.textContent = `Signed in with ${state.account.type}`;
  el.loginBtn.textContent = "Sign Out";
}

function describeFormFieldType(field) {
  switch (field?.type) {
    case "textarea":
      return "Multi-line text";
    case "checkbox":
      return "Checkbox";
    case "select":
      return "Dropdown";
    case "radio":
      return "Radio group";
    case "multiselect":
      return "Multi-select";
    default:
      return "Text field";
  }
}

function buildFormFieldControl(field, index) {
  if (field?.type === "checkbox") {
    const label = document.createElement("label");
    label.className = "form-field-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.value);
    input.dataset.formFieldIndex = String(index);
    input.disabled = Boolean(field.readOnly);

    const text = document.createElement("span");
    text.textContent = "Checked";
    label.append(input, text);
    return label;
  }

  if (field?.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = "form-field-control";
    textarea.rows = 4;
    textarea.value = String(field.value || "");
    textarea.dataset.formFieldIndex = String(index);
    textarea.disabled = Boolean(field.readOnly);
    return textarea;
  }

  if (field?.type === "select" || field?.type === "radio" || field?.type === "multiselect") {
    const select = document.createElement("select");
    select.className = "form-field-control";
    select.dataset.formFieldIndex = String(index);
    select.disabled = Boolean(field.readOnly);

    if (field.type === "multiselect") {
      select.multiple = true;
    } else if (!field.required) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = field.type === "radio" ? "No selection" : "Choose an option";
      select.append(emptyOption);
    }

    const values = new Set(Array.isArray(field.value) ? field.value.map(String) : [String(field.value || "")]);
    for (const option of Array.isArray(field.options) ? field.options : []) {
      const optionEl = document.createElement("option");
      optionEl.value = String(option.value ?? "");
      optionEl.textContent = String(option.label ?? option.value ?? "");
      optionEl.selected = field.type === "multiselect" ? values.has(optionEl.value) : false;
      select.append(optionEl);
    }

    if (field.type === "multiselect") {
      select.size = Math.min(Math.max(select.options.length, 3), 6);
    } else {
      select.value = String(field.value || "");
    }

    return select;
  }

  const input = document.createElement("input");
  input.className = "form-field-control";
  input.type = "text";
  input.value = String(field?.value || "");
  input.dataset.formFieldIndex = String(index);
  input.disabled = Boolean(field?.readOnly);
  return input;
}

function renderFormsPanel() {
  if (!(el.formsSummary instanceof HTMLElement) || !(el.formsFields instanceof HTMLElement)) {
    return;
  }

  const doc = selectedDoc();
  el.formsFields.innerHTML = "";

  if (!(el.formsSubmit instanceof HTMLButtonElement)) {
    return;
  }

  if (!doc) {
    el.formsSummary.textContent = "Select a document to fill its embedded PDF form fields.";
    el.formsSubmit.disabled = true;
    return;
  }

  const forms = Array.isArray(doc.forms) ? doc.forms : [];
  const editableCount = forms.filter((field) => !field.readOnly).length;

  if (!forms.length) {
    el.formsSummary.textContent = "No fillable PDF form fields were detected in this document.";
    el.formsSubmit.disabled = true;
    return;
  }

  if (doc.hasSignatures) {
    el.formsSummary.textContent = "This PDF already contains digital signatures, so form edits are locked to avoid invalidating them.";
  } else if (!editableCount) {
    el.formsSummary.textContent = `${forms.length} form field${forms.length === 1 ? "" : "s"} detected, but all of them are read-only.`;
  } else {
    el.formsSummary.textContent = `${forms.length} form field${forms.length === 1 ? "" : "s"} detected. Update the values here, then apply them back into the PDF.`;
  }

  forms.forEach((field, index) => {
    const item = document.createElement("div");
    item.className = "form-field-item";

    const head = document.createElement("div");
    head.className = "form-field-head";

    const titleRow = document.createElement("div");
    titleRow.className = "form-field-title-row";

    const title = document.createElement("strong");
    title.className = "form-field-title";
    title.textContent = field.label || field.name || `Field ${index + 1}`;

    const chips = document.createElement("div");
    chips.className = "form-field-chip-row";

    const typeChip = document.createElement("span");
    typeChip.className = "form-field-chip";
    typeChip.textContent = describeFormFieldType(field);
    chips.append(typeChip);

    if (field.required) {
      const chip = document.createElement("span");
      chip.className = "form-field-chip";
      chip.textContent = "Required";
      chips.append(chip);
    }

    if (field.readOnly) {
      const chip = document.createElement("span");
      chip.className = "form-field-chip";
      chip.textContent = "Read only";
      chips.append(chip);
    }

    titleRow.append(title, chips);

    const meta = document.createElement("p");
    meta.className = "form-field-meta";
    meta.textContent = [
      field.page ? `Page ${field.page}` : null,
      field.name || null
    ].filter(Boolean).join(" · ");

    head.append(titleRow, meta);
    item.append(head, buildFormFieldControl(field, index));
    el.formsFields.append(item);
  });

  el.formsSubmit.disabled = doc.hasSignatures || !editableCount;
}

function renderSignaturePanel() {
  if (!(el.signatureSummary instanceof HTMLElement)) {
    return;
  }

  const doc = selectedDoc();
  el.signatureSummary.innerHTML = "";

  const note = document.createElement("p");
  note.className = "signature-summary-note";

  if (!doc) {
    note.textContent = "Select a document to place an electronic signature or review digital signatures.";
    el.signatureSummary.append(note);
    return;
  }

  const signatures = Array.isArray(doc.signatures) ? doc.signatures : [];
  if (!signatures.length) {
    note.textContent = "Electronic signatures place a visible signature on the page. If this PDF already contains true digital signatures, they will appear here and editing will stay locked.";
    el.signatureSummary.append(note);
    return;
  }

  note.textContent = "Digital signatures are preserved as signed revisions. Editing tools are locked on signed PDFs to avoid invalidating them.";
  el.signatureSummary.append(note);

  const list = document.createElement("ul");
  list.className = "signature-list";

  for (const signature of signatures) {
    const item = document.createElement("li");
    item.className = "signature-item";

    const title = document.createElement("strong");
    title.textContent = signature.signerName || signature.fieldName || "Digital signature";

    const meta = document.createElement("p");
    meta.className = "signature-meta-line";
    meta.textContent = [
      signature.fieldName || null,
      formatDateTime(signature.signedAt),
      signature.signerSubject && signature.signerSubject !== signature.signerName ? signature.signerSubject : null
    ].filter(Boolean).join(" · ");

    const chips = document.createElement("div");
    chips.className = "signature-chip-row";

    const addChip = (label) => {
      if (!label) {
        return;
      }
      const chip = document.createElement("span");
      chip.className = "signature-chip";
      chip.textContent = label;
      chips.append(chip);
    };

    addChip(signature.integrity?.coverage);
    addChip(signature.integrity?.modificationLevel);
    if (signature.docMdpLevel) {
      addChip(`DocMDP ${signature.docMdpLevel}`);
    }
    if (signature.integrity?.docMdpOk === false) {
      addChip("DocMDP failed");
    }

    item.append(title, meta);
    if (chips.childElementCount) {
      item.append(chips);
    }
    list.append(item);
  }

  el.signatureSummary.append(list);
}

function renderEditLockState() {
  const doc = selectedDoc();
  const hasDoc = Boolean(doc);
  const signed = Boolean(doc?.hasSignatures);

  setFormDisabled(el.rotateForm, !hasDoc || signed);
  setFormDisabled(el.deletePagesForm, !hasDoc || signed);
  setFormDisabled(el.extractPagesForm, !hasDoc || signed);
  setFormDisabled(el.formsForm, !hasDoc || signed);
  setFormDisabled(el.addTextForm, !hasDoc || signed);
  setFormDisabled(el.highlightForm, !hasDoc || signed);
  setFormDisabled(el.signatureForm, !hasDoc || signed);
  setFormDisabled(el.extractTextForm, !hasDoc);

  if (el.signaturePad instanceof HTMLCanvasElement) {
    el.signaturePad.classList.toggle("is-disabled", !hasDoc || signed);
    el.signaturePad.setAttribute("aria-disabled", String(!hasDoc || signed));
  }
  if (el.clearSignature instanceof HTMLButtonElement) {
    el.clearSignature.disabled = !hasDoc || signed;
  }
}

function renderDocs() {
  el.docList.innerHTML = "";

  if (!state.docs.length) {
    const empty = document.createElement("li");
    empty.className = "empty-text";
    empty.textContent = "No PDFs uploaded yet.";
    el.docList.append(empty);
    return;
  }

  for (const doc of state.docs) {
    const item = document.createElement("li");
    item.className = `doc-item${doc.id === state.selectedDocId ? " active" : ""}`;

    const top = document.createElement("div");
    top.className = "doc-item-top";

    const mergeToggle = document.createElement("input");
    mergeToggle.type = "checkbox";
    mergeToggle.dataset.mergeId = doc.id;
    mergeToggle.checked = state.mergeSelection.has(doc.id);

    const actions = document.createElement("div");
    actions.className = "doc-row-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn ghost";
    openButton.dataset.selectId = doc.id;
    openButton.textContent = doc.id === state.selectedDocId ? "Viewing" : "Open";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "doc-remove-btn";
    deleteButton.dataset.deleteId = doc.id;
    deleteButton.setAttribute("aria-label", `Delete ${doc.filename}`);
    deleteButton.textContent = "x";

    actions.append(openButton, deleteButton);
    top.append(mergeToggle, actions);

    const title = document.createElement("p");
    title.className = "doc-title";
    title.textContent = doc.filename;

    const meta = document.createElement("p");
    meta.className = "doc-meta";
    meta.textContent = `${doc.pageCount} pages · ${formatBytes(doc.sizeBytes)}`;

    item.append(top, title, meta);
    el.docList.append(item);
  }
}

function renderDocContext() {
  const doc = selectedDoc();

  if (!doc) {
    el.selectedDocMeta.textContent = "No document selected.";
    el.canvasDocTitle.textContent = "No PDF selected";
    el.canvasDocMeta.textContent = "Upload a PDF to start.";
    el.newAnalysisWindow.disabled = true;
    state.viewerPage = 1;
    for (const input of el.placementPageInputs) {
      input.value = "1";
    }
    clearPdfViewer();
    el.pdfEmpty.classList.remove("hidden");
    renderViewerControls();
    renderFormsPanel();
    renderEditLockState();
    renderSignaturePanel();
    return;
  }

  const signatureLabel = doc.hasSignatures ? `${doc.signatures.length} signature${doc.signatures.length === 1 ? "" : "s"}` : null;
  el.selectedDocMeta.textContent = [doc.filename, `${doc.pageCount} pages`, formatBytes(doc.sizeBytes), signatureLabel].filter(Boolean).join(" · ");
  el.canvasDocTitle.textContent = doc.filename;
  el.canvasDocMeta.textContent = [`${doc.pageCount} pages`, formatBytes(doc.sizeBytes), signatureLabel].filter(Boolean).join(" · ");
  el.newAnalysisWindow.disabled = false;
  el.pdfEmpty.classList.add("hidden");
  renderViewerControls();
  renderFormsPanel();
  renderEditLockState();
  renderSignaturePanel();
  void renderPdfViewer(doc);
}

async function deleteDocument(docId) {
  const doc = state.docs.find((entry) => entry.id === docId);
  if (!doc) {
    return;
  }

  if (!window.confirm(`Delete ${doc.filename}?`)) {
    return;
  }

  await api(`/api/docs/${doc.id}`, { method: "DELETE" });
  await loadDocs(true);
  el.extractedText.value = "";
  showToast("Document deleted.");
}

function renderWorkspaceFiles() {
  el.workspaceFiles.innerHTML = "";

  if (!state.workspaceFiles.length) {
    const empty = document.createElement("li");
    empty.className = "empty-text";
    empty.textContent = "No downloads yet.";
    el.workspaceFiles.append(empty);
    return;
  }

  for (const file of state.workspaceFiles) {
    const row = document.createElement("li");
    row.className = "workspace-row";

    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.filename;
    const meta = document.createElement("div");
    meta.className = "doc-meta";
    meta.textContent = [formatBytes(file.sizeBytes), formatTimestamp(file.createdAt)].filter(Boolean).join(" · ");
    left.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "workspace-actions";

    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn ghost";
    download.dataset.downloadId = file.id;
    download.textContent = "Download";
    actions.append(download);

    row.append(left, actions);
    el.workspaceFiles.append(row);
  }
}

function renderAnalysisWindows() {
  const doc = selectedDoc();
  el.analysisWindows.innerHTML = "";

  if (!doc) {
    return;
  }

  const windows = currentWindows();
  if (!windows.length) {
    return;
  }

  for (const entry of windows) {
    const card = document.createElement("article");
    card.className = `analysis-window${entry.minimized ? " minimized" : ""}`;
    card.dataset.windowId = entry.id;
    card.style.left = `${entry.rect.x}px`;
    card.style.top = `${entry.rect.y}px`;
    card.style.width = `${entry.rect.w}px`;
    card.style.height = entry.minimized ? "auto" : `${entry.rect.h}px`;
    card.style.zIndex = String(entry.z);

    const head = document.createElement("div");
    head.className = "window-head";

    const title = document.createElement("input");
    title.className = "window-title";
    title.value = entry.title;
    title.dataset.windowId = entry.id;
    title.dataset.windowField = "title";

    const threadChip = document.createElement("span");
    threadChip.className = "window-chip";
    threadChip.textContent = entry.threadId ? "thread linked" : "new thread";

    head.append(title, threadChip);

    const actions = document.createElement("div");
    actions.className = "window-actions";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "window-icon";
    toggle.dataset.action = "toggle-window";
    toggle.dataset.windowId = entry.id;
    toggle.textContent = entry.minimized ? "+" : "-";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "window-icon";
    close.dataset.action = "close-window";
    close.dataset.windowId = entry.id;
    close.textContent = "x";

    actions.append(toggle, close);
    head.append(actions);
    card.append(head);

    if (!entry.minimized) {
      const body = document.createElement("div");
      body.className = "window-body";

      const controls = document.createElement("div");
      controls.className = "window-controls";
      const modelLabel = document.createElement("span");
      modelLabel.className = "window-chip";
      modelLabel.textContent = "model";
      controls.append(modelLabel);

      const modelSelect = document.createElement("select");
      modelSelect.className = "model-select";
      modelSelect.dataset.windowId = entry.id;
      modelSelect.dataset.windowField = "model";

      if (!state.models.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "default";
        modelSelect.append(option);
      } else {
        for (const model of state.models) {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.label;
          if (entry.model === model.id) {
            option.selected = true;
          }
          modelSelect.append(option);
        }
      }

      controls.append(modelSelect);
      if (entry.running) {
        const running = document.createElement("span");
        running.className = "window-chip";
        running.textContent = "running";
        controls.append(running);
      }

      const messages = document.createElement("ul");
      messages.className = "window-messages";

      if (!entry.messages.length) {
        const note = document.createElement("li");
        note.className = "window-note";
        note.textContent = "Ask a question or request a downloadable file. Downloads are sent straight to your browser.";
        messages.append(note);
      }

      for (const message of entry.messages) {
        const line = document.createElement("li");
        line.className = `message ${message.role}${message.error ? " error" : ""}`;
        line.textContent = compactText(message.text);
        messages.append(line);
      }

      const form = document.createElement("form");
      form.className = "analysis-form";
      form.dataset.windowId = entry.id;

      const input = document.createElement("textarea");
      input.className = "analysis-input";
      input.dataset.windowId = entry.id;
      input.dataset.windowField = "draft";
      input.placeholder = "e.g. Summarize key clauses and return a downloadable markdown brief";
      input.value = entry.draft;

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "btn";
      submit.textContent = entry.running ? "Running..." : "Run in this window";
      submit.disabled = entry.running;

      form.append(input, submit);
      body.append(controls, messages, form);
      card.append(body);

      const resize = document.createElement("div");
      resize.className = "window-resize-handle";
      resize.dataset.windowId = entry.id;
      resize.dataset.action = "start-resize";
      card.append(resize);
    }

    el.analysisWindows.append(card);
  }
}

async function loadAccount() {
  const account = await api("/api/codex/account");
  renderAccountStatus(account);
  return account;
}

async function loadModels() {
  try {
    const payload = await api("/api/codex/models");
    normalizeModels(payload);
  } catch (_error) {
    state.models = [];
    state.defaultModel = null;
  }
}

async function loadWorkspaceFiles() {
  const doc = selectedDoc();
  if (!doc) {
    state.workspaceFiles = [];
    renderWorkspaceFiles();
    return;
  }

  state.workspaceFiles = [...docDownloads(doc.id)];
  renderWorkspaceFiles();
}

async function loadDocs(keepSelection = true) {
  const prevSelected = state.selectedDocId;
  const response = await api("/api/docs");
  state.docs = response.data;

  cleanupStateAgainstDocs();

  if (!keepSelection || !state.docs.some((doc) => doc.id === state.selectedDocId)) {
    setSelectedDoc(state.docs[0]?.id ?? null);
  }

  if (prevSelected !== state.selectedDocId) {
    state.viewerRevision = Date.now();
  }

  renderDocs();
  renderDocContext();
  await loadWorkspaceFiles();
  renderAnalysisWindows();
}

function clearLoginPoll() {
  if (state.loginPollTimer) {
    clearInterval(state.loginPollTimer);
    state.loginPollTimer = null;
  }
}

function startLoginPolling(loginId) {
  clearLoginPoll();
  state.loginPollTimer = setInterval(async () => {
    try {
      const status = await api(`/api/codex/login/status/${encodeURIComponent(loginId)}`);
      if (status.status?.pending) {
        return;
      }
      if (status.status?.success) {
        clearLoginPoll();
        await Promise.all([loadAccount(), loadModels()]);
        renderAnalysisWindows();
        showToast("ChatGPT login completed.");
        return;
      }
      if (status.status?.error) {
        clearLoginPoll();
        showToast(`Login failed: ${status.status.error}`);
      }
    } catch (error) {
      clearLoginPoll();
      showToast(error.message);
    }
  }, 2000);
}

function createAnalysisWindow() {
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const windows = currentWindows();
  const offset = windows.length % 6;
  const bounds = getAnalysisBounds();
  const canvasBounds = getElementBoundsWithinWorkspace(el.canvas);
  const width = 360;
  const height = 340;
  const entry = {
    id: `win-${state.windowSeed++}`,
    title: `Window ${windows.length + 1}`,
    draft: "",
    messages: [],
    threadId: null,
    model: state.defaultModel,
    minimized: false,
    running: false,
    z: ++state.zSeed,
    rect: {
      x: clamp(canvasBounds.left + Math.max(18, canvasBounds.width - width - 24) - offset * 18, 0, Math.max(0, bounds.width - width - 4)),
      y: clamp(canvasBounds.top + 18 + offset * 18, 0, Math.max(0, bounds.height - height - 4)),
      w: width,
      h: height
    }
  };

  windows.push(entry);
  renderAnalysisWindows();
}

async function getPdfJsModule() {
  if (!state.placementPdf.module) {
    // Use the legacy bundle for broader browser/runtime compatibility.
    state.placementPdf.module = import("/vendor/pdfjs/legacy/build/pdf.min.mjs?v=legacy1").then((module) => {
      module.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/legacy/build/pdf.worker.min.mjs?v=legacy1";
      return module;
    });
  }
  return state.placementPdf.module;
}

async function getPlacementPdfDoc(doc) {
  if (!doc) {
    throw new Error("No document selected.");
  }

  if (
    state.placementPdf.pdfDoc
    && state.placementPdf.docId === doc.id
    && state.placementPdf.revision === state.viewerRevision
  ) {
    return state.placementPdf.pdfDoc;
  }

  const pdfjs = await getPdfJsModule();
  const response = await fetch(`/api/docs/${doc.id}/view?rev=${state.viewerRevision}&placement=1`);
  if (!response.ok) {
    throw new Error(`Unable to load page preview (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;

  if (state.placementPdf.pdfDoc && typeof state.placementPdf.pdfDoc.cleanup === "function") {
    state.placementPdf.pdfDoc.cleanup();
  }

  state.placementPdf.docId = doc.id;
  state.placementPdf.revision = state.viewerRevision;
  state.placementPdf.pdfDoc = pdfDoc;
  return pdfDoc;
}

async function renderPlacementCanvas(doc, page) {
  const pdfDoc = await getPlacementPdfDoc(doc);
  const pdfPage = await pdfDoc.getPage(page);
  const baseViewport = pdfPage.getViewport({ scale: 1 });

  const pad = 26;
  const toolbarClearance = 70;
  const bounds = getStageBounds();
  const maxWidth = Math.max(140, bounds.width - pad * 2);
  const maxHeight = Math.max(140, bounds.height - pad * 2 - toolbarClearance);
  const scale = Math.max(0.01, Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height));

  const cssViewport = pdfPage.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const renderViewport = pdfPage.getViewport({ scale: scale * dpr });

  const canvas = el.placementCanvas;
  const ctx = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.max(1, Math.round(renderViewport.width));
  canvas.height = Math.max(1, Math.round(renderViewport.height));
  canvas.style.width = `${cssViewport.width}px`;
  canvas.style.height = `${cssViewport.height}px`;

  await pdfPage.render({
    canvasContext: ctx,
    viewport: renderViewport
  }).promise;

  el.placementCanvasHost.classList.add("active");
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const stageRect = el.pdfStage.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    left: canvasRect.left - stageRect.left,
    top: canvasRect.top - stageRect.top,
    width: canvasRect.width,
    height: canvasRect.height
  };
}

function getStageBounds() {
  return {
    width: el.pdfStage.clientWidth,
    height: el.pdfStage.clientHeight
  };
}

function getAnalysisBounds() {
  return {
    width: el.workspaceGrid.clientWidth,
    height: el.workspaceGrid.clientHeight
  };
}

function getElementBoundsWithinWorkspace(node) {
  const workspaceRect = el.workspaceGrid.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left - workspaceRect.left,
    top: rect.top - workspaceRect.top,
    width: rect.width,
    height: rect.height
  };
}

function pointInRect(localPoint, rect) {
  return localPoint.x >= rect.left
    && localPoint.x <= rect.left + rect.width
    && localPoint.y >= rect.top
    && localPoint.y <= rect.top + rect.height;
}

function clampToPlacementRect(localPoint, rect) {
  return {
    x: Math.min(rect.left + rect.width, Math.max(rect.left, localPoint.x)),
    y: Math.min(rect.top + rect.height, Math.max(rect.top, localPoint.y))
  };
}

function clampTopLeftToRect(localPoint, rect, width, height) {
  const boxWidth = Math.max(4, width);
  const boxHeight = Math.max(4, height);
  const maxLeft = rect.left + Math.max(0, rect.width - boxWidth);
  const maxTop = rect.top + Math.max(0, rect.height - boxHeight);
  return {
    x: Math.min(maxLeft, Math.max(rect.left, localPoint.x)),
    y: Math.min(maxTop, Math.max(rect.top, localPoint.y))
  };
}

function localRectFromPoints(start, end, rect) {
  const a = clampToPlacementRect(start, rect);
  const b = clampToPlacementRect(end, rect);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    left,
    top,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function localPointFromEvent(event) {
  const stageRect = el.pdfStage.getBoundingClientRect();
  return {
    x: event.clientX - stageRect.left,
    y: event.clientY - stageRect.top
  };
}

function placementPointToPdf(localPoint, rect, pageSize) {
  const relX = (localPoint.x - rect.left) / rect.width;
  const relY = (localPoint.y - rect.top) / rect.height;
  return {
    x: relX * pageSize.width,
    y: (1 - relY) * pageSize.height
  };
}

function localRectToPdfRect(localRect, placementRect, pageSize) {
  const relLeft = (localRect.left - placementRect.left) / placementRect.width;
  const relTop = (localRect.top - placementRect.top) / placementRect.height;
  const relWidth = localRect.width / placementRect.width;
  const relHeight = localRect.height / placementRect.height;

  const width = Math.max(1, relWidth * pageSize.width);
  const height = Math.max(1, relHeight * pageSize.height);
  const x = Math.min(Math.max(0, relLeft * pageSize.width), Math.max(0, pageSize.width - width));
  const yTop = (1 - relTop) * pageSize.height;
  const y = Math.min(Math.max(0, yTop - height), Math.max(0, pageSize.height - height));

  return { x, y, width, height };
}

function setPlacementPreviewBox(localRect) {
  el.placementPreviewBox.style.left = `${localRect.left}px`;
  el.placementPreviewBox.style.top = `${localRect.top}px`;
  el.placementPreviewBox.style.width = `${localRect.width}px`;
  el.placementPreviewBox.style.height = `${localRect.height}px`;
  el.placementPreviewBox.classList.add("visible");
}

function estimateTextBoxPdf(payload) {
  const fontSize = Math.max(6, toNumber(payload?.fontSize, 14));
  const text = String(payload?.text ?? "");
  const lines = text.split(/\r?\n/);
  const nonEmptyLines = lines.length ? lines : [text];
  const maxChars = Math.max(...nonEmptyLines.map((line) => line.length), 1);
  const lineHeight = fontSize * 1.25;
  return {
    width: Math.max(fontSize * 0.7, maxChars * fontSize * 0.57),
    height: Math.max(lineHeight, nonEmptyLines.length * lineHeight),
    fontSize
  };
}

function estimatePlacementBoxPdf(placement) {
  if (placement.mode === "signature") {
    return {
      width: Math.max(12, toNumber(placement.payload?.width, DRAWN_SIGNATURE_PDF_WIDTH)),
      height: Math.max(12, toNumber(placement.payload?.height, DRAWN_SIGNATURE_PDF_HEIGHT)),
      fontSize: null
    };
  }
  return estimateTextBoxPdf(placement.payload);
}

function estimatePlacementBoxLocal(placement, boxPdf) {
  return {
    width: (boxPdf.width / placement.pageSize.width) * placement.rect.width,
    height: (boxPdf.height / placement.pageSize.height) * placement.rect.height
  };
}

function topLeftPlacementToPdf(placement, topLeftLocal, boxPdf) {
  const pointPdf = placementPointToPdf(topLeftLocal, placement.rect, placement.pageSize);
  const maxX = Math.max(0, placement.pageSize.width - boxPdf.width);
  const maxY = Math.max(0, placement.pageSize.height - boxPdf.height);
  const topPdf = Math.min(placement.pageSize.height, Math.max(boxPdf.height, pointPdf.y));
  return {
    x: Math.min(maxX, Math.max(0, pointPdf.x)),
    y: Math.min(maxY, Math.max(0, topPdf - boxPdf.height))
  };
}

function previewPlacementAtPoint(placement, localPoint) {
  const clampedPoint = clampToPlacementRect(localPoint, placement.rect);
  const boxPdf = estimatePlacementBoxPdf(placement);
  const boxLocal = estimatePlacementBoxLocal(placement, boxPdf);
  const anchor = clampTopLeftToRect(clampedPoint, placement.rect, boxLocal.width, boxLocal.height);
  setPlacementPreviewBox({
    left: anchor.x,
    top: anchor.y,
    width: boxLocal.width,
    height: boxLocal.height
  });
  return { anchor, boxPdf };
}

async function commitPlacement(action, successMessage) {
  const placement = state.placement;
  if (!placement || placement.committing) {
    return;
  }

  placement.committing = true;
  el.placementHint.textContent = placement.mode === "signature" ? "Applying electronic signature..." : "Applying annotation...";

  try {
    await action(placement);
    await loadDocs(true);
    markPdfDirty();
    clearPlacementState();
    showToast(successMessage);
  } catch (error) {
    placement.committing = false;
    showToast(error.message);
    if (state.placement) {
      el.placementHint.textContent = "Placement failed. Try again or cancel.";
    }
  }
}

function clearPlacementState() {
  state.placement = null;
  el.placementLayer.classList.remove("active");
  el.placementCanvasHost.classList.remove("active");
  el.placementPreviewBox.classList.remove("visible");
  el.placementPreviewBox.style.removeProperty("left");
  el.placementPreviewBox.style.removeProperty("top");
  el.placementPreviewBox.style.removeProperty("width");
  el.placementPreviewBox.style.removeProperty("height");
  el.placementHint.textContent = "Click to place annotation.";
}

async function beginPlacement(mode, payload) {
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const page = Math.max(1, Math.min(toNumber(payload.page, state.viewerPage || 1), doc.pageCount || 1));
  const pageSize = getPageSize(doc, page);
  let rect;
  try {
    rect = await renderPlacementCanvas(doc, page);
  } catch (error) {
    el.placementCanvasHost.classList.remove("active");
    showToast(`Could not render placement preview: ${error.message}`);
    return;
  }

  state.placement = {
    docId: doc.id,
    mode,
    page,
    pageSize,
    rect,
    payload,
    dragStartLocal: null,
    pointerId: null,
    committing: false
  };

  el.placementPageFrame.style.left = `${rect.left}px`;
  el.placementPageFrame.style.top = `${rect.top}px`;
  el.placementPageFrame.style.width = `${rect.width}px`;
  el.placementPageFrame.style.height = `${rect.height}px`;

  if (mode === "highlight") {
    el.placementHint.textContent = "Drag on the highlighted page frame to draw a highlight area.";
  } else if (mode === "signature") {
    el.placementHint.textContent = "Step 2: move over the page and click once where the electronic signature should go.";
  } else {
    el.placementHint.textContent = "Move over the page, then click to place text.";
  }

  el.placementPreviewBox.classList.remove("visible");
  el.placementLayer.classList.add("active");
}

function startWindowInteraction(mode, windowId, event) {
  const entry = findCurrentWindow(windowId);
  if (!entry) {
    return;
  }

  bringWindowToFront(entry);

  state.windowInteraction = {
    mode,
    windowId,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...entry.rect }
  };

  document.body.classList.add("dragging");
  renderAnalysisWindows();
  event.preventDefault();
}

function updateWindowInteraction(event) {
  const interaction = state.windowInteraction;
  if (!interaction) {
    return;
  }

  const entry = findCurrentWindow(interaction.windowId);
  if (!entry) {
    return;
  }

  const bounds = getAnalysisBounds();
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;

  if (interaction.mode === "move") {
    const maxX = Math.max(0, bounds.width - entry.rect.w - 4);
    const maxY = Math.max(0, bounds.height - 44);
    entry.rect.x = Math.max(0, Math.min(interaction.startRect.x + dx, maxX));
    entry.rect.y = Math.max(0, Math.min(interaction.startRect.y + dy, maxY));
  }

  if (interaction.mode === "resize") {
    const maxW = Math.max(280, bounds.width - entry.rect.x - 4);
    const maxH = Math.max(160, bounds.height - entry.rect.y - 4);
    entry.rect.w = Math.max(280, Math.min(interaction.startRect.w + dx, maxW));
    entry.rect.h = Math.max(160, Math.min(interaction.startRect.h + dy, maxH));
  }

  const card = el.analysisWindows.querySelector(`.analysis-window[data-window-id="${entry.id}"]`);
  if (card) {
    card.style.left = `${entry.rect.x}px`;
    card.style.top = `${entry.rect.y}px`;
    card.style.width = `${entry.rect.w}px`;
    if (!entry.minimized) {
      card.style.height = `${entry.rect.h}px`;
    }
    card.style.zIndex = String(entry.z);
  }
}

function stopWindowInteraction() {
  if (!state.windowInteraction) {
    return;
  }
  state.windowInteraction = null;
  document.body.classList.remove("dragging");
}

async function runWindowAnalysis(windowId) {
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const entry = findCurrentWindow(windowId);
  if (!entry || entry.running) {
    return;
  }

  const prompt = entry.draft.trim();
  if (!prompt) {
    showToast("Write a prompt in this window first.");
    return;
  }

  entry.running = true;
  entry.messages.push({ role: "user", text: prompt, error: false });
  entry.draft = "";
  renderAnalysisWindows();

  try {
    const result = await api("/api/codex/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docId: doc.id,
        prompt,
        threadId: entry.threadId,
        model: entry.model
      })
    });

    entry.threadId = result.threadId || entry.threadId;

    entry.messages.push({
      role: "assistant",
      text: result.output || "(No assistant output)",
      error: false
    });

    addGeneratedDownloads(doc.id, result.downloads);
    await loadDocs(true);
    renderAnalysisWindows();
    if (result.downloads?.length) {
      showToast(result.downloads.length === 1 ? `Downloaded ${result.downloads[0].filename}.` : `Downloaded ${result.downloads.length} files.`);
    } else {
      showToast("Analysis window finished.");
    }
  } catch (error) {
    entry.messages.push({ role: "assistant", text: `Error: ${error.message}`, error: true });
    showToast(error.message);
  } finally {
    entry.running = false;
    renderAnalysisWindows();
  }
}

function withSelectedDoc(action) {
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return null;
  }
  return action(doc);
}

el.loginBtn.addEventListener("click", async () => {
  try {
    if (state.account) {
      clearLoginPoll();
      await api("/api/codex/logout", { method: "POST" });
      await Promise.all([loadAccount(), loadModels()]);
      renderAnalysisWindows();
      showToast("Signed out.");
      return;
    }

    const login = await api("/api/codex/login/start", { method: "POST" });
    if (login.type === "chatgpt") {
      window.open(login.authUrl, "_blank", "noopener,noreferrer");
      startLoginPolling(login.loginId);
      showToast("Login link opened in a new tab.");
      return;
    }
    showToast(`Login started (${login.type})`);
  } catch (error) {
    showToast(error.message);
  }
});

el.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = el.pdfFileInput.files?.[0];
  if (!file) {
    showToast("Pick a PDF first.");
    return;
  }

  const formData = new FormData();
  formData.append("pdf", file);

  try {
    const result = await api("/api/docs/upload", {
      method: "POST",
      body: formData
    });

    setSelectedDoc(result.document.id);
    await loadDocs(true);
    el.uploadForm.reset();
    showToast("PDF uploaded.");
  } catch (error) {
    showToast(error.message);
  }
});

el.docList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const mergeId = target.dataset.mergeId;
  if (!mergeId) {
    return;
  }

  if (target.checked) {
    state.mergeSelection.add(mergeId);
  } else {
    state.mergeSelection.delete(mergeId);
  }
});

el.docList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const deleteButton = target.closest("[data-delete-id]");
  if (deleteButton instanceof HTMLElement && deleteButton.dataset.deleteId) {
    await deleteDocument(deleteButton.dataset.deleteId);
    return;
  }

  const selectButton = target.closest("[data-select-id]");
  const selectId = selectButton instanceof HTMLElement ? selectButton.dataset.selectId : null;
  if (!selectId) {
    return;
  }

  setSelectedDoc(selectId);
  renderDocs();
  renderDocContext();
  await loadWorkspaceFiles();
  renderAnalysisWindows();
});

el.mergeBtn.addEventListener("click", async () => {
  const docIds = [...state.mergeSelection];
  if (docIds.length < 2) {
    showToast("Select at least two docs to merge.");
    return;
  }

  try {
    const merged = await api("/api/docs/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docIds })
    });

    state.mergeSelection.clear();
    setSelectedDoc(merged.document.id);
    await loadDocs(true);
    showToast("Merged PDF created.");
  } catch (error) {
    showToast(error.message);
  }
});

el.rotateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withSelectedDoc(async (doc) => {
    const formData = new FormData(el.rotateForm);

    await api(`/api/docs/${doc.id}/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages: formData.get("pages"),
        degrees: formData.get("degrees")
      })
    });

    await loadDocs(true);
    markPdfDirty();
    showToast("Rotation applied.");
  });
});

el.deletePagesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withSelectedDoc(async (doc) => {
    const formData = new FormData(el.deletePagesForm);

    await api(`/api/docs/${doc.id}/delete-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: formData.get("pages") })
    });

    await loadDocs(true);
    markPdfDirty();
    showToast("Pages deleted.");
  });
});

el.extractPagesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withSelectedDoc(async (doc) => {
    const formData = new FormData(el.extractPagesForm);

    const result = await api(`/api/docs/${doc.id}/extract-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages: formData.get("pages"),
        filename: formData.get("filename") || undefined
      })
    });

    setSelectedDoc(result.document.id);
    await loadDocs(true);
    showToast("Extracted pages as a new PDF.");
  });
});

el.formsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withSelectedDoc(async (doc) => {
    const forms = Array.isArray(doc.forms) ? doc.forms : [];
    const editableFields = forms.filter((field) => !field.readOnly);
    if (!editableFields.length) {
      showToast("No editable form fields are available in this PDF.");
      return;
    }

    const values = {};
    forms.forEach((field, index) => {
      if (field.readOnly) {
        return;
      }

      const control = el.formsFields.querySelector(`[data-form-field-index="${index}"]`);
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) {
        return;
      }

      if (field.type === "checkbox" && control instanceof HTMLInputElement) {
        values[field.name] = Boolean(control.checked);
        return;
      }

      if (field.type === "multiselect" && control instanceof HTMLSelectElement) {
        values[field.name] = [...control.selectedOptions].map((option) => option.value);
        return;
      }

      values[field.name] = String(control.value ?? "");
    });

    await api(`/api/docs/${doc.id}/fill-form-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: values })
    });

    await loadDocs(true);
    markPdfDirty();
    showToast("Form values applied.");
  });
});

el.addTextForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const formData = new FormData(el.addTextForm);
  const text = String(formData.get("text") || "").trim();
  if (!text) {
    showToast("Enter text first.");
    return;
  }

  await beginPlacement("text", {
    page: Number(formData.get("page") || 1),
    text,
    fontSize: Number(formData.get("fontSize") || 14),
    fontFamily: String(formData.get("fontFamily") || "helvetica"),
    color: String(formData.get("color") || "#111111"),
    bold: Boolean(formData.get("bold")),
    italic: Boolean(formData.get("italic")),
    underline: Boolean(formData.get("underline"))
  });
});

el.highlightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const formData = new FormData(el.highlightForm);
  await beginPlacement("highlight", {
    page: Number(formData.get("page") || 1),
    color: String(formData.get("color") || "#ffe16b"),
    opacity: Number(formData.get("opacity") || 0.35)
  });
});

el.signatureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const doc = selectedDoc();
  if (!doc) {
    showToast("Select a document first.");
    return;
  }

  const formData = new FormData(el.signatureForm);
  const appearanceMode = getSignatureAppearanceMode();
  const page = Number(formData.get("page") || 1);

  if (appearanceMode === "draw") {
    if (!state.signaturePad.hasInk || !(el.signaturePad instanceof HTMLCanvasElement)) {
      showToast("Draw the signature before placing it.");
      return;
    }

    await beginPlacement("signature", {
      page,
      width: DRAWN_SIGNATURE_PDF_WIDTH,
      height: DRAWN_SIGNATURE_PDF_HEIGHT,
      imageBase64: el.signaturePad.toDataURL("image/png"),
      appearanceMode
    });
    return;
  }

  const appearanceText = String(formData.get("appearanceText") || "").trim();
  if (!appearanceText) {
    showToast("Type the name you want to place as a signature.");
    return;
  }

  try {
    const typedAppearance = createTypedSignatureDataUrl(appearanceText);
    await beginPlacement("signature", {
      page,
      width: typedAppearance.width,
      height: typedAppearance.height,
      imageBase64: typedAppearance.dataUrl,
      appearanceMode,
      appearanceText
    });
  } catch (error) {
    showToast(error.message || "Could not prepare the typed signature.");
  }
});

el.cancelPlacement.addEventListener("click", (event) => {
  event.preventDefault();
  clearPlacementState();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.placement) {
    clearPlacementState();
  }
});

el.placementLayer.addEventListener("pointerdown", (event) => {
  const placement = state.placement;
  if (!placement || placement.mode !== "highlight" || placement.committing) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && target.closest(".placement-toolbar")) {
    return;
  }

  const local = localPointFromEvent(event);
  if (!pointInRect(local, placement.rect)) {
    return;
  }

  placement.dragStartLocal = clampToPlacementRect(local, placement.rect);
  placement.pointerId = event.pointerId;
  if (el.placementLayer.setPointerCapture) {
    el.placementLayer.setPointerCapture(event.pointerId);
  }

  setPlacementPreviewBox({
    left: placement.dragStartLocal.x,
    top: placement.dragStartLocal.y,
    width: 1,
    height: 1
  });
  event.preventDefault();
});

el.placementLayer.addEventListener("pointermove", (event) => {
  const placement = state.placement;
  if (!placement) {
    return;
  }

  if (placement.mode === "highlight" && placement.dragStartLocal) {
    if (placement.pointerId !== null && event.pointerId !== placement.pointerId) {
      return;
    }
    const localRect = localRectFromPoints(placement.dragStartLocal, localPointFromEvent(event), placement.rect);
    setPlacementPreviewBox(localRect);
    return;
  }

  if (placement.committing || placement.mode === "highlight") {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && target.closest(".placement-toolbar")) {
    return;
  }

  const local = localPointFromEvent(event);
  if (!pointInRect(local, placement.rect)) {
    el.placementPreviewBox.classList.remove("visible");
    return;
  }

  previewPlacementAtPoint(placement, local);
});

el.placementLayer.addEventListener("pointerup", (event) => {
  const placement = state.placement;
  if (!placement || placement.mode !== "highlight" || placement.committing || !placement.dragStartLocal) {
    return;
  }
  if (placement.pointerId !== null && event.pointerId !== placement.pointerId) {
    return;
  }

  const localRect = localRectFromPoints(placement.dragStartLocal, localPointFromEvent(event), placement.rect);
  placement.dragStartLocal = null;
  placement.pointerId = null;

  if (el.placementLayer.releasePointerCapture) {
    try {
      el.placementLayer.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // pointer was already released
    }
  }

  if (localRect.width < 4 || localRect.height < 4) {
    el.placementPreviewBox.classList.remove("visible");
    el.placementHint.textContent = "Highlight area too small. Drag a larger region.";
    return;
  }

  const pdfRect = localRectToPdfRect(localRect, placement.rect, placement.pageSize);
  void commitPlacement(async (active) => {
    await api(`/api/docs/${active.docId}/highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: active.page,
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
        color: String(active.payload?.color || "#ffe16b"),
        opacity: Number(active.payload?.opacity || 0.35)
      })
    });
  }, "Highlight added.");
});

el.placementLayer.addEventListener("pointercancel", () => {
  const placement = state.placement;
  if (!placement) {
    return;
  }
  placement.dragStartLocal = null;
  placement.pointerId = null;
  if (placement.mode === "highlight") {
    el.placementPreviewBox.classList.remove("visible");
  }
});

el.placementLayer.addEventListener("click", (event) => {
  const placement = state.placement;
  if (!placement || placement.mode === "highlight" || placement.committing) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && target.closest(".placement-toolbar")) {
    return;
  }

  const local = localPointFromEvent(event);
  if (!pointInRect(local, placement.rect)) {
    return;
  }

  const { anchor, boxPdf } = previewPlacementAtPoint(placement, local);
  const pdfBoxPos = topLeftPlacementToPdf(placement, anchor, boxPdf);

  if (placement.mode === "signature") {
    void commitPlacement(async (active) => {
      const payload = active.payload || {};
      await api(`/api/docs/${active.docId}/add-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: active.page,
          x: pdfBoxPos.x,
          y: pdfBoxPos.y,
          width: boxPdf.width,
          height: boxPdf.height,
          imageBase64: String(payload.imageBase64 || "")
        })
      });
      el.signatureForm.reset();
      setSignatureAppearanceMode("draw");
      clearSignaturePad();
      renderSignatureAppearanceMode();
    }, "Electronic signature placed.");
    return;
  }

  const baselineY = Math.min(
    placement.pageSize.height,
    Math.max(0, pdfBoxPos.y + boxPdf.height - (boxPdf.fontSize || 14))
  );

  void commitPlacement(async (active) => {
    await api(`/api/docs/${active.docId}/add-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: active.page,
        x: pdfBoxPos.x,
        y: baselineY,
        text: String(active.payload?.text || ""),
        fontSize: Number(active.payload?.fontSize || 14),
        fontFamily: String(active.payload?.fontFamily || "helvetica"),
        color: String(active.payload?.color || "#111111"),
        bold: Boolean(active.payload?.bold),
        italic: Boolean(active.payload?.italic),
        underline: Boolean(active.payload?.underline)
      })
    });
  }, "Text added.");
});

el.extractTextForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withSelectedDoc(async (doc) => {
    const result = await api(`/api/docs/${doc.id}/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: el.extractPagesInput.value.trim() || null })
    });

    el.extractedText.value = result.text || "";
    showToast(`Extracted ${result.charCount} characters.`);
  });
});

el.workspaceFiles.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const downloadId = target.dataset.downloadId;
  if (!downloadId) {
    return;
  }

  const file = state.workspaceFiles.find((entry) => entry.id === downloadId);
  if (!file) {
    return;
  }
  triggerDownload(file);
});

el.pdfScroll.addEventListener("scroll", () => {
  syncPlacementPageInputs();
});

el.newAnalysisWindow.addEventListener("click", () => {
  createAnalysisWindow();
});

function togglePane(edge) {
  if (edge === "left") {
    state.layout.leftCollapsed = !state.layout.leftCollapsed;
  } else {
    state.layout.rightCollapsed = !state.layout.rightCollapsed;
  }
  renderPaneLayoutState();
  schedulePdfViewerRender();
}

el.leftPaneToggle.addEventListener("click", () => {
  togglePane("left");
});

el.rightPaneToggle.addEventListener("click", () => {
  togglePane("right");
});

el.leftPaneEdgeToggle.addEventListener("click", () => {
  togglePane("left");
});

el.rightPaneEdgeToggle.addEventListener("click", () => {
  togglePane("right");
});

el.zoomOutBtn.addEventListener("click", () => {
  setViewerZoom(state.viewerZoom - 0.1);
});

el.zoomFitBtn.addEventListener("click", () => {
  state.viewerZoom = 1;
  renderViewerControls();
  schedulePdfViewerRender();
});

el.zoomInBtn.addEventListener("click", () => {
  setViewerZoom(state.viewerZoom + 0.1);
});

el.pagePrevBtn.addEventListener("click", () => {
  scrollViewerToPage(state.viewerPage - 1);
});

el.pageNextBtn.addEventListener("click", () => {
  scrollViewerToPage(state.viewerPage + 1);
});

el.pageJumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  scrollViewerToPage(normalizePageJumpInput(), "auto");
});

el.pageJumpInput.addEventListener("blur", () => {
  normalizePageJumpInput();
});

el.undoBtn.addEventListener("click", async () => {
  await withSelectedDoc(async (doc) => {
    await api(`/api/docs/${doc.id}/undo`, { method: "POST" });
    await loadDocs(true);
    markPdfDirty();
    showToast("Undo applied.");
  });
});

el.redoBtn.addEventListener("click", async () => {
  await withSelectedDoc(async (doc) => {
    await api(`/api/docs/${doc.id}/redo`, { method: "POST" });
    await loadDocs(true);
    markPdfDirty();
    showToast("Redo applied.");
  });
});

el.rotateViewLeft.addEventListener("click", () => {
  rotateViewer(-90);
});

el.rotateViewRight.addEventListener("click", () => {
  rotateViewer(90);
});

el.editModule.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const panelId = target.dataset.toolPanelTarget;
  if (!panelId || panelId === state.activeToolPanel) {
    return;
  }

  state.activeToolPanel = panelId;
  renderToolPanelState();
});

el.leftPaneResizer.addEventListener("mousedown", (event) => {
  if (state.layout.leftCollapsed) {
    return;
  }
  startPaneResize("left", event);
});

el.rightPaneResizer.addEventListener("mousedown", (event) => {
  if (state.layout.rightCollapsed) {
    return;
  }
  startPaneResize("right", event);
});

el.analysisWindows.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const windowId = target.dataset.windowId;
  const field = target.dataset.windowField;
  if (!windowId || !field) {
    return;
  }

  const entry = findCurrentWindow(windowId);
  if (!entry) {
    return;
  }

  if (target instanceof HTMLInputElement && field === "title") {
    entry.title = target.value || "Untitled";
  }

  if (target instanceof HTMLTextAreaElement && field === "draft") {
    entry.draft = target.value;
  }

  if (target instanceof HTMLSelectElement && field === "model") {
    entry.model = target.value || state.defaultModel;
  }
});

el.analysisWindows.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const windowId = target.dataset.windowId;
  if (!action || !windowId) {
    return;
  }

  const windows = currentWindows();
  const idx = windows.findIndex((entry) => entry.id === windowId);
  if (idx < 0) {
    return;
  }

  if (action === "close-window") {
    windows.splice(idx, 1);
    renderAnalysisWindows();
    return;
  }

  if (action === "toggle-window") {
    windows[idx].minimized = !windows[idx].minimized;
    renderAnalysisWindows();
  }
});

el.analysisWindows.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  if (!form.classList.contains("analysis-form")) {
    return;
  }

  event.preventDefault();
  const windowId = form.dataset.windowId;
  if (!windowId) {
    return;
  }

  await runWindowAnalysis(windowId);
});

el.analysisWindows.addEventListener("keydown", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (!target.classList.contains("analysis-input")) {
    return;
  }

  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    const form = target.closest("form");
    if (form && form instanceof HTMLFormElement) {
      const windowId = form.dataset.windowId;
      if (windowId) {
        await runWindowAnalysis(windowId);
      }
    }
  }
});

el.analysisWindows.addEventListener("mousedown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const resizeHandle = target.closest(".window-resize-handle");
  if (resizeHandle instanceof HTMLElement && resizeHandle.dataset.windowId) {
    startWindowInteraction("resize", resizeHandle.dataset.windowId, event);
    return;
  }

  const card = target.closest(".analysis-window");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const entry = findCurrentWindow(card.dataset.windowId || "");
  if (entry) {
    bringWindowToFront(entry);
    card.style.zIndex = String(entry.z);
  }

  const head = target.closest(".window-head");
  if (!(head instanceof HTMLElement)) {
    return;
  }

  if (target.closest("input,select,textarea,button,a")) {
    return;
  }

  if (card.dataset.windowId) {
    startWindowInteraction("move", card.dataset.windowId, event);
  }
});

document.addEventListener("mousemove", (event) => {
  updatePaneResize(event);
  updateWindowInteraction(event);
});

document.addEventListener("mouseup", () => {
  stopPaneResize();
  stopWindowInteraction();
});

(async function init() {
  setSignatureAppearanceMode(el.signatureAppearanceInputs.find((input) => input.checked)?.value || "draw");
  renderPaneLayoutState();
  renderToolPanelState();
  renderViewerControls();
  initSignaturePad();
  renderSignatureAppearanceMode();
  renderFormsPanel();
  renderEditLockState();
  renderSignaturePanel();

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => {
      schedulePdfViewerRender();
    });
    resizeObserver.observe(el.pdfStage);
  } else {
    window.addEventListener("resize", schedulePdfViewerRender);
  }

  try {
    await Promise.all([loadAccount(), loadModels(), loadDocs(false)]);
    renderAnalysisWindows();
  } catch (error) {
    showToast(error.message, 5000);
    state.account = null;
    el.accountStatus.textContent = error.message;
    el.loginBtn.textContent = "Sign In";
  }
})();

for (const input of el.signatureAppearanceInputs) {
  input.addEventListener("change", () => {
    setSignatureAppearanceMode(input.value);
    renderSignatureAppearanceMode();
  });
}

for (const input of [el.signatureAppearanceText]) {
  if (input instanceof HTMLInputElement) {
    input.addEventListener("input", () => {
      renderSignaturePreview();
    });
  }
}
