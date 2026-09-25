import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { CATEGORY_COLORS, renderReview } from "../vendor/core/redact.js";
import { CATEGORIES, DEFAULT_CATEGORIES, maskPreview, prettyLabel } from "../vendor/core/rules.js";
import { renderPdfPage, renderScaleForPage, textItemsToLines } from "./pdf-text.js";
import { buildRedactedPdfFromState } from "./export-pdf.js";
import { countExtractableText } from "./verify.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const SUPPORTED_CATEGORIES = Object.keys(CATEGORIES).filter((c) => !["faces", "codes"].includes(c));
const MIN_TEXT_CHARS = 12;
const $ = (sel) => document.querySelector(sel);

const els = {
  drop: $("#drop"), file: $("#file"), workspace: $("#workspace"), status: $("#status"), engine: $("#engine"),
  review: $("#review"), cats: $("#categories"), terms: $("#terms"), useNer: $("#use-ner"), rescan: $("#rescan"),
  reset: $("#reset"), download: $("#download"), list: $("#detections"), listEmpty: $("#detections-empty"),
  selectAll: $("#select-all"), selectNone: $("#select-none"), thumbs: $("#thumbs"), pageCount: $("#page-count"),
  prev: $("#prev-page"), next: $("#next-page"), pageLabel: $("#page-label"), verify: $("#verify"), report: $("#report"),
};

const state = { pdfBytes: null, fileName: "document", pages: [], current: 0, selected: new Set(), nextId: 1, busy: false, requestId: 0, lastScanMs: 0 };
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const pending = new Map();
const downloads = new Map();

worker.onmessage = ({ data: m }) => {
  if (m.type === "download") {
    downloads.set(m.label, m);
    const loaded = [...downloads.values()].reduce((a, d) => a + (d.loaded || 0), 0);
    const total = [...downloads.values()].reduce((a, d) => a + (d.total || 0), 0);
    if (total && loaded < total) setEngine(`Downloading on-device models… ${mb(loaded)} / ${mb(total)} MB (one time)`);
  } else if (m.type === "ready") {
    setEngine("✓ Engine ready — works offline", "ok");
  } else if (m.type === "progress") {
    setStatus(m.text, "busy");
  } else if (m.type === "warning") {
    setStatus(m.text, "warn");
  } else if (m.type === "result" || m.type === "error") {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.type === "result" ? p.resolve(m) : p.reject(new Error(m.text));
  }
};
worker.onerror = (e) => setEngine(`Engine failed to start: ${e.message || "unknown error"}`, "warn");
worker.postMessage({ type: "warmup" });

function workerCall(message, transfer = []) {
  const id = ++state.requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });
}

for (const [key, desc] of Object.entries(CATEGORIES)) {
  if (!SUPPORTED_CATEGORIES.includes(key)) continue;
  const label = document.createElement("label");
  const cb = Object.assign(document.createElement("input"), { type: "checkbox", value: key, checked: DEFAULT_CATEGORIES.includes(key) });
  const dot = Object.assign(document.createElement("span"), { className: "dot" });
  dot.style.background = CATEGORY_COLORS[key];
  label.append(cb, dot, Object.assign(document.createElement("span"), { textContent: desc }));
  els.cats.append(label);
}

els.file.addEventListener("change", () => els.file.files[0] && loadPdfFile(els.file.files[0]));
els.drop.addEventListener("click", (e) => e.target.closest("button, a") || els.file.click());
els.drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), els.file.click()));
for (const target of [document.body]) {
  target.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.classList.add("over"); });
  target.addEventListener("dragleave", (e) => e.relatedTarget || els.drop.classList.remove("over"));
  target.addEventListener("drop", (e) => {
    e.preventDefault(); els.drop.classList.remove("over");
    const f = [...(e.dataTransfer?.files || [])].find(isPdfFile);
    if (f) loadPdfFile(f);
  });
}
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])].find(isPdfFile);
  if (f) { e.preventDefault(); loadPdfFile(f, "pasted-pdf"); }
});
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", async (e) => {
  e.stopPropagation();
  const res = await fetch(b.dataset.example);
  if (!res.ok) return setStatus(`Could not load ${b.dataset.example}`, "warn");
  await loadPdfBytes(await res.arrayBuffer(), b.textContent.trim().toLowerCase().replace(/\W+/g, "-"));
}));

