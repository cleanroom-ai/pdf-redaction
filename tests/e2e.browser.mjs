import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openApp } from "@cleanroom-ai/core/testing/browser.mjs";

const base = process.argv[2] || "http://127.0.0.1:8090/";
const shotsDir = fileURLToPath(new URL("../.cache/e2e/", import.meta.url));
mkdirSync(shotsDir, { recursive: true });
let app;
let finished = false;
try {
  app = await openApp(base, { shotsDir });
  const { page, shot } = app;

  await page.locator("#engine[data-kind=ok]").waitFor({ timeout: 60_000 });
  await app.assertLogo();
  console.log(`engine ready in ${app.elapsed()}s | crossOriginIsolated=${await page.evaluate(() => crossOriginIsolated)}`);
  await page.locator("#use-ner").evaluate((input) => { input.checked = false; input.dispatchEvent(new Event("change", { bubbles: true })); });

  async function labels() {
    return page.locator("#detections li .name").allInnerTexts();
  }
  async function scanExample(name, expected) {
    if (await page.locator("#reset").isVisible()) await page.locator("#reset").click();
    const start = Date.now();
    await page.getByRole("button", { name }).click({ force: true });
    await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 180_000 });
    const status = await page.locator("#status").innerText();
    const items = await labels();
    console.log(`\n${name}: ${status} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    console.log("  " + items.join(" | "));
    for (const label of expected) assert.ok(items.some((i) => i.includes(label)), `${name}: missing ${label}; saw ${items.join(" | ")}`);
    assert.equal(await page.locator("#download").isDisabled(), false, `${name}: download should be enabled after scan`);
    await shot(name.replace(/\W+/g, "_"));
  }

  async function makeMixedPdfWithImageLeak() {
    const pngBase64 = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 900; c.height = 260;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#111827"; ctx.font = "42px Arial, sans-serif";
      ctx.fillText("Image email: image.leak@example.test", 45, 145);
      return c.toDataURL("image/png").split(",")[1];
    });
    const pdf = await PDFDocument.create();
    const page1 = pdf.addPage([612, 360]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page1.drawText("This page has a normal text layer plus a raster image.", { x: 48, y: 310, size: 14, font });
    const image = await pdf.embedPng(Buffer.from(pngBase64, "base64"));
    page1.drawImage(image, { x: 36, y: 60, width: 540, height: 156 });
    const file = join(shotsDir, "mixed-text-plus-image.pdf");
    writeFileSync(file, await pdf.save());
    return file;
  }

  await scanExample("Invoice / HR letter", ["Email", "Phone", "US SSN", "IBAN", "Credit Card"]);
  await scanExample("Scanned PDF", ["Email", "Phone", "US SSN"]);
  await scanExample("Hidden text trap", ["Email", "US SSN"]);

  await page.getByRole("tab", { name: /Review/ }).click().catch(() => {});
  const box = await page.locator("#review").boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.34, { steps: 4 });
  await page.mouse.up();
  assert.ok((await labels()).some((t) => t.includes("Your box")), "manual box should be listed");
  await shot("manual_box");

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  await page.locator("#verify[data-kind=ok], #verify[data-kind=warn]").waitFor({ timeout: 180_000 });
  console.log(`\ndownload: ${download.suggestedFilename()}`);
  const verifyText = await page.locator("#verify").innerText();
  console.log(verifyText);
  assert.match(verifyText, /0 characters/);
  assert.match(verifyText, /OCR found no sensitive content/);
  assert.match(download.suggestedFilename(), /-redacted\.pdf$/);
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const pdf = await pdfjsLib.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;
  let chars = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const text = await (await pdf.getPage(i)).getTextContent();
    chars += text.items.reduce((n, it) => n + (it.str || "").length, 0);
  }
  assert.equal(chars, 0, "downloaded PDF should have no extractable text");
  await download.delete();

  const mixedFile = await makeMixedPdfWithImageLeak();
  if (await page.locator("#reset").isVisible()) await page.locator("#reset").click();
  await page.setInputFiles("#file", mixedFile);
  await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 180_000 });
  const mixedItems = await labels();
  assert.ok(mixedItems.some((i) => i.includes("Email")), `mixed text+image PDF should OCR image email; saw ${mixedItems.join(" | ")}`);
  assert.equal(await page.locator("#download").isDisabled(), false, "mixed PDF download should be enabled after scan");
  await page.locator("#select-none").click();
  const [mixedDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  await page.locator("#verify[data-kind=warn]").waitFor({ timeout: 180_000 });
  assert.match(await page.locator("#verify").innerText(), /OCR-visible detection/);
  await mixedDownload.delete();

  // Filled AcroForm fields are rendered into the page, detected by OCR, and redacted (not silently dropped).
  const formPdf = await PDFDocument.create();
  const formPage = formPdf.addPage([612, 300]);
  const formFont = await formPdf.embedFont(StandardFonts.Helvetica);
  formPage.drawText("Contact form:", { x: 48, y: 240, size: 16, font: formFont });
  const field = formPdf.getForm().createTextField("contact_email");
  field.setText("form.leak@example.test");
  field.addToPage(formPage, { x: 48, y: 170, width: 420, height: 40, font: formFont });
  field.setFontSize(22);
  formPdf.getForm().updateFieldAppearances(formFont);
  const formFile = join(shotsDir, "filled-acroform.pdf");
  writeFileSync(formFile, await formPdf.save());
  await page.locator("#reset").click().catch(() => {});
  await page.setInputFiles("#file", formFile);
  await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 180_000 });
  const formItems = await labels();
  assert.ok(formItems.some((i) => i.includes("Email")), `filled form field email should be detected; saw ${formItems.join(" | ")}`);
  console.log("filled AcroForm field: email detected");

  await app.finish();
  finished = true;

} finally {
  if (!finished && app?.browser?.isConnected()) {
    await Promise.race([app.browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
}
process.exit(0);
