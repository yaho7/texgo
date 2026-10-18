import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Check, ChevronRight, FileCode2, FolderOpen, FolderPlus, History, Images, LoaderCircle, RefreshCw, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import IconButton from "./IconButton";
import AssetList from "./AssetList";
import AssetPreview from "./AssetPreview";
import ConversionPanel from "./ConversionPanel";
import ConversionHistory from "./ConversionHistory";
import Home from "./Home";
import ReviewDialog from "./ReviewDialog";
import Splitter from "./Splitter";
import { conversionOptions, defaultSettings, settingsIssues } from "./settings";
import type { ConversionSettings } from "./settings";
import { readRecents, readSettings, rememberWorkspace, removeRecent, storeSettings, workspaceKey } from "./recents";
import type { RecentWorkspace } from "./recents";
import type { ChangePreview, ConversionHistoryEntry, ConversionProgress, ConversionResult, ImageResult, Project, ReplacementResult } from "./types";
import { errorMessage, fileName, relativeFile } from "./utils";

type Operation = "opening" | "converting" | "reviewing" | "applying" | "undoing";
const operationLabels: Record<Operation, string> = { opening: "正在扫描…", converting: "正在转换图片…", reviewing: "正在读取引用变更…", applying: "正在替换引用…", undoing: "正在撤销…" };