function isPdfFile(f) { return f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || "")); }
async function loadPdfFile(file, fallbackName) {
  if (!isPdfFile(file)) return setStatus("Please choose a PDF file.", "warn");
  await loadPdfBytes(await file.arrayBuffer(), (fallbackName || file.name || "document").replace(/\.pdf$/i, ""));
}

async function loadPdfBytes(buffer, name) {
  if (state.busy) return;
  state.busy = true;
  resetState();
  state.fileName = name || "document";
  state.pdfBytes = new Uint8Array(buffer);
  els.drop.hidden = true;
  els.workspace.hidden = false;
  setVerify("Export a redacted PDF to verify that no text layer remains.");
  setStatus("Opening PDF…", "busy");
  try {
    const pdf = await pdfjsLib.getDocument({ data: state.pdfBytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: true, cMapUrl: "vendor/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "vendor/pdfjs/standard_fonts/" }).promise;
    const t0 = performance.now();
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus(`Rendering page ${i} of ${pdf.numPages}…`, "busy");
      const pdfPage = await pdf.getPage(i);
      const view1 = pdfPage.getViewport({ scale: 1 });
      const { canvas, viewport } = await renderPdfPage(pdfPage, renderScaleForPage(pdfPage));
      const textContent = await pdfPage.getTextContent({ disableNormalization: false });
      const rows = textItemsToLines(textContent, viewport, pdfjsLib);
      const page = { number: i, canvas, widthPt: view1.width, heightPt: view1.height, rows, detections: [], timings: {}, mode: "text" };
      state.pages.push(page);
      await scanPage(page, i, pdf.numPages);
    }
    state.lastScanMs = performance.now() - t0;
    makeThumbs();
    state.current = 0;
    render();
    setStatus(scanSummary(), "ok");
  } catch (err) {
    setStatus(`PDF failed: ${err.message}`, "warn");
  } finally {
    state.busy = false;
    els.rescan.disabled = false;
  }
}

function resetState() {
  state.pages = []; state.selected = new Set(); state.nextId = 1; state.current = 0; state.lastScanMs = 0;
  els.thumbs.replaceChildren(); els.list.replaceChildren(); els.report.textContent = ""; els.file.value = "";
}

async function scanPage(page, index = page.number, total = state.pages.length) {
  const options = currentOptions();
  const textChars = page.rows.reduce((n, r) => n + r.text.trim().length, 0);
  let result;
  if (textChars >= MIN_TEXT_CHARS) {
    page.mode = "text";
    setStatus(`Scanning text layer on page ${index} of ${total}…`, "busy");
    result = await workerCall({ type: "scanText", rows: page.rows, options });
  } else {
    page.mode = "ocr";
    setStatus(`No usable text layer on page ${index}; running OCR…`, "busy");
    const ctx = page.canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, page.canvas.width, page.canvas.height);
    result = await workerCall({ type: "scanImage", image: { data: image.data, width: image.width, height: image.height }, options }, [image.data.buffer]);
  }
  page.timings = result.timings || {};
  page.lines = result.lines || page.rows.length;
  const manual = page.detections.filter((d) => d.source === "you");
  page.detections = [...(result.detections || []), ...manual].map((d) => ({ ...d, page: page.number, id: state.nextId++ }));
  for (const d of page.detections) state.selected.add(d.id);
}

function currentOptions() {
  return {
    categories: [...els.cats.querySelectorAll("input:checked")].map((i) => i.value),
    customTerms: els.terms.value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
    useNer: els.useNer.checked,
  };
}

