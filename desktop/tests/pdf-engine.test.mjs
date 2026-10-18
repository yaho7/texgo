import assert from "node:assert/strict";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// A self-contained one-page PDF with a red rectangle and a valid xref table.
function fixture() {
  const content = "1 0 0 rg 0 0 100 60 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  source += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source));
}

test("the installed PDF engine parses and renders a real page", async () => {
  const task = getDocument({ data: fixture() });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const surface = pdf.canvasFactory.create(viewport.width, viewport.height);
    try {
      await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport }).promise;
      const [red, green, blue, alpha] = surface.context.getImageData(50, 30, 1, 1).data;
      assert.ok(red > 240 && green < 15 && blue < 15 && alpha === 255);
    } finally { pdf.canvasFactory.destroy(surface); }
  } finally { await task.destroy(); }
});
