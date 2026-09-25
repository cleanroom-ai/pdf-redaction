import * as ort from "../vendor/ort/ort.wasm.min.mjs";
import { createEngineCache, configureOrt } from "../vendor/core/engines.js";
import { scan } from "../vendor/core/pipeline.js";
import { findSpans, mergeSpans } from "../vendor/core/rules.js";
import { rowSpanBox } from "./pdf-text.js";

const BASE = new URL("../", import.meta.url);
const WASM_PATH = new URL("vendor/ort/", BASE).href;
configureOrt(ort, WASM_PATH);

const post = (msg) => self.postMessage(msg);
const cache = createEngineCache({
  ort,
  base: BASE,
  wasmPath: WASM_PATH,
  onProgress: (p) => post({ type: "download", ...p }),
  importTransformers: () => import("../vendor/transformers.web.min.js"),
});

let nerPromise = null;
const loadNer = () => (nerPromise ??= cache.ner());

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === "warmup") {
      post({ type: "ready", part: "core" });
      return;
    }
    if (msg.type === "scanText") {
      const t0 = performance.now();
      const cats = new Set(msg.options.categories);
      const nerCats = new Set([...cats].filter((c) => ["person", "location", "government_id", "financial"].includes(c)));
      let ner = null;
      if (msg.options.useNer && nerCats.size) {
        post({ type: "progress", id: msg.id, text: "Loading the name/address model…" });
        ner = await loadNer().catch((e) => {
          post({ type: "warning", id: msg.id, text: `Name/address model unavailable (${e.message}); using rules only.` });
          return null;
        });
      }
      const detections = [];
      let timings = { rules: 0 };
      for (const row of msg.rows) {
        const ruleSpans = findSpans(row.text, [...cats], msg.options.customTerms || []);
        const nerSpans = ner ? await ner.find(row.text, nerCats) : [];
        for (const s of mergeSpans(ruleSpans, nerSpans)) {
          detections.push({ category: s.category, label: s.label, box: rowSpanBox(row, s.start, s.end), score: s.score, source: s.source, text: row.text.slice(s.start, s.end) });
        }
      }
      timings.rules = performance.now() - t0;
      post({ type: "result", id: msg.id, detections, timings, lines: msg.rows.length });
      return;
    }
    if (msg.type === "scanImage") {
      post({ type: "progress", id: msg.id, text: "Running OCR on this page…" });
      const engines = { ocr: await cache.ocr() };
      if (msg.options.useNer) {
        post({ type: "progress", id: msg.id, text: "Loading the name/address model…" });
        engines.ner = await loadNer().catch((e) => {
          post({ type: "warning", id: msg.id, text: `Name/address model unavailable (${e.message}); using rules only.` });
          return null;
        });
      }
      const result = await scan(msg.image, engines, { ...msg.options, onProgress: (text) => post({ type: "progress", id: msg.id, text }) });
      post({ type: "result", id: msg.id, detections: result.detections, timings: result.timings, lines: result.lines.length });
    }
  } catch (err) {
    post({ type: "error", id: msg.id, text: err?.message || String(err) });
  }
};
