import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const logo = await readFile(new URL("../tests/fixtures/preview.png", import.meta.url));
const imageData = `data:image/png;base64,${logo.toString("base64")}`;
const reference = { file: "/论文/main.tex", line: 42, original: "figures/result.png", start: 10, end: 28 };
const project = {
  mode: "tex", recursive: true, convertedImages: [],
  mainFile: "/论文/main.tex", root: "/论文", texFiles: ["/论文/main.tex", "/论文/chapters/results.tex"],
  undoAvailable: false, warnings: ["未找到 figures/missing.png"],
  images: [
    { id: "plot", path: "/论文/figures/result.png", relativePath: "figures/result.png", format: "png", width: 2400, height: 1600, bytes: 1000000, status: "ready", message: null, references: [reference] },
    { id: "long", path: "/论文/figures/实验装置与磁流体响应结果.png", relativePath: "figures/实验装置与磁流体响应结果.png", format: "png", width: 1200, height: 900, bytes: 300000, status: "ready", message: null, references: [{ ...reference, line: 60 }] },
    { id: "missing", path: null, relativePath: "figures/missing.png", format: "png", width: null, height: null, bytes: null, status: "missing", message: "找不到图片", references: [{ ...reference, line: 75 }] },
  ],
};

// A small vector PDF fixture exercises the real PDF.js canvas renderer.
function pdfFixture() {
  const drawing = "0.08 0.49 0.44 RG 4 w 30 30 m 90 75 l 150 50 l 210 120 l 270 135 l S\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf).toString("base64");
}