els.rescan.addEventListener("click", async () => {
  if (!state.pages.length || state.busy) return;
  state.busy = true; els.rescan.disabled = true;
  state.selected = new Set(); state.nextId = 1;
  const t0 = performance.now();
  try {
    for (const page of state.pages) await scanPage(page);
    state.lastScanMs = performance.now() - t0;
    render(); setStatus(scanSummary(), "ok"); setVerify("Export a redacted PDF to verify that no text layer remains.");
  } catch (err) { setStatus(`Scan failed: ${err.message}`, "warn"); }
  finally { state.busy = false; els.rescan.disabled = false; }
});

function makeThumbs() {
  els.thumbs.replaceChildren(...state.pages.map((p, i) => {
    const b = Object.assign(document.createElement("button"), { className: "thumb", type: "button" });
    const c = document.createElement("canvas");
    const scale = 150 / p.canvas.width;
    c.width = 150; c.height = Math.round(p.canvas.height * scale);
    c.getContext("2d").drawImage(p.canvas, 0, 0, c.width, c.height);
    const img = Object.assign(document.createElement("img"), { src: c.toDataURL("image/jpeg", 0.7), alt: `Page ${p.number}` });
    b.append(img, Object.assign(document.createElement("span"), { textContent: `Page ${p.number}` }));
    b.addEventListener("click", () => { state.current = i; render(); });
    return b;
  }));
}

function render() {
  const page = state.pages[state.current];
  els.workspace.hidden = !page;
  if (!page) return;
  renderReview(els.review, page.canvas, page.detections, state.selected, drag.box);
  renderList(page);
  [...els.thumbs.children].forEach((b, i) => b.setAttribute("aria-current", i === state.current ? "true" : "false"));
  els.pageCount.textContent = `${state.pages.length} page${state.pages.length === 1 ? "" : "s"}`;
  els.pageLabel.textContent = `Page ${page.number} / ${state.pages.length}`;
  els.prev.disabled = state.current === 0;
  els.next.disabled = state.current >= state.pages.length - 1;
  els.download.disabled = !state.pages.length || state.busy;
  els.report.textContent = reportText();
}

function renderList(page) {
  els.list.replaceChildren(...page.detections.map((d) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: state.selected.has(d.id) });
    cb.addEventListener("change", () => { cb.checked ? state.selected.add(d.id) : state.selected.delete(d.id); render(); });
    const dot = Object.assign(document.createElement("span"), { className: "dot" });
    dot.style.background = CATEGORY_COLORS[d.category] || "#000";
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: `#${d.id} ${d.source === "you" ? "Your box" : prettyLabel(d.label)}` });
    const prev = Object.assign(document.createElement("span"), { className: "preview", textContent: maskPreview(d.text || "") });
    label.append(cb, dot, name, prev); li.append(label);
    if (d.source === "you") {
      const del = Object.assign(document.createElement("button"), { className: "icon", textContent: "✕", title: "Remove this box" });
      del.addEventListener("click", () => { page.detections = page.detections.filter((x) => x.id !== d.id); state.selected.delete(d.id); render(); });
      li.append(del);
    }
    return li;
  }));
  els.listEmpty.hidden = page.detections.length > 0;
}

