export const MAX_RENDER_SIDE = 2200;

export function renderScaleForPage(page, maxSide = MAX_RENDER_SIDE, baseScale = 2) {
  const base = page.getViewport({ scale: 1 });
  return Math.min(baseScale, maxSide / Math.max(base.width, base.height));
}

export async function renderPdfPage(page, scale = renderScaleForPage(page), pdfjsLib = null) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // ENABLE_STORAGE draws filled form-field values into the canvas (ENABLE_FORMS leaves widgets to an
  // HTML form layer), so OCR sees them and the flattened export redacts them instead of dropping them.
  const annotationMode = pdfjsLib?.AnnotationMode?.ENABLE_STORAGE ?? 3;
  await page.render({ canvasContext: ctx, viewport, annotationMode }).promise;
  return { canvas, viewport, scale };
}

export function textItemsToLines(textContent, viewport, pdfjsLib) {
  const items = textContent.items
    .map((item, index) => itemToLine(item, index, viewport, pdfjsLib))
    .filter((l) => l.text.trim() && l.box.x1 > l.box.x0 && l.box.y1 > l.box.y0)
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  return groupTextItems(items);
}

export function itemToLine(item, index, viewport, pdfjsLib) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const x = tx[4];
  const y = tx[5];
  const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]) || Math.abs(item.height || 10) * viewport.scale);
  const width = Math.max(Math.abs(item.width || 0) * viewport.scale, estimateWidth(item.str, fontHeight));
  const dir = item.dir || "ltr";
  const box = dir === "rtl"
    ? { x0: x - width, y0: y - fontHeight, x1: x, y1: y + fontHeight * 0.18 }
    : { x0: x, y0: y - fontHeight, x1: x + width, y1: y + fontHeight * 0.18 };
  return { text: item.str, box: normalizeBox(box), bounds: proportionalBounds(item.str), index };
}

function estimateWidth(text, h) {
  return Math.max(1, [...text].length * h * 0.52);
}

export function proportionalBounds(text) {
  const n = text.length;
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => [i / n, (i + 1) / n]);
}

export function groupTextItems(items, maxGapInHeights = 1.8) {
  const rows = [];
  for (const line of items) {
    const h = line.box.y1 - line.box.y0;
    const row = rows.find((r) => {
      const last = r.parts.at(-1).line;
      const lh = last.box.y1 - last.box.y0;
      const overlap = Math.min(last.box.y1, line.box.y1) - Math.max(last.box.y0, line.box.y0);
      const gap = line.box.x0 - last.box.x1;
      return overlap >= 0.45 * Math.min(h, lh) && Math.abs(h - lh) <= 0.7 * Math.max(h, lh) &&
        gap >= -0.5 * h && gap <= maxGapInHeights * Math.max(h, lh);
    });
    if (row) {
      const last = row.parts.at(-1).line;
      const needsSpace = line.box.x0 - last.box.x1 > Math.max(2, 0.15 * h) && !row.text.endsWith(" ") && !line.text.startsWith(" ");
      const offset = row.text.length + (needsSpace ? 1 : 0);
      row.parts.push({ line, offset });
      row.text += (needsSpace ? " " : "") + line.text;
      row.box = union(row.box, line.box);
    } else {
      rows.push({ text: line.text, box: { ...line.box }, parts: [{ line, offset: 0 }] });
    }
  }
  return rows.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

export function rowSpanBox(row, start, end) {
  if (row.charMap?.length) {
    let box = null, active = null;
    const flush = () => {
      if (!active) return;
      const b = spanBox(active.line, active.start, active.end);
      box = box ? union(box, b) : b;
      active = null;
    };
    for (let i = Math.max(0, start); i < Math.min(end, row.charMap.length); i++) {
      const m = row.charMap[i];
      if (!m) { flush(); continue; }
      if (active && active.line === m.line && active.end === m.index) active.end = m.index + 1;
      else { flush(); active = { line: m.line, start: m.index, end: m.index + 1 }; }
    }
    flush();
    if (box) return box;
  }
  let box = null;
  for (const { line, offset } of row.parts) {
    const s = Math.max(start, offset) - offset;
    const e = Math.min(end, offset + line.text.length) - offset;
    if (e <= s) continue;
    const b = spanBox(line, s, e);
    box = box ? union(box, b) : b;
  }
  return box ?? spanBox(row.parts[0].line, 0, 1);
}

export function detectorRows(rows, maxLookahead = 2) {
  const base = rows.map(normalizeDetectorRow).filter((r) => r.text?.trim() && r.box);
  const out = [...base];
  const seen = new Set(out.map(rowKey));
  const ordered = [...base].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const add = (row) => {
    if (!row || !row.text.trim()) return;
    const key = rowKey(row);
    if (!seen.has(key)) { seen.add(key); out.push(row); }
  };
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < Math.min(ordered.length, i + 1 + maxLookahead); j++) {
      add(joinDetectorRows([ordered[i], ordered[j]], ""));
      add(joinDetectorRows([ordered[i], ordered[j]], " "));
      if (/-\s*$/.test(ordered[i].text)) add(joinDetectorRows([ordered[i], ordered[j]], "", { dropTrailingHyphen: true }));
    }
  }
  return out;
}

