import { mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vendorCore, MIT } from "@cleanroom-ai/core/scripts/vendor.mjs";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(import.meta.url);
const pkgDir = (name) => dirname(req.resolve(`${name}/package.json`));
const out = (...p) => join(appDir, ...p);
const copy = (src, dst) => { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); console.log("  ", dst); };

vendorCore({ appDir, models: ["ocr", "pii"], libs: ["ort", "transformers"] });

const pdfjs = pkgDir("pdfjs-dist");
copy(join(pdfjs, "build", "pdf.min.mjs"), out("vendor", "pdfjs", "pdf.min.mjs"));
copy(join(pdfjs, "build", "pdf.worker.min.mjs"), out("vendor", "pdfjs", "pdf.worker.min.mjs"));
cpSync(join(pdfjs, "cmaps"), out("vendor", "pdfjs", "cmaps"), { recursive: true });
cpSync(join(pdfjs, "standard_fonts"), out("vendor", "pdfjs", "standard_fonts"), { recursive: true });
copy(join(pdfjs, "LICENSE"), out("licenses", "pdfjs-dist.txt"));

const pdfLib = pkgDir("pdf-lib");
copy(join(pdfLib, "dist", "pdf-lib.esm.min.js"), out("vendor", "pdf-lib", "pdf-lib.esm.min.js"));
const pdfLibPkg = JSON.parse(readFileSync(join(pdfLib, "package.json"), "utf8"));
writeFileSync(out("licenses", "pdf-lib.txt"), MIT(`pdf-lib ${pdfLibPkg.version}`, "Hopding"));