const drag = { start: null, box: null };
function toImage(e) {
  const r = els.review.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * els.review.width, y: ((e.clientY - r.top) / r.height) * els.review.height };
}
els.review.addEventListener("pointerdown", (e) => { if (!state.pages.length) return; els.review.setPointerCapture(e.pointerId); drag.start = toImage(e); });
els.review.addEventListener("pointermove", (e) => {
  if (!drag.start) return;
  const p = toImage(e);
  drag.box = { x0: Math.min(p.x, drag.start.x), y0: Math.min(p.y, drag.start.y), x1: Math.max(p.x, drag.start.x), y1: Math.max(p.y, drag.start.y) };
  renderReview(els.review, state.pages[state.current].canvas, state.pages[state.current].detections, state.selected, drag.box);
});
els.review.addEventListener("pointerup", () => {
  const b = drag.box; drag.start = drag.box = null;
  const page = state.pages[state.current];
  if (page && b && b.x1 - b.x0 > 4 && b.y1 - b.y0 > 4) {
    const d = { id: state.nextId++, page: page.number, category: "custom", label: "MANUAL", box: b, score: 1, source: "you", text: "" };
    page.detections.push(d); state.selected.add(d.id); setVerify("Redactions changed. Export again to verify the new PDF.");
  }
  render();
});

els.prev.addEventListener("click", () => { state.current = Math.max(0, state.current - 1); render(); });
els.next.addEventListener("click", () => { state.current = Math.min(state.pages.length - 1, state.current + 1); render(); });
els.selectAll.addEventListener("click", () => { for (const d of state.pages[state.current].detections) state.selected.add(d.id); render(); });
els.selectNone.addEventListener("click", () => { for (const d of state.pages[state.current].detections) state.selected.delete(d.id); render(); });
els.reset.addEventListener("click", () => { resetState(); state.pdfBytes = null; els.workspace.hidden = true; els.drop.hidden = false; setStatus(""); setVerify("Export a redacted PDF to verify that no text layer remains."); });
els.download.addEventListener("click", async () => {
  if (!state.pages.length || state.busy) return;
  state.busy = true; els.download.disabled = true;
  setStatus("Flattening redacted pages into a new PDF…", "busy");
  try {
    const bytes = await buildRedactedPdfFromState(state.pages, state.selected);
    setStatus("Verifying exported PDF has no text layer…", "busy");
    const verified = await countExtractableText(pdfjsLib, bytes.slice());
    if (verified.chars === 0) setVerify("✓ Verified: 0 characters of text remain", "ok");
    else setVerify(`⚠ Verification found ${verified.chars} extractable characters`, "warn");
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${state.fileName}-redacted.pdf` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`Downloaded flattened PDF. ${verified.chars === 0 ? "Verified no extractable text remains." : "Review the warning."}`, verified.chars === 0 ? "ok" : "warn");
  } catch (err) { setStatus(`Export failed: ${err.message}`, "warn"); }
  finally { state.busy = false; els.download.disabled = false; }
});

function scanSummary() {
  const count = state.pages.reduce((n, p) => n + p.detections.filter((d) => d.source !== "you").length, 0);
  const secs = (state.lastScanMs / 1000).toFixed(1);
  if (!count) return `No sensitive text found in ${secs}s. Drag boxes over anything you want to remove.`;
  return `Found ${count} item${count === 1 ? "" : "s"} across ${state.pages.length} page${state.pages.length === 1 ? "" : "s"} in ${secs}s. Untick anything you want to keep.`;
}
function reportText() {
  if (!state.pages.length) return "";
  const counts = {};
  let chosen = 0;
  for (const p of state.pages) for (const d of p.detections) if (state.selected.has(d.id)) { counts[d.category] = (counts[d.category] || 0) + 1; chosen++; }
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ");
  const modes = state.pages.map((p) => `p${p.number}: ${p.mode}${p.timings.ocr ? ` OCR ${(p.timings.ocr / 1000).toFixed(1)}s` : ""}`).join(" · ");
  return `${state.pages.length} page${state.pages.length === 1 ? "" : "s"}; ${chosen} selected${cats ? ` (${cats})` : ""}. ${modes}`;
}
function setStatus(text, kind = "") { els.status.textContent = text; els.status.dataset.kind = kind; }
function setEngine(text, kind = "") { els.engine.textContent = text; els.engine.dataset.kind = kind; }
function setVerify(text, kind = "") { els.verify.textContent = text; els.verify.dataset.kind = kind; }
const mb = (b) => (b / 1048576).toFixed(1);