await mkdir("screenshots", { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ project, imageData, pdf }) => {
    const callbacks = new Map();
    let sequence = 0;
    let applied = false;
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { const id = ++sequence; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(command, args = {}) {
        if (command === "plugin:event|listen") return ++sequence;
        if (command === "plugin:event|unlisten") return;
        if (command === "plugin:dialog|open") return project.mainFile;
        if (command === "open_project" || command === "refresh_workspace") return { ...project, undoAvailable: applied };
        if (command === "conversion_history") return [{ id: "batch-1", createdAt: 1700000000000, outputDir: "texgo-pdf", dpi: 300, jpegQuality: 90, undone: false, canUndo: true, files: [{ source: "figures/result.png", output: "texgo-pdf/figures/result.pdf", cached: false, error: null }] }];
        if (command === "asset_preview") return args.converted ? { data: pdf, kind: "pdf" } : { data: imageData, kind: "image" };
        if (command === "convert_images") return { images: args.options.imageIds.map((id) => ({ id, pdfPath: `/论文/figures/texgo-pdf/${id}.pdf`, bytes: 5000, cached: false, error: null })), cancelled: false };
        if (command === "preview_changes") return { files: [{ path: project.mainFile, changes: [{ line: 42, before: "figures/result.png", after: "figures/texgo-pdf/plot.pdf" }] }], referenceCount: 1 };
        if (command === "apply_replacements") { applied = true; return { filesChanged: 1, referencesChanged: 1 }; }
        if (command === "undo_replacements") { applied = false; return { filesChanged: 1, referencesChanged: 1 }; }
        throw new Error(`Unexpected fixture command: ${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { project, imageData, pdf: pdfFixture() });
  await page.goto(baseURL);
  const homeOption = page.locator(".home-recursive label");
  const optionBox = await homeOption.boundingBox();
  assert.ok(optionBox.height >= 40, "Recursive option must have a full-height hit area");
  await page.mouse.click(optionBox.x + optionBox.width - 3, optionBox.y + 3);
  assert.equal(await page.getByRole("checkbox", { name: "图片目录包含子目录" }).isChecked(), false);
  await page.getByRole("checkbox", { name: "图片目录包含子目录" }).check();
  await page.screenshot({ path: "screenshots/fixture-home.png", fullPage: true });
  await page.getByRole("button", { name: "打开 .tex 主文件", exact: true }).click();
  await page.getByRole("button", { name: "预览 figures/result.png", exact: true }).waitFor();
  await page.getByRole("img", { name: "原始：figures/result.png", exact: true }).waitFor();
  // Hit the row padding and metadata, not just its filename button.
  const secondPreview = page.getByRole("button", { name: "预览 figures/实验装置与磁流体响应结果.png", exact: true });
  const secondRow = secondPreview.locator("xpath=ancestor::tr");
  for (const column of [1, 2, 3, 4]) {
    await page.getByRole("button", { name: "预览 figures/result.png", exact: true }).click();
    const cell = await secondRow.getByRole("cell").nth(column).boundingBox();
    assert.ok(cell);
    await page.mouse.click(cell.x + cell.width - 4, cell.y + cell.height - 4);
    assert.equal(await secondPreview.getAttribute("aria-pressed"), "true", `Column ${column} padding must activate preview`);
  }
  await page.getByRole("button", { name: "预览 figures/result.png", exact: true }).click();
  const selectCell = await secondRow.getByRole("cell").first().boundingBox();
  await page.mouse.click(selectCell.x + 4, selectCell.y + selectCell.height - 4);
  const secondCheckbox = page.getByRole("checkbox", { name: "选择 figures/实验装置与磁流体响应结果.png", exact: true });
  assert.equal(await secondCheckbox.isChecked(), true, "Selection cell padding must toggle selection");
  assert.equal(await secondPreview.getAttribute("aria-pressed"), "false", "Checkbox must not activate preview");
  await secondCheckbox.uncheck();
  await page.screenshot({ path: "screenshots/fixture-workbench-desktop.png", fullPage: true });
  await page.getByRole("checkbox", { name: "选择 figures/result.png", exact: true }).check();
  await page.getByRole("button", { name: "转换所选图片", exact: true }).click();
  await page.getByRole("radio", { name: "转换后", exact: true }).click();
  await page.locator("canvas").waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.width === 0) return false;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i + 1] > pixels[i] + 20) return true;
    return false;
  });
  await page.screenshot({ path: "screenshots/fixture-converted-pdf.png", fullPage: true });
  const fitted = await page.locator(".pdf-viewport").evaluate((viewport) => {
    const canvas = viewport.querySelector("canvas");
    if (!canvas) return false;
    const page = canvas.getBoundingClientRect();
    return page.height + 32 <= viewport.clientHeight + 1 && page.width + 48 <= viewport.clientWidth + 1;
  });
  assert.equal(fitted, true, "Default PDF preview must fit the whole page without cropping");
  await page.getByRole("button", { name: "预览替换", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认引用替换" });
  await dialog.waitFor();
  await page.screenshot({ path: "screenshots/fixture-replacement-review.png", fullPage: true });
  await dialog.getByRole("button", { name: "应用替换", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "撤销替换", exact: true }).click();
  await page.getByRole("tab", { name: /转换记录/ }).click();
  const summary = page.locator(".history-entry summary");
  const summaryBox = await summary.boundingBox();
  const entryBox = await page.locator(".history-entry").boundingBox();
  assert.ok(summaryBox.width >= entryBox.width - 2, "History expansion must fill the row");
  await page.mouse.click(summaryBox.x + summaryBox.width - 4, summaryBox.y + summaryBox.height / 2);
  assert.equal(await page.locator(".history-entry details").evaluate((details) => details.open), true);
  await page.getByRole("button", { name: "撤销此次转换", exact: true }).click();
  await page.getByRole("dialog", { name: "撤销此次转换？" }).getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator(".history-entry details").evaluate((details) => details.open), true, "Undo action must not collapse history");
  await page.getByRole("tab", { name: "图片", exact: true }).click();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `screenshots/fixture-workbench-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `Workbench overflows at ${width}px`);
    const statusCell = await secondRow.getByRole("cell").last().boundingBox();
    await page.mouse.click(statusCell.x + statusCell.width - 4, statusCell.y + 4);
    assert.equal(await secondPreview.getAttribute("aria-pressed"), "true", `Row padding must remain clickable at ${width}px`);
    await page.getByRole("button", { name: "预览 figures/result.png", exact: true }).click();
  }
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  const recent = page.getByRole("button", { name: "打开最近项目 /论文/main.tex", exact: true });
  const recentBox = await recent.boundingBox();
  await page.mouse.click(recentBox.x + recentBox.width - 4, recentBox.y + recentBox.height - 4);
  await page.getByRole("button", { name: "预览 figures/result.png", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("button", { name: /移除.*main.tex/ }).click();
  await page.getByText("暂无最近记录", { exact: true }).waitFor();

  const touch = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
  const touchPage = await touch.newPage();
  await touchPage.goto(baseURL);
  for (const target of [touchPage.getByRole("button", { name: "打开 .tex 主文件", exact: true }), touchPage.locator(".home-recursive label")]) {
    const box = await target.boundingBox();
    assert.ok(box.height >= 44, "Touch controls must be at least 44px tall");
  }
  await touchPage.screenshot({ path: "screenshots/fixture-home-touch.png", fullPage: true });
  await touch.close();
  assert.deepEqual(errors, [], "Frontend raised browser errors");
  await context.close();
} finally {
  await browser.close();
}
