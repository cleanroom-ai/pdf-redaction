import { writeFile, mkdir } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright-core";

const outDir = new URL("../examples/", import.meta.url);
await mkdir(outDir, { recursive: true });

async function makeTextPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw = (text, x, y, size = 12, f = font) => page.drawText(text, { x, y, size, font: f, color: rgb(0.08, 0.1, 0.16) });
  draw("Contoso HR reimbursement letter", 72, 720, 20, bold);
  draw("All data in this synthetic sample is fake.", 72, 694, 10);
  draw("Name: Ava Stone", 72, 650);
  draw("Email: ava.stone@example.test", 72, 626);
  draw("Phone: (415) 555-0198", 72, 602);
  draw("Mailing address: 123 Maple Street, Springfield, CA 94043", 72, 578);
  draw("SSN: 123-45-6789", 72, 548);
  draw("IBAN: GB82 WEST 1234 5698 7654 32", 72, 524);
  draw("Corporate card: 4111 1111 1111 1111", 72, 500);
  draw("Routing: 021000021", 72, 476);
  draw("Please process this invoice for the employee above.", 72, 434);
  await writeFile(new URL("fake-invoice.pdf", outDir), await pdf.save());
}

async function makeHiddenTrapPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Hidden text trap", { x: 72, y: 720, size: 22, font: bold });
  page.drawText("This file demonstrates fake redaction: black rectangles drawn over live text.", { x: 72, y: 690, size: 11, font });
  page.drawText("Email: jordan.lee@example.test", { x: 88, y: 630, size: 14, font });
  page.drawText("SSN: 321-54-9876", { x: 88, y: 596, size: 14, font });
  page.drawRectangle({ x: 132, y: 624, width: 220, height: 22, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 121, y: 590, width: 132, height: 22, color: rgb(0, 0, 0) });
  page.drawText("The text under the bars is still selectable in the original.", { x: 72, y: 542, size: 12, font });
  await writeFile(new URL("hidden-text-trap.pdf", outDir), await pdf.save());
}

async function rasterTextPng() {
  let browser;
  for (const launch of [
    () => chromium.launch({ channel: "msedge", headless: true, timeout: 15_000 }),
    () => chromium.launch({ channel: "chrome", headless: true, timeout: 15_000 }),
    () => chromium.launch({ headless: true, timeout: 15_000 }),
  ]) {
    try { browser = await launch(); break; } catch {}
  }
  if (!browser) throw new Error("No Playwright browser available for raster example generation");
  try {
    const page = await browser.newPage({ viewport: { width: 1224, height: 1584 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>
      body{margin:0;background:white;font:30px Arial, sans-serif;color:#111827}.sheet{width:1224px;height:1584px;padding:130px 145px;box-sizing:border-box;background:white}
      h1{font-size:44px;margin:0 0 42px}.line{margin:23px 0}.small{font-size:22px;color:#374151;margin-bottom:42px}
    </style><div class="sheet"><h1>Scanned benefits form</h1><div class="small">Synthetic raster-only page. All values are fake.</div>
      <div class="line">Name: Riley Chen</div><div class="line">Email: riley.chen@example.test</div><div class="line">Phone: +1 206 555 0142</div>
      <div class="line">Address: 742 Cedar Ave, Portland, OR 97035</div><div class="line">SSN: 234-56-7890</div><div class="line">Password: Velvet7River9Token</div>
    </div>`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1224, height: 1584 }, timeout: 30_000 });
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
}

async function makeScannedPdf() {
  const png = await rasterTextPng();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const img = await pdf.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  await writeFile(new URL("scanned-letter.pdf", outDir), await pdf.save());
}

await makeTextPdf();
await makeHiddenTrapPdf();
await makeScannedPdf();
console.log("Wrote examples/*.pdf");
process.exit(0);
