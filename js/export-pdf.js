import { PDFDocument } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

export const PDF_PRODUCER = "cleanroom-ai PDF Redactor";

export async function createRedactedPdf(pageImages) {
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setProducer(PDF_PRODUCER);
  out.setCreator(PDF_PRODUCER);
  for (const pageImage of pageImages) {
    const page = out.addPage([pageImage.widthPt, pageImage.heightPt]);
    const bytes = pageImage.bytes instanceof Uint8Array ? pageImage.bytes : new Uint8Array(pageImage.bytes);
    const image = pageImage.type === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    page.drawImage(image, { x: 0, y: 0, width: pageImage.widthPt, height: pageImage.heightPt });
  }
  return out.save({ useObjectStreams: false, addDefaultPage: false });
}

export function renderPageRedactions(canvas, detections, selected) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = "#000";
  for (const d of detections) {
    if (!selected.has(d.id)) continue;
    const x = Math.floor(d.box.x0), y = Math.floor(d.box.y0);
    ctx.fillRect(x, y, Math.ceil(d.box.x1) - x, Math.ceil(d.box.y1) - y);
  }
  return out;
}

export async function canvasToBytes(canvas, type = "image/jpeg", quality = 0.92) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildRedactedPdfFromState(pages, selected) {
  const images = [];
  for (const page of pages) {
    const redacted = renderPageRedactions(page.canvas, page.detections, selected);
    images.push({
      bytes: await canvasToBytes(redacted, "image/jpeg", 0.92),
      type: "image/jpeg",
      widthPt: page.widthPt,
      heightPt: page.heightPt,
    });
  }
  return createRedactedPdf(images);
}