export function mergeDetectionsByOverlap(detections, threshold = 0.55) {
  const sorted = detections.filter((d) => d?.box).sort((a, b) =>
    (b.score || 0) - (a.score || 0) || a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const kept = [];
  for (const d of sorted) {
    const dup = kept.find((k) => (k.label === d.label || sameText(k.text, d.text)) && overlapRatio(k.box, d.box) >= threshold);
    if (!dup) kept.push(d);
  }
  return kept.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

export function spanBox(line, start, end, padChars = 0.35, padY = 0.10) {
  const n = line.text.length;
  const bounds = line.bounds?.length ? line.bounds : proportionalBounds(line.text);
  start = Math.max(0, Math.min(start, Math.max(0, n - 1)));
  end = Math.max(start + 1, Math.min(end, n));
  let t0 = bounds[start]?.[0] ?? start / Math.max(1, n);
  let t1 = bounds[end - 1]?.[1] ?? end / Math.max(1, n);
  const charW = (t1 - t0) / Math.max(1, end - start);
  t0 = start > 0 ? Math.max(0, t0 - padChars * charW) : Math.min(0, t0 - padChars * charW);
  t1 = end < n ? Math.min(1, t1 + padChars * charW) : Math.max(1, t1 + padChars * charW);
  const w = line.box.x1 - line.box.x0;
  const h = line.box.y1 - line.box.y0;
  return normalizeBox({ x0: line.box.x0 + t0 * w, x1: line.box.x0 + t1 * w, y0: line.box.y0 - padY * h, y1: line.box.y1 + padY * h });
}

const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const normalizeBox = (b) => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

function normalizeDetectorRow(row) {
  if (row.parts?.length) return { ...row, box: row.box || row.parts.reduce((b, p) => b ? union(b, p.line.box) : { ...p.line.box }, null) };
  return { ...row, parts: [{ line: row, offset: 0 }] };
}

function joinDetectorRows(rows, separator, { dropTrailingHyphen = false } = {}) {
  let text = "", charMap = [], sourceRows = [];
  for (let r = 0; r < rows.length; r++) {
    if (r > 0 && separator) {
      for (const ch of separator) { text += ch; charMap.push(null); }
    }
    const { chars, maps } = rowChars(rows[r]);
    let keep = chars.length;
    if (dropTrailingHyphen && r === 0) {
      while (keep > 0 && /\s/.test(chars[keep - 1])) keep--;
      if (chars[keep - 1] === "-") keep--;
    }
    for (let i = 0; i < keep; i++) {
      text += chars[i];
      charMap.push(maps[i]);
    }
    sourceRows.push(rows[r]);
  }
  return {
    text,
    charMap,
    synthetic: true,
    box: sourceRows.reduce((b, r) => b ? union(b, r.box) : { ...r.box }, null),
    parts: sourceRows.flatMap((r) => r.parts),
  };
}

function rowChars(row) {
  const chars = [...row.text];
  const maps = Array.from({ length: chars.length }, () => null);
  for (const { line, offset } of row.parts || []) {
    for (let i = 0; i < line.text.length && offset + i < maps.length; i++) maps[offset + i] = { line, index: i };
  }
  return { chars, maps };
}

function rowKey(row) {
  const b = row.box || {};
  return `${row.text}\0${Math.round(b.x0)}:${Math.round(b.y0)}:${Math.round(b.x1)}:${Math.round(b.y1)}`;
}

function overlapRatio(a, b) {
  const x = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const y = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = x * y;
  const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  return inter / Math.min(areaA, areaB);
}

const sameText = (a = "", b = "") => a && b && a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
