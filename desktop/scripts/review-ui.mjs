/**
 * CI-only visual acceptance harness. Native fixtures are injected into the browser
 * before the unmodified production bundle loads; no demo mode enters the app.
 * Run from the UI review workflow after its frontend build and browser install.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("UI review runs on GitHub Actions only; it does not run a local build or browser.");
const desktop = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../ui-review/", import.meta.url);
const origin = "http://127.0.0.1:4173";
const png = await readFile(new URL("../tests/fixtures/review-chart.png", import.meta.url));

// Embed the existing RGB PNG's IDAT stream into a minimal valid PDF. PNG and PDF
// both support this lossless predictor, so no image/PDF generator dependency is needed.
function imagePdf(bytes) {
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, "review fixture must use eight-bit RGB");
  assert.equal(bytes[25], 2, "review fixture must be RGB without alpha");
  assert.equal(bytes[28], 0, "review fixture must not be interlaced");
  const compressed = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("ascii", at + 4, at + 8) === "IDAT") compressed.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  assert.ok(compressed.length, "PNG fixture requires image data");
  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`);
  const image = Buffer.concat(compressed);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >> /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk); length += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks).toString("base64");
}

const source = `data:image/png;base64,${png.toString("base64")}`;
const pdf = imagePdf(png);
const mainFile = "/Users/research/thesis/main.tex";
const projectRoot = "/Users/research/thesis";
const preferences = { language: "zh-CN", startup: "home", autoWatch: false, autoUpdate: false, dpi: 300, jpegQuality: 100, outputDir: "texgo-pdf", allowUnreviewed: false, notifySuccess: true, notifyFailure: true, notifyUnchanged: false, shortcutEnabled: true, shortcut: "CommandOrControl+Alt+Enter", closeAction: "background" };
function reference(name, line = 128) { return { file: `${projectRoot}/chapters/results.tex`, line, original: `figures/${name}`, start: 0, end: name.length }; }
const assets = Array.from({ length: 18 }, (_, index) => {
  const name = index === 0 ? "response-curve.png" : index === 1 ? "architecture.svg" : `experiment-${String(index + 1).padStart(2, "0")}.png`;
  return { id: `image-${index + 1}`, path: `${projectRoot}/figures/${name}`, relativePath: `figures/${name}`, format: name.endsWith("svg") ? "svg" : "png", width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length, status: "ready", canRename: true, ignoreMode: "none", updateAvailable: index > 1 && index < 6, message: null, references: [reference(name, 128 + index), ...(index === 0 ? [reference(name, 231)] : [])] };
});
const problems = [
  { id: "missing", path: null, relativePath: "figures/missing-result.png", format: "png", width: null, height: null, bytes: null, status: "missing", canRename: false, ignoreMode: "none", updateAvailable: false, message: "项目中找不到 LaTeX 引用的图片。", references: [reference("missing-result.png", 46)] },
  { id: "ambiguous", path: null, relativePath: "figures/calibration", format: "", width: null, height: null, bytes: null, status: "ambiguous", canRename: false, ignoreMode: "none", updateAvailable: false, message: "找到多个同名图片，请确认项目使用的文件。", references: [reference("calibration", 72)] },
];
function projectFixture(scenario) {
  const completed = scenario === "completed" || scenario === "review";
  const pendingImageIds = completed ? [] : assets.slice(0, 12).map((image) => image.id);
  const completedImageIds = (completed ? assets : assets.slice(12)).map((image) => image.id);
  const images = completed ? assets : [...assets, ...problems];
  return { stateFingerprint: `visual-fixture-${scenario}`, mainFile, root: projectRoot, texFiles: [mainFile, `${projectRoot}/chapters/results.tex`, `${projectRoot}/appendix.tex`], images, convertedImages: images.filter((image) => completedImageIds.includes(image.id)).map((image) => ({ id: image.id, pdfPath: `${projectRoot}/texgo-pdf/${image.id}.pdf`, bytes: Math.round(png.length * .8), cached: false, error: null })), warnings: [], undoAvailable: true, status: { convertibleImageIds: assets.map((image) => image.id), pendingImages: pendingImageIds.length, pendingReferences: scenario === "review" ? 18 : 0, problemCount: completed ? 0 : problems.length, ignoredCount: 0, completedImages: completedImageIds.length, totalImages: images.length, pendingImageIds, completedImageIds, problemIds: completed ? [] : problems.map((image) => image.id), ignoredImageIds: [], nextAction: scenario === "review" ? "reviewReferences" : completed ? "upToDate" : "convertImages", blockingReason: null } };
}
const history = [
  { id: "images-and-references", createdAt: new Date("2026-10-20T10:42:00Z").getTime(), outputDir: "texgo-pdf", dpi: 300, jpegQuality: 90, files: assets.slice(0, 12).map((image) => ({ source: image.relativePath, output: `texgo-pdf/${image.id}.pdf`, cached: false, error: null })), referencesChanged: 18, filesChanged: 2, undone: false, canUndo: true },
  { id: "references-only", createdAt: new Date("2026-10-20T09:10:00Z").getTime(), outputDir: "texgo-pdf", dpi: 300, jpegQuality: 90, files: [], referencesChanged: 4, filesChanged: 1, undone: false, canUndo: true },
];
const preview = { referenceCount: 18, files: [{ path: `${projectRoot}/chapters/results.tex`, changes: Array.from({ length: 18 }, (_, index) => ({ id: `reference-${index}`, line: 128 + index, before: `\\includegraphics{figures/experiment-${index + 1}.png}`, after: `\\includegraphics{texgo-pdf/image-${index + 1}.pdf}` })) }] };

// This mirrors @tauri-apps/api/mocks.js callback and event contracts. It lives
// only in the review script and never becomes part of a production asset.
function installNativeFixture(fixture) {
  localStorage.clear();
  localStorage.setItem("texgo.recents.v1", JSON.stringify([{ path: fixture.mainFile, openedAt: 1792492920000 }, { path: "/Users/research/paper/paper.tex", openedAt: 1792406520000 }, { path: "/Users/research/report/report.tex", openedAt: 1792320120000 }]));
  const callbacks = new Map(), listeners = new Map(), unexpectedCommands = [], commands = [];
  const basePending = [...fixture.project.status.pendingImageIds];
  const baseProblems = [...fixture.project.status.problemIds];
  const baseCompleted = [...fixture.project.status.completedImageIds];
  function updateClassification() {
    const status = fixture.project.status;
    status.ignoredImageIds = fixture.project.images.filter((image) => image.ignoreMode !== "none").map((image) => image.id);
    status.ignoredCount = status.ignoredImageIds.length;
    status.pendingImageIds = basePending.filter((id) => !status.ignoredImageIds.includes(id));
    status.problemIds = baseProblems.filter((id) => !status.ignoredImageIds.includes(id));
    status.completedImageIds = baseCompleted.filter((id) => !status.ignoredImageIds.includes(id));
    status.pendingImages = status.pendingImageIds.length; status.problemCount = status.problemIds.length; status.completedImages = status.completedImageIds.length;
    status.nextAction = status.pendingReferences ? "reviewReferences" : status.pendingImages ? "convertImages" : status.problemCount ? "resolveProblems" : "upToDate";
  }
  let identifier = 1;
  function unregisterListener(event, id) { listeners.get(event)?.delete(id); callbacks.delete(id); }
  function runCallback(id, data) { callbacks.get(id)?.(data); }
  function emit(event, payload) { for (const id of listeners.get(event) ?? []) runCallback(id, { event, id, payload }); }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    callbacks,
    transformCallback(callback, once = false) { const id = identifier++; callbacks.set(id, (data) => { if (once) callbacks.delete(id); return callback?.(data); }); return id; },
    unregisterCallback(id) { callbacks.delete(id); }, runCallback,
    async invoke(command, args = {}) {
      commands.push({ command, args: structuredClone(args) });
      switch (command) {
        case "plugin:event|listen": if (!listeners.has(args.event)) listeners.set(args.event, new Set()); listeners.get(args.event).add(args.handler); return args.handler;
        case "plugin:event|unlisten": unregisterListener(args.event, args.eventId); return null;
        case "plugin:event|emit": emit(args.event, args.payload); return null;
        case "get_preferences": return structuredClone(fixture.preferences);
        case "save_preferences": return structuredClone(args.preferences);
        case "set_shortcut_recording": return null;
        case "desktop_status": return { error: null };
        case "plugin:dialog|open": return fixture.mainFile;
        case "open_project": case "refresh_workspace": return structuredClone(fixture.project);
        case "close_workspace": return null;
        case "poll_workspace": return null;
        case "ignore_asset": {
          const image = fixture.project.images.find((item) => item.id === args.imageId);
          if (!image || !["none", "session", "permanent"].includes(args.mode)) throw new Error("Ignore fixture requires an explicit known asset and mode");
          image.ignoreMode = args.mode; updateClassification(); return structuredClone(fixture.project);
        }
        case "preview_rename": {
          if (args.expectedFingerprint !== fixture.project.stateFingerprint) throw new Error("Unexpected rename fingerprint");
          const image = fixture.project.images.find(item => item.id === args.imageId);
          if (!image?.canRename) throw new Error("Asset is not renameable");
          const name = image.relativePath.replace(/[^/]+$/, args.newBaseName + image.relativePath.slice(image.relativePath.lastIndexOf(".")));
          const files = new Map();
          image.references.forEach((reference,index) => {
            if (!files.has(reference.file)) files.set(reference.file,{path:reference.file,fingerprint:"fixture-review",changes:[]});
            files.get(reference.file).changes.push({id:`rename-${index}`,line:reference.line,before:reference.original,after:name});
          });
          return {newRelativePath:name,references:{referenceCount:image.references.length,files:[...files.values()]}};
        }
        case "rename_asset": {
          if (args.expectedFingerprint !== fixture.project.stateFingerprint) throw new Error("Unexpected rename fingerprint");
          const image = fixture.project.images.find((item) => item.id === args.imageId);
          if (!image?.canRename) throw new Error("Asset is not renameable");
          const oldImageId = image.id, oldSource = image.relativePath, slash = oldSource.lastIndexOf("/"), oldFilename = oldSource.slice(slash + 1), extension = oldFilename.slice(oldFilename.lastIndexOf("."));
          const newSource = oldSource.slice(0, slash + 1) + args.newBaseName + extension;
          const newImageId = oldImageId + "-renamed";
          image.id = newImageId; image.relativePath = newSource; image.path = fixture.project.root + "/" + newSource;
          image.references = image.references.map((item) => ({ ...item, original: newSource, end: item.start + newSource.length }));
          for (const values of [basePending, baseProblems, baseCompleted, fixture.project.status.convertibleImageIds]) { const index = values.indexOf(oldImageId); if (index >= 0) values[index] = newImageId; }
          const converted = fixture.project.convertedImages.find((item) => item.id === oldImageId);
          const oldPdf = converted?.pdfPath ?? null, newPdf = oldPdf ? fixture.project.root + "/texgo-pdf/" + args.newBaseName + ".pdf" : null;
          if (converted) { converted.id = newImageId; converted.pdfPath = newPdf; }
          fixture.history.unshift({ id: "rename-visual", createdAt: 1792494000000, outputDir: "", dpi: 300, jpegQuality: 90, files: [], undone: false, canUndo: true, rename: { oldSource, newSource, oldPdf, newPdf, referencesChanged: image.references.length } });
          fixture.project.stateFingerprint += "-renamed"; updateClassification();
          return { project: structuredClone(fixture.project), oldImageId, newImageId };
        }
        case "convert_images": {
          if (!["pending", "selected", "reconvert"].includes(args.intent)) throw new Error("Conversion fixture requires an explicit intent");
          const ids = args.options.imageIds;
          if (!ids.length || ids.some((id) => !fixture.project.status.convertibleImageIds.includes(id))) throw new Error("Conversion fixture requires safe source IDs");
          return { images: ids.map((id) => ({ id, pdfPath: fixture.project.root + "/texgo-pdf/" + id + ".pdf", bytes: 1000, cached: false, error: null })), cancelled: false };
        }
        case "conversion_history": return structuredClone(fixture.history);
        case "preview_changes": return structuredClone(fixture.preview);
        case "asset_thumbnail": {
          if (args.expectedMainFile !== fixture.project.mainFile || !fixture.project.images.some(image => image.id === args.imageId)) throw new Error("Invalid thumbnail identity");
          return { kind: "image", data: fixture.source };
        }
        case "asset_preview": return args.converted ? { kind: "pdf", data: fixture.pdf } : { kind: "image", data: fixture.source };
        default: unexpectedCommands.push(command); throw new Error(`UI review has no native fixture for ${command}`);
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener };
  const focusTrace = [];
  for (const type of ["pointerdown", "dblclick", "focusin", "focusout"]) document.addEventListener(type, (event) => {
    const target = event.target;
    focusTrace.push({ type, tag: target?.tagName, label: target?.getAttribute?.("aria-label"), class: String(target?.className ?? "").slice(0, 100) });
    if (focusTrace.length > 50) focusTrace.shift();
  }, true);
  window.__TEXGO_UI_REVIEW__ = { unexpectedCommands, commands, focusTrace, emit, snapshot: () => structuredClone(fixture.project) };
}

await mkdir(output, { recursive: true });
const report = { boundary: "Browser presentation using deterministic LaTeX fixtures; no real Rust file operations.", playwright: "1.64.1", screenshots: [], unexpected: [] };
let serverLog = "", serverExit = null, browser, activePage;
const server = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { cwd: desktop, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
server.once("exit", (code) => { serverExit = code ?? "signal"; });
server.once("error", (error) => { serverExit = error.message; });

async function screenshot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const path = new URL(`${name}.png`, output);
  await page.screenshot({ path: fileURLToPath(path), animations: "disabled" });
  const commands = await page.evaluate(() => window.__TEXGO_UI_REVIEW__.unexpectedCommands);
  assert.deepEqual(commands, [], "Every native call must have an explicit visual fixture");
  assert.deepEqual(report.unexpected, [], "Unexpected browser console or page errors");
  report.screenshots.push({ name, viewport: page.viewportSize() });
}
async function pageFor(scenario = "pending", viewport = { width: 1440, height: 900 }, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion, deviceScaleFactor: 1 });
  await context.addInitScript(installNativeFixture, { mainFile, preferences, project: projectFixture(scenario), history, preview, source, pdf });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", (error) => report.unexpected.push({ kind: "pageerror", message: error.message }));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) report.unexpected.push({ kind: message.type(), message: message.text() }); });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "加快 LaTeX 编译", exact: true }).waitFor();
  return page;
}
async function openProject(page, action = "处理 12 张图片") {
  await page.getByRole("button", { name: "打开或拖入 .tex 文件", exact: true }).click();
  if (action) await page.getByRole("button", { name: action, exact: true }).waitFor();
  else await page.getByRole("button", { name: "输出参数：高质量 · 300 DPI", exact: true }).waitFor();
  await page.locator('.preview-content-frame[data-ready="true"] img').first().waitFor({ state: "visible" });
}

try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverExit !== null) throw new Error(`Vite preview exited: ${serverExit}\n${serverLog}`);
    try { const response = await fetch(origin); if (response.ok) break; } catch { /* wait for the runner's preview server */ }
    if (attempt === 59) throw new Error("Vite preview did not become ready");
    await delay(500);
  }
  browser = await chromium.launch({ headless: true });
  const page = await pageFor();
  await screenshot(page, "01-home-1440");
  await openProject(page);
  assert.equal(await page.getByRole("checkbox").count(), 0, "Checkboxes must be hidden by default");
  await screenshot(page, "02-pending-1440");
  await page.getByRole("button", { name: "更多处理操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "选择图片…", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择 figures/response-curve.png", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择 figures/architecture.svg", exact: true }).check();
  await page.getByRole("button", { name: "处理 2 张图片", exact: true }).waitFor();
  await screenshot(page, "03-selection-1440");
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "问题 2", exact: true }).click();
  await page.getByRole("button", { name: "预览 figures/missing-result.png", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0, "Problem row clicks must not start a dialog");
  await page.getByRole("button", { name: "定位文件", exact: true }).waitFor();
  await screenshot(page, "05-problem-inspector-1440");
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  await page.getByText("更新了 12 张图片", { exact: true }).waitFor();
  await screenshot(page, "06-history-1440");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await screenshot(page, "07-settings-overview-1440");
  await page.getByRole("button", { name: "重新录制", exact: true }).click();
  await page.getByText("正在等待按键…", { exact: true }).waitFor();
  await screenshot(page, "08-shortcut-recording-1440");
  await page.keyboard.press("Control+Alt+K");
  await page.getByRole("button", { name: "重新录制", exact: true }).waitFor();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
  await screenshot(page, "09-settings-saved-1440");

  const completed = await pageFor("completed");
  await openProject(completed, null);
  await completed.getByRole("radio", { name: "对比", exact: true }).click();
  await completed.locator('.pdf-overlay .pdf-canvas-host[aria-busy="false"] canvas').waitFor({ state: "visible" });
  assert.equal(await completed.locator(".comparison-label-left").textContent(), "原图");
  assert.equal(await completed.locator(".comparison-label-right").textContent(), "PDF");
  await screenshot(completed, "04-comparison-original-left-1440");

  const review = await pageFor("review");
  await openProject(review, "检查 18 处引用");
  await review.getByRole("button", { name: "检查 18 处引用", exact: true }).click();
  await review.getByRole("dialog").waitFor();
  await screenshot(review, "10-reference-review-1440");

  const reduced = await pageFor("pending", { width: 1440, height: 900 }, "reduce");
  await openProject(reduced);
  const reducedAnimation = await reduced.locator(".command-message-enter").evaluate((element) => getComputedStyle(element).animationDuration);
  assert.ok(reducedAnimation.split(",").every((value) => Number.parseFloat(value) <= .02), "Reduced motion must shorten animation durations");
  await screenshot(reduced, "11-reduced-motion-1440");

  const compact = await pageFor("pending", { width: 1000, height: 760 });
  await openProject(compact);
  assert.ok(await compact.locator(".command-action").isVisible(), "The primary action must stay visible in a compact desktop window");
  await screenshot(compact, "12-workspace-1000");
  const manual = await pageFor("completed");
  await openProject(manual, null);
  assert.equal(await manual.locator(".command-action").count(), 0, "Up-to-date projects must not gain another primary action");
  await manual.getByRole("button", { name: "处理图片…", exact: true }).click();
  assert.equal(await manual.getByRole("menuitem", { name: "重新处理当前图片", exact: true }).isEnabled(), true, "Completed sources remain manually convertible");
  await screenshot(manual, "13-up-to-date-manual-conversion-1440");
  await manual.getByRole("menuitem", { name: "重新处理当前图片", exact: true }).click();
  await manual.getByRole("button", { name: "处理图片…", exact: true }).waitFor();
  const manualCalls = await manual.evaluate(() => window.__TEXGO_UI_REVIEW__.commands.filter((item) => item.command === "convert_images"));
  assert.equal(manualCalls.length, 1); assert.equal(manualCalls[0].args.intent, "reconvert"); assert.deepEqual(manualCalls[0].args.options.imageIds, ["image-1"]);
  assert.equal(await manual.getByRole("dialog").count(), 0, "Same-path manual regeneration must not open reference review");

  const ignored = await pageFor("completed");
  await openProject(ignored, null);
  await ignored.getByRole("button", { name: "更多操作 figures/response-curve.png", exact: true }).click();
  await ignored.getByRole("menuitem", { name: "始终忽略", exact: true }).click();
  await ignored.getByRole("radio", { name: "已忽略 1", exact: true }).click();
  await ignored.locator('[title="始终忽略"]').first().waitFor();
  await screenshot(ignored, "14-permanent-ignore-1440");
  await ignored.getByRole("button", { name: "更多操作 figures/response-curve.png", exact: true }).click();
  await ignored.getByRole("menuitem", { name: "手动处理一次", exact: true }).click();
  await ignored.getByRole("button", { name: "处理图片…", exact: true }).waitFor();
  assert.equal(await ignored.evaluate(() => window.__TEXGO_UI_REVIEW__.snapshot().images.find((image) => image.id === "image-1").ignoreMode), "permanent", "Manual conversion must preserve permanent ignore");
  await ignored.getByRole("button", { name: "更多操作 figures/response-curve.png", exact: true }).click();
  await ignored.getByRole("menuitem", { name: "恢复处理", exact: true }).click();
  await ignored.getByRole("radio", { name: "已完成 18", exact: true }).waitFor();
  assert.equal(await ignored.evaluate(() => window.__TEXGO_UI_REVIEW__.snapshot().images.find((image) => image.id === "image-1").ignoreMode), "none");
  const ignoreCalls = await ignored.evaluate(() => window.__TEXGO_UI_REVIEW__.commands.filter((item) => item.command === "ignore_asset").map((item) => item.args.mode));
  assert.deepEqual(ignoreCalls, ["permanent", "none"]);

  const renamed = await pageFor("completed");
  await openProject(renamed, null);
  await renamed.getByRole("searchbox", { name: "搜索图片" }).fill("figures");
  await renamed.getByRole("radio", { name: "对比", exact: true }).click();
  const divider = renamed.getByRole("slider", { name: "原图与 PDF 分隔线" });
  await divider.focus(); await renamed.keyboard.press("Shift+ArrowRight");
  const filename = renamed.getByText("response-curve", { exact: true });
  assert.equal(await filename.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest(".asset-filename") === element;
  }), true, "The filename must receive pointer events above the stretched row preview target");
  await filename.dblclick();
  const renameDoubleClick = await renamed.evaluate(() => window.__TEXGO_UI_REVIEW__.focusTrace.filter((event) => event.type === "dblclick").at(-1));
  assert.equal(renameDoubleClick?.tag, "SPAN", "Filename double-click must reach the text handler, not the stretched row button");
  const renameInput = renamed.getByRole("textbox", { name: "图片新名称" });
  assert.deepEqual(await renameInput.evaluate((input) => [input.selectionStart, input.selectionEnd]), [0, "response-curve".length]);
  await screenshot(renamed, "15-inline-rename-1440");
  await renameInput.fill("pressure-map"); await renameInput.press("Enter");
  await renamed.getByRole("button", { name: "应用重命名", exact: true }).click();
  await renamed.getByRole("dialog", { name: "审核重命名" }).getByRole("button", { name: "应用重命名", exact: true }).click();
  await renamed.getByRole("button", { name: "预览 figures/pressure-map.png", exact: true }).waitFor();
  await renamed.getByRole("img", { name: "原始：figures/pressure-map.png", exact: true }).waitFor();
  assert.equal(await renamed.getByRole("searchbox", { name: "搜索图片" }).inputValue(), "figures", "Rename must retain search context");
  assert.equal(await renamed.getByRole("radio", { name: "对比", exact: true }).getAttribute("aria-checked"), "true", "Rename must retain preview mode");
  assert.equal(await renamed.getByRole("slider").getAttribute("aria-valuenow"), "60", "Rename must retain comparison position");
  assert.equal(await renamed.getByRole("button", { name: "预览 figures/pressure-map.png", exact: true }).getAttribute("aria-pressed"), "true", "Rename must migrate the active asset ID");
  await screenshot(renamed, "16-renamed-asset-1440");
  await renamed.getByRole("button", { name: "操作记录", exact: true }).click();
  await renamed.getByText("重命名图片", { exact: true }).waitFor();
  await screenshot(renamed, "17-rename-history-1440");

  const blocked = await pageFor("review");
  await openProject(blocked, "检查 18 处引用");
  await blocked.getByRole("button", { name: "处理图片…", exact: true }).click();
  await blocked.getByRole("dialog", { name: "请先审核引用" }).waitFor();
  await blocked.getByText("当前有 18 处引用尚未审核。建议先完成引用审核，再开始新的转换。", { exact: true }).waitFor();
  assert.equal(await blocked.evaluate(() => window.__TEXGO_UI_REVIEW__.commands.filter((item) => item.command === "convert_images").length), 0, "Unreviewed references must block manual conversion before native invocation");
  await screenshot(blocked, "18-manual-conversion-reference-guard-1440");
  await blocked.getByRole("button", { name: "检查引用", exact: true }).click();
  await blocked.getByRole("dialog", { name: "检查引用变更" }).waitFor();
  report.result = "passed";
  console.log(`Captured ${report.screenshots.length} Texgo UI states without browser errors.`);
} catch (error) {
  report.result = "failed"; report.error = error.stack ?? String(error);
  if (activePage && !activePage.isClosed()) report.focusDiagnostics = await activePage.evaluate(() => ({ active: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") }, renameInputs: document.querySelectorAll('[aria-label="图片新名称"]').length, asset: window.__TEXGO_UI_REVIEW__?.snapshot().images[0], trace: window.__TEXGO_UI_REVIEW__?.focusTrace })).catch(() => null);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: fileURLToPath(new URL("failure.png", output)), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL("report.json", output), `${JSON.stringify(report, null, 2)}\n`);
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  if (serverExit === null) await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(3000)]);
  if (serverExit === null) server.kill("SIGKILL");
}
