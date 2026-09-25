---
title: PDF Redactor
emoji: 🧼
colorFrom: gray
colorTo: indigo
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: Truly redact PDFs: flatten, verify, in-browser
thumbnail: https://huggingface.co/spaces/cleanroom-ai/pdf-redaction/resolve/main/assets/social-preview.png
models:
  - onnx-community/bert-small-pii-detection-ONNX
  - gravitee-io/bert-small-pii-detection
  - PaddlePaddle/PP-OCRv6_tiny_det
  - PaddlePaddle/PP-OCRv6_tiny_rec
tags:
  - pdf
  - pdf-redaction
  - redaction
  - privacy
  - pii
  - pii-detection
  - anonymization
  - gdpr
  - ocr
  - onnx
  - in-browser
  - privacy-tool
---

# PDF Redactor

[![CI](https://github.com/paragpsawant/pdf-redaction/actions/workflows/ci.yml/badge.svg)](https://github.com/paragpsawant/pdf-redaction/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/Hugging%20Face-Space-yellow)](https://huggingface.co/spaces/cleanroom-ai/pdf-redaction)

<p align="center"><img src="assets/icon.svg" width="112" height="112" alt="PDF Redactor logo"></p>

**Truly redact PDFs — in your browser. Nothing uploaded.**

PDF Redactor finds secrets and personal information in PDFs, lets you review every box, and exports a new flattened PDF: every page is rasterized and black redaction boxes are burned into pixels. The result has no hidden text layer, metadata, annotations, attachments, JavaScript, or form fields.

## Why

Drawing black rectangles over a PDF often leaves the original text selectable and copyable underneath. This app demonstrates true redaction by destroying the PDF structure and keeping only page images.

## Features

- Drop, choose, paste, or open bundled fake example PDFs.
- Detects emails, phones, SSNs, cards, IBANs, bank/routing numbers, secrets, names, addresses, dates, IPs, and custom terms.
- Uses PDF.js text extraction when available; falls back to in-browser PP-OCRv6 for scanned pages.
- Optional in-browser PII name/address model.
- Page thumbnails, numbered review boxes, checkboxes, and manual drag-to-redact boxes.
- Exports with pdf-lib as flattened page images.
- Re-opens the export with PDF.js and shows `✓ Verified: 0 characters of text remain`.
- Strict CSP, no CDN, no analytics, no uploads.

## How it works

```
PDF ─► PDF.js render + text layer ─► rules + optional PII model ─┐
    └─► OCR fallback for scanned pages ───────────────────────────┤
            character spans → page pixel boxes → review → burn black boxes
            → pdf-lib image-only PDF → PDF.js verification (zero text)
```

Only black boxes are offered because blur and pixelation can sometimes be reversed for text.

## Run locally

```bash
npm ci
npm run vendor
npm test
npm run serve
```

Then open <http://127.0.0.1:7860/> (or set `PORT=8101`).

To regenerate the synthetic examples:

```bash
npm run examples
```

## CI/CD

CI installs Node 24, vendors all runtime libraries and models locally, runs Node tests, then runs a real-browser E2E test that fails on third-party requests or uploads. The deploy workflow uploads the static app to the Hugging Face Space only when `HF_TOKEN` is configured by the publisher.

## Limitations

- OCR can miss tiny, blurry, rotated, handwritten, or stylized text. Always review and draw boxes for anything missed.
- The name/address model is small and English-oriented; untick false positives.
- Flattening converts pages to images, so links and selectable text are intentionally removed.

## Author

Built by **Parag Sawant** ([@paragpsawant](https://github.com/paragpsawant) · [parags.dev](https://parags.dev) · [LinkedIn](https://www.linkedin.com/in/paragsawant/)).

## Credits & licenses

Apache-2.0. Uses PDF.js, pdf-lib, ONNX Runtime Web, transformers.js, PP-OCRv6, and bert-small-pii. License texts are in `licenses/` and model licenses are generated under `models/LICENSES/` by `npm run vendor`.