function projectEntry(project: Project): Omit<RecentWorkspace, "openedAt"> {
  return { mode: project.mode, path: project.mode === "directory" ? project.root : project.mainFile, recursive: project.recursive };
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [recursive, setRecursive] = useState(true);
  const [failedRecent, setFailedRecent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ImageResult>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [settings, setSettings] = useState<ConversionSettings>(defaultSettings);
  const [history, setHistory] = useState<ConversionHistoryEntry[]>([]);
  const [view, setView] = useState("assets");
  const [undoEntry, setUndoEntry] = useState<ConversionHistoryEntry | null>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const operationRef = useRef<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("就绪");
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);
  const [review, setReview] = useState<ChangePreview | null>(null);
  const [revision, setRevision] = useState(0);
  const [assetsWidth, setAssetsWidth] = useState(720);
  const busy = operation !== null;

  function restoreFocus() {
    requestAnimationFrame(() => {
      const trigger = dialogTrigger.current;
      if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus({ preventScroll: true });
      else document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }

  function rememberFocus() {
    dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  async function execute(kind: Operation, action: () => Promise<void>) {
    if (operationRef.current) return;
    operationRef.current = kind;
    setOperation(kind);
    setError(null);
    try { await action(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { operationRef.current = null; setOperation(null); }
  }

  function clearAssetState() {
    setSelected(new Set());
    setResults({});
    setActiveId(null);
    setReview(null);
    setProgress(null);
    setRevision((value) => value + 1);
  }

  async function loadHistory() {
    try { setHistory(await invoke<ConversionHistoryEntry[]>("conversion_history")); }
    catch (reason) { setHistory([]); setError(`无法读取转换记录，请重新扫描后重试：${errorMessage(reason)}`); }
  }

  async function acceptProject(next: Project, preserveSettings: boolean, message?: string) {
    clearAssetState();
    setProject(next);
    setResults(Object.fromEntries(next.convertedImages.map((image) => [image.id, image])));
    setActiveId(next.images.find((image) => image.status === "ready")?.id ?? next.images[0]?.id ?? null);
    setSearch("");
    setFilter("all");
    setFailedRecent(null);
    if (!preserveSettings) {
      setView("assets");
      setSettings(readSettings(workspaceKey(projectEntry(next))) ?? defaultSettings);
      if (next.mode === "directory") setRecursive(next.recursive);
    }
    const saved = rememberWorkspace(projectEntry(next));
    setRecents(readRecents());
    setNotice(saved ? message ?? `已扫描 ${next.images.length} 张图片` : "工作区已打开，但无法保存最近记录；请检查应用存储权限");
    await loadHistory();
  }

  async function refresh(message?: string) {
    await acceptProject(await invoke<Project>("refresh_workspace"), true, message);
  }

  function openProject() {
    void execute("opening", async () => {
      const mainFile = await open({ multiple: false, directory: false, title: "打开 .tex 主文件", filters: [{ name: "LaTeX", extensions: ["tex"] }] });
      if (typeof mainFile === "string") await acceptProject(await invoke<Project>("open_project", { mainFile }), false);
    });
  }

  function openDirectory(add = false) {
    void execute("opening", async () => {
      const directory = await open({ multiple: false, directory: true, title: add ? "添加工作区内的图片目录" : "转换图片目录", defaultPath: project?.root });
      if (typeof directory !== "string") return;
      const next = await invoke<Project>(add ? "add_image_directory" : "open_directory", { directory, recursive });
      await acceptProject(next, add);
    });
  }

  function openRecent(entry: RecentWorkspace) {
    void execute("opening", async () => {
      try {
        const next = entry.mode === "tex"
          ? await invoke<Project>("open_project", { mainFile: entry.path })
          : await invoke<Project>("open_directory", { directory: entry.path, recursive: entry.recursive });
        await acceptProject(next, false);
      } catch (reason) { setFailedRecent(workspaceKey(entry)); throw reason; }
    });
  }

  function updateSettings(next: ConversionSettings) {
    setSettings(next);
    if (project && !storeSettings(workspaceKey(projectEntry(project)), next)) setNotice("设置仅保留在本次会话中，请检查应用存储权限");
  }

  function convert() {
    if (!project || selected.size === 0 || operationRef.current) return;
    const issues = settingsIssues(settings);
    const first = (["dpi", "jpegQuality", "outputDir"] as const).find((key) => issues[key]);
    if (first) {
      document.getElementById({ dpi: "conversion-dpi", jpegQuality: "conversion-quality", outputDir: "conversion-output" }[first])?.focus();
      return;
    }
    const imageIds = project.images.filter((image) => image.status === "ready" && selected.has(image.id)).map((image) => image.id);
    if (!imageIds.length) return;
    void execute("converting", async () => {
      setReview(null);
      setProgress(null);
      cancelRef.current = false;
      setCancelRequested(false);
      setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !imageIds.includes(id))));
      let acceptingEvents = true;
      const unlisten = await listen<ConversionProgress>("conversion-progress", ({ payload }) => { if (acceptingEvents) setProgress(payload); });
      try {
        const result = await invoke<ConversionResult>("convert_images", { options: conversionOptions(settings, imageIds) });
        const next: Record<string, ImageResult> = {};
        for (const image of result.images) next[image.id] = { ...image, error: image.error || (!image.pdfPath ? "未生成 PDF" : null) };
        for (const id of imageIds) {
          if (!next[id]) next[id] = { id, pdfPath: null, bytes: null, cached: false, error: result.cancelled ? null : "未返回转换结果", cancelled: result.cancelled };
        }
        setResults((previous) => ({ ...previous, ...next }));
        const succeeded = result.images.filter((image) => image.pdfPath && !image.error).length;
        const failed = Object.values(next).filter((image) => image.error).length;
        setNotice(result.cancelled ? `已取消：${succeeded} 张已完成` : `转换完成：${succeeded} 成功，${failed} 失败`);
        setRevision((value) => value + 1);
        await loadHistory();
      } finally {
        acceptingEvents = false;
        unlisten();
        cancelRef.current = false;
        setCancelRequested(false);
      }
    });
  }

  async function cancelConversion() {
    if (operationRef.current !== "converting" || cancelRef.current) return;
    cancelRef.current = true;
    setCancelRequested(true);
    try { await invoke("cancel_conversion"); }
    catch (reason) {
      if (operationRef.current === "converting") {
        cancelRef.current = false;
        setCancelRequested(false);
        setError(errorMessage(reason, "取消失败，请重试"));
      }
    }
  }

  function replace(undo: boolean) {
    if (!project || (!undo && !review)) return;
    void execute(undo ? "undoing" : "applying", async () => {
      const result = await invoke<ReplacementResult>(undo ? "undo_replacements" : "apply_replacements");
      setReview(null);
      clearAssetState();
      const message = `${undo ? "已恢复" : "已替换"} ${result.filesChanged} 个文件中的 ${result.referencesChanged} 处引用`;
      setNotice(message);
      try { await refresh(message); }
      catch (reason) { setProject(null); throw new Error(`${message}，但重新扫描失败，请重新打开工作区：${errorMessage(reason)}`); }
    });
  }

  function undoConversion() {
    if (!undoEntry) return;
    void execute("undoing", async () => {
      const next = await invoke<Project>("undo_conversion", { entryId: undoEntry.id });
      setUndoEntry(null);
      await acceptProject(next, true, "已撤销此次转换");
    });
  }

  const activeAsset = project?.images.find((image) => image.id === activeId) ?? null;
  const visibleImages = (project?.images ?? []).filter((image) => {
    const textMatch = `${image.relativePath} ${image.format}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const result = results[image.id];
    return textMatch && (filter === "all" || (filter === "converted" ? Boolean(result?.pdfPath && !result.error) : filter === "error" ? Boolean(result?.error) : image.status === filter));
  });
  const canReview = project?.mode === "tex" && project.images.some((image) => {
    const output = results[image.id]?.pdfPath;
    return output && !results[image.id]?.error && image.references.some((reference) => reference.original !== relativeFile(output, project.root));
  });
  const missingCount = project?.images.filter((image) => image.status === "missing").reduce((sum, image) => sum + image.references.length, 0) ?? 0;
  const progressValue = progress && progress.total > 0 ? Math.min(100, Math.max(0, progress.current / progress.total * 100)) : 0;
  const layoutStyle = { "--assets-width": `${assetsWidth}px` } as CSSProperties;

  return <TooltipProvider delayDuration={350}><div className="app-shell">
    <div className="workbench" inert={review !== null || undoEntry !== null}>
      <a href="#main-content" className="skip-link">跳转到工作区</a>
      <header className="app-toolbar">
        {project && <IconButton label="返回首页" disabled={busy} onClick={() => { clearAssetState(); setProject(null); setError(null); setNotice("就绪"); }}><ArrowLeft aria-hidden="true" /></IconButton>}
        <div className="brand" translate="no"><span className="brand-mark"><FileCode2 aria-hidden="true" /></span><span>Texgo</span></div>
        <ChevronRight className="project-chevron" aria-hidden="true" />
        <div className="project-title"><strong title={project?.mainFile || project?.root}>{project ? fileName(project.mainFile || project.root) : "工作台"}</strong></div>
        {project && <div className="toolbar-actions"><IconButton label="重新扫描" disabled={busy} onClick={() => { void execute("opening", () => refresh()); }}><RefreshCw aria-hidden="true" /></IconButton><Separator orientation="vertical" className="h-5" /><Button variant="outline" size="sm" disabled={busy} onClick={openProject}><FolderOpen data-icon="inline-start" aria-hidden="true" />打开 .tex 主文件</Button></div>}
      </header>
      {error && !review && !undoEntry && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>操作未完成</AlertTitle><AlertDescription className="flex items-start justify-between gap-4"><span>{error}</span><IconButton label="关闭错误提示" onClick={() => setError(null)}><X aria-hidden="true" /></IconButton></AlertDescription></Alert>}
      {!project ? <Home busy={busy} recursive={recursive} recents={recents} failedRecent={failedRecent} onRecursive={setRecursive} onOpenTex={openProject} onOpenDirectory={() => openDirectory()} onRecent={openRecent} onRemove={(entry) => { const saved = removeRecent(entry); setRecents(readRecents()); setNotice(saved ? "已移除最近记录，文件未删除" : "无法移除记录，请检查应用存储权限"); }} /> : <>
        <section className="project-heading"><div><div className="workspace-title"><Images aria-hidden="true" /><h1>{project.mode === "directory" ? "图片目录" : "项目图片"}</h1><Badge variant="secondary">{project.images.length}</Badge></div><p title={project.root}>{project.root}</p></div><Badge variant="outline">{project.mode === "directory" ? "目录转换" : `${project.texFiles.length} 个 TeX 文件`}</Badge></section>
        {(missingCount > 0 || project.warnings.length > 0) && <Alert className="workbench-alert scan-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>{missingCount > 0 ? `${missingCount} 个图片引用缺失` : "项目扫描警告"}</AlertTitle><AlertDescription><details><summary>{project.warnings.length || missingCount} 条警告</summary><ul>{project.warnings.map((warning, index) => <li key={index}>{warning}</li>)}{missingCount > 0 && project.warnings.length === 0 && project.images.filter((image) => image.status === "missing").map((image) => <li key={image.id}>{image.relativePath}：{image.message || "文件不存在"}</li>)}</ul></details></AlertDescription></Alert>}
        <Tabs value={view} onValueChange={setView} className="workspace-tabs">
          <div className="workspace-nav"><TabsList variant="line" aria-label="工作区视图"><TabsTrigger value="assets"><Images aria-hidden="true" />图片</TabsTrigger><TabsTrigger value="history"><History aria-hidden="true" />转换记录<Badge variant="secondary">{history.length}</Badge></TabsTrigger></TabsList>
            <div className="directory-actions"><Field orientation="horizontal" className="directory-recursive"><Checkbox id="workspace-recursive" name="recursive" checked={recursive} disabled={busy} onCheckedChange={(checked) => setRecursive(checked === true)} /><FieldLabel htmlFor="workspace-recursive">包含子目录</FieldLabel></Field><Button variant="ghost" size="sm" disabled={busy} onClick={() => openDirectory(true)}><FolderPlus data-icon="inline-start" aria-hidden="true" />添加图片目录</Button></div>
          </div>
          <main id="main-content" tabIndex={-1} className="workspace-grid" style={layoutStyle}>
            <div className="workspace-library"><TabsContent value="assets" className="library-content"><AssetList images={visibleImages} total={project.images.length} selected={selected} activeId={activeId} results={results} busy={busy} search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} onActivate={setActiveId}
              onSelect={(id) => { if (!busy) setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }}
              onSelectAll={(ids, select) => { if (!busy) setSelected((previous) => { const next = new Set(previous); ids.forEach((id) => { if (select) next.add(id); else next.delete(id); }); return next; }); }} /></TabsContent>
              <TabsContent value="history" className="library-content"><ConversionHistory entries={history} busy={busy} referencesPending={project.undoAvailable} onUndo={(entry) => { rememberFocus(); setError(null); setUndoEntry(entry); }} /></TabsContent></div>
            <Splitter label="调整图片列表宽度" value={assetsWidth} min={380} max={1100} onChange={setAssetsWidth} />
            <div className="asset-inspector"><AssetPreview key={`${revision}:${activeAsset?.id ?? "empty"}`} asset={activeAsset} result={activeAsset ? results[activeAsset.id] : undefined} revision={revision} />
              <ConversionPanel settings={settings} selectedCount={selected.size} busy={busy} converting={operation === "converting"} canReview={Boolean(canReview)} undoAvailable={project.undoAvailable} activeAsset={activeAsset} root={project.root} directoryMode={project.mode === "directory"} onSettings={updateSettings} onConvert={convert} onReview={() => { rememberFocus(); void execute("reviewing", async () => setReview(await invoke<ChangePreview>("preview_changes"))); }} onUndo={() => replace(true)} />
            </div>
          </main>
        </Tabs>
      </>}
      <footer className="status-bar"><div className="status-text" role="status" aria-live="polite">{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : project ? <Check aria-hidden="true" /> : <span className="status-dot" />}<span>{operation ? cancelRequested ? "正在完成当前图片，随后取消…" : operationLabels[operation] : notice}</span>{operation === "converting" && progress && <span className="progress-name" title={progress.name}>{progress.current} / {progress.total}　{progress.name}</span>}</div>{operation === "converting" && <div className="progress-controls"><Progress value={progressValue} aria-label="转换进度" className="w-28" /><Button variant="outline" size="sm" aria-label="取消转换" disabled={cancelRequested} onClick={() => { void cancelConversion(); }}><Square data-icon="inline-start" aria-hidden="true" />{cancelRequested ? "等待取消…" : "取消转换"}</Button></div>}{!busy && project && <span className="status-file-count">{selected.size} 张已选</span>}</footer>
    </div>
    {review && project && <ReviewDialog preview={review} root={project.root} busy={busy} error={error} onClose={() => { if (!operationRef.current) { setReview(null); setError(null); restoreFocus(); } }} onApply={() => replace(false)} />}
    <Dialog open={undoEntry !== null} onOpenChange={(value) => { if (!value && !operationRef.current) { setUndoEntry(null); setError(null); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>撤销此次转换？</DialogTitle><DialogDescription>将删除此次新建的 PDF，或恢复被更新的 PDF。原图片不会删除；文件已被其他程序修改时将停止撤销。</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setUndoEntry(null); setError(null); }}>取消</Button><Button variant="destructive" disabled={busy} onClick={undoConversion}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RotateCcw data-icon="inline-start" aria-hidden="true" />}确认撤销</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div></TooltipProvider>;
}
