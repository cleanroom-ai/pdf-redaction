import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { findSpans } from "@cleanroom-ai/core/src/rules.js";
import { detectorRows, textItemsToLines, itemToLine, groupTextItems, rowSpanBox } from "../js/pdf-text.js";
import { createRedactedPdf, PDF_PRODUCER } from "../js/export-pdf.js";
import { countExtractableText } from "../js/verify.js";
import { PDFDocument } from "pdf-lib";

const root = new URL("../", import.meta.url);
const loadPdf = async (name) => pdfjsLib.getDocument({ data: new Uint8Array(await readFile(new URL(`examples/${name}`, root))), disableWorker: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;

test("maps PDF text items to proportional per-character boxes", () => {
  const viewport = { scale: 2, transform: [2, 0, 0, -2, 0, 400] };
  const item = { str: "Secret", transform: [12, 0, 0, 12, 50, 100], width: 60, height: 12, dir: "ltr" };
  const line = itemToLine(item, 0, viewport, pdfjsLib);
  assert.equal(line.bounds.length, 6);
  assert.ok(Math.abs(line.box.x0 - 100) < 0.01);
  assert.ok(Math.abs(line.box.x1 - 220) < 0.01);
  const secret = rowSpanBox({ text: "Secret", parts: [{ line, offset: 0 }] }, 0, 6);
  assert.ok(secret.x0 <= line.box.x0);
  assert.ok(secret.x1 >= line.box.x1);
});

test("groups neighboring text items into lines", () => {
  const lines = groupTextItems([
    { text: "Email:", box: { x0: 10, y0: 20, x1: 50, y1: 32 }, bounds: [[0, 1]] },
    { text: "ava@example.test", box: { x0: 58, y0: 21, x1: 170, y1: 33 }, bounds: [[0, 1]] },
    { text: "SSN:", box: { x0: 10, y0: 60, x1: 40, y1: 72 }, bounds: [[0, 1]] },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Email: ava@example.test");
});

test("detector rows join adjacent split secrets and map boxes to both parts", () => {
  const first = { text: "Token: " + "gh" + "p_QAedgeToken123456", box: { x0: 10, y0: 10, x1: 210, y1: 30 }, bounds: [], index: 1 };
  const second = { text: "7890abcdefABCD1234567890", box: { x0: 10, y0: 38, x1: 250, y1: 58 }, bounds: [], index: 2 };
  const rows = detectorRows([
    { text: first.text, box: first.box, parts: [{ line: first, offset: 0 }] },
    { text: second.text, box: second.box, parts: [{ line: second, offset: 0 }] },
  ]);
  const detections = rows.flatMap((row) => findSpans(row.text).map((s) => ({ row, span: s })));
  const hit = detections.find((d) => d.span.label === "GITHUB_TOKEN");
  assert.ok(hit, "split GitHub token should be detected in a joined detector row");
  const box = rowSpanBox(hit.row, hit.span.start, hit.span.end);
  assert.ok(box.y0 <= first.box.y0 && box.y1 >= second.box.y1, `box should cover both lines: ${JSON.stringify(box)}`);
});

test("detector rows join wrapped email columns without injecting spaces", () => {
  const a = { text: "wrap.split@", box: { x0: 10, y0: 10, x1: 110, y1: 30 }, bounds: [], index: 1 };
  const b = { text: "example.test", box: { x0: 360, y0: 10, x1: 470, y1: 30 }, bounds: [], index: 2 };
  const rows = detectorRows([a, b]);
  const hit = rows.flatMap((row) => findSpans(row.text).map((s) => ({ row, span: s }))).find((d) => d.span.label === "EMAIL");
  assert.ok(hit, "split email should be detected across adjacent columns");
  const box = rowSpanBox(hit.row, hit.span.start, hit.span.end);
  assert.ok(box.x0 <= a.box.x0 && box.x1 >= b.box.x1);
});

test("detects rule-based PII in text-layer examples", async () => {
  const pdf = await loadPdf("fake-invoice.pdf");
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const rows = textItemsToLines(await page.getTextContent(), viewport, pdfjsLib);
  const labels = new Set();
  for (const row of rows) for (const s of findSpans(row.text)) labels.add(s.label);
  for (const label of ["EMAIL", "PHONE", "US_SSN", "IBAN", "CREDIT_CARD", "ROUTING_NUMBER", "PERSON"]) {
    assert.ok(labels.has(label), `missing ${label}; saw ${[...labels].join(", ")}`);
  }
});

test("detects live text underneath fake black boxes", async () => {
  const pdf = await loadPdf("hidden-text-trap.pdf");
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const rows = textItemsToLines(await page.getTextContent(), viewport, pdfjsLib);
  const text = rows.map((r) => r.text).join("\n");
  assert.match(text, /jordan\.lee@example\.test/);
  assert.match(text, /321-54-9876/);
  const labels = rows.flatMap((r) => findSpans(r.text).map((s) => s.label));
  assert.ok(labels.includes("EMAIL"));
  assert.ok(labels.includes("US_SSN"));
});

test("redacted export is flattened, textless, and strips metadata", async () => {
  const png1x1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));
  const bytes = await createRedactedPdf([{ bytes: png1x1, type: "image/png", widthPt: 200, heightPt: 100 }]);
  const verified = await countExtractableText(pdfjsLib, bytes.slice());
  assert.deepEqual(verified, { pages: 1, chars: 0 });
  const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(loaded.getTitle(), undefined);
  assert.equal(loaded.getAuthor(), undefined);
  assert.equal(loaded.getSubject(), undefined);
  assert.ok(loaded.getKeywords() === undefined || loaded.getKeywords().length === 0);
  assert.equal(loaded.getProducer(), PDF_PRODUCER);
  assert.equal(loaded.getCreator(), PDF_PRODUCER);
  const raw = Buffer.from(bytes).toString("latin1");
  assert.doesNotMatch(raw, /\/Title|\/Author|\/Subject|\/Keywords/);
});
