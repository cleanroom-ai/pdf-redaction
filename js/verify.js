export async function countExtractableText(pdfjsLib, data) {
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;
  let chars = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent({ disableNormalization: false });
    for (const item of text.items) chars += (item.str || "").length;
  }
  return { pages: pdf.numPages, chars };
}
