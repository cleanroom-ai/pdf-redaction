import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { openApp } from "@cleanroom-ai/core/testing/browser.mjs";

const base = process.argv[2] || "http://127.0.0.1:8090/";
const shotsDir = fileURLToPath(new URL("../.cache/e2e/", import.meta.url));
mkdirSync(shotsDir, { recursive: true });
const app = await openApp(base, { shotsDir });
const { page, shot } = app;

await page.locator("#engine[data-kind=ok]").waitFor({ timeout: 60_000 });
await app.assertLogo();
console.log(`engine ready in ${app.elapsed()}s | crossOriginIsolated=${await page.evaluate(() => crossOriginIsolated)}`);
await page.locator("#use-ner").uncheck({ timeout: 1000 }).catch(() => {});

async function labels() {
  return page.locator("#detections li .name").allInnerTexts();
}
async function scanExample(name, expected) {
  if (await page.locator("#reset").isVisible()) await page.locator("#reset").click();
  const start = Date.now();
  await page.getByRole("button", { name }).click();
  await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 180_000 });
  const status = await page.locator("#status").innerText();
  const items = await labels();
  console.log(`\n${name}: ${status} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.log("  " + items.join(" | "));
  for (const label of expected) assert.ok(items.some((i) => i.includes(label)), `${name}: missing ${label}; saw ${items.join(" | ")}`);
  await shot(name.replace(/\W+/g, "_"));
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
await page.locator("#verify[data-kind=ok], #verify[data-kind=warn]").waitFor({ timeout: 60_000 });
console.log(`\ndownload: ${download.suggestedFilename()}`);
const verifyText = await page.locator("#verify").innerText();
console.log(verifyText);
assert.match(verifyText, /0 characters/);
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

app.external.splice(0, app.external.length, ...app.external.filter((u) => !u.startsWith("edge://")));
await app.finish();




process.exit(0);
