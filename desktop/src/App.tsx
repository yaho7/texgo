import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Check, History, Images, LoaderCircle, PanelLeft, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import IconButton from "./IconButton";
import AssetList from "./AssetList";
import AssetPreview from "./AssetPreview";
import ConversionPanel from "./ConversionPanel";
import ConversionHistory from "./ConversionHistory";
import Home from "./Home";
import WorkspaceSidebar from "./WorkspaceSidebar";
import SettingsPage from "./SettingsPage";
import { defaultPreferences } from "./preferences";
import type { Preferences } from "./preferences";
import ApplicationUpdate from "./ApplicationUpdate";
import WorkbenchMenu from "./WorkbenchMenu";
import AssetProblems from "./AssetProblems";
import type { RepairCandidate } from "./AssetProblems";
import ReviewDialog from "./ReviewDialog";
import Splitter from "./Splitter";
import { conversionOptions, defaultSettings, settingsIssues } from "./settings";
import type { ConversionSettings } from "./settings";
import { readRecents, readSettings, rememberWorkspace, removeRecent, storeSettings, workspaceKey } from "./recents";
import type { RecentWorkspace } from "./recents";
import type { SmartReport, NotificationTarget, ChangePreview, ConversionHistoryEntry, ConversionProgress, ConversionResult, ImageResult, Project, ReplacementResult } from "./types";
import { errorMessage, fileName, relativeFile } from "./utils";

type Operation = "opening" | "converting" | "reviewing" | "applying" | "undoing";
const operationLabels: Record<Operation, string> = { opening: "正在扫描…", converting: "正在转换图片…", reviewing: "正在读取引用变更…", applying: "正在替换引用…", undoing: "正在撤销…" };

function projectEntry(project: Project): Omit<RecentWorkspace, "openedAt"> {
  return { mode: project.mode, path: project.mode === "directory" ? project.root : project.mainFile, recursive: project.recursive };
}

export default function App() {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [settingsPage, setSettingsPage] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [failedRecent, setFailedRecent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ImageResult>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [settings, setSettings] = useState<ConversionSettings>(defaultSettings);
  const [highlightBatch, setHighlightBatch] = useState<string | null>(null);
  const backgroundActive = useRef(false);
  const backgroundStart = useRef<(project: Project) => void>(() => {});
  const backgroundFinished = useRef<(report: SmartReport) => void>(() => {});
  const notificationNavigate = useRef<(payload: { project: Project; target: NotificationTarget }) => void>(() => {});
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
  const [reviewKind, setReviewKind] = useState<"conversion" | "repair">("conversion");
  const [problemId, setProblemId] = useState<string | null>(null);
  const [repairCandidates, setRepairCandidates] = useState<RepairCandidate[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(0);
  const [assetsWidth, setAssetsWidth] = useState(560);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const desktopAction = useRef<(action: string) => void>(() => {});
  const dropFiles = useRef<(paths: string[]) => void>(() => {});
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 980px)").matches ?? false);
  const busy = operation !== null;

  useEffect(() => {
    if (!preferences.autoWatch || !project || busy || review || undoEntry || updateOpen || problemId) return;
    let disposed = false;
    let pending = false;
    let retryAt = 0;
    const root = project.root;
    async function poll() {
      if (disposed || pending || document.hidden || operationRef.current || Date.now() < retryAt) return;
      pending = true;
      try {
        const next = await invoke<Project | null>("poll_workspace", { root });
        if (!next || disposed) return;
        setProject(next);
        setResults((previous) => ({
          ...Object.fromEntries(next.convertedImages.map((image) => [image.id, image])),
          ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && next.images.some((asset) => asset.id === id))),
        }));
        const ready = new Set(next.images.filter((image) => image.status === "ready").map((image) => image.id));
        setSelected((previous) => new Set([...previous].filter((id) => ready.has(id))));
        setActiveId((previous) => next.images.some((image) => image.id === previous) ? previous : next.images[0]?.id ?? null);
        setRevision((value) => value + 1);
        setNotice("已自动更新图片状态");
        await loadHistory();
      } catch (reason) { retryAt = Date.now() + 30_000; if (!disposed) setError(`自动检测暂不可用：${errorMessage(reason)}`); }
      finally { pending = false; }
    }
    const timer = window.setInterval(() => { void poll(); }, 2500);
    const focus = () => { void poll(); };
    window.addEventListener("focus", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [project?.root, project?.mainFile, busy, review, undoEntry, updateOpen, problemId, preferences.autoWatch]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 980px)");
    if (!media) return;
    const update = () => { setNarrow(media.matches); setDrawerOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;
    const stops: (() => void)[] = [];
    function keep(promise: Promise<() => void>) {
      void promise.then((stop) => { if (active) stops.push(stop); else void Promise.resolve(stop()).catch(() => {}); }).catch(() => {});
    }
    keep(listen<Project>("background-start", ({ payload }) => backgroundStart.current(payload)));
    keep(listen<SmartReport>("background-finished", ({ payload }) => backgroundFinished.current(payload)));
    keep(listen("background-idle", () => { if (backgroundActive.current) { backgroundActive.current = false; operationRef.current = null; setOperation(null); void loadHistory(); } }));
    keep(listen<ConversionProgress>("conversion-progress", ({ payload }) => { if (backgroundActive.current) setProgress(payload); }));
    keep(listen<ImageResult>("conversion-result", ({ payload }) => { if (backgroundActive.current) setResults((previous) => ({ ...previous, [payload.id]: payload })); }));
    keep(listen<string>("desktop-error", ({ payload }) => setError(payload)));
    keep(listen<{ project: Project; target: NotificationTarget }>("notification-navigate", ({ payload }) => notificationNavigate.current(payload)));
    void invoke<{ error: string | null }>("desktop_status").then((status) => { if (active && status?.error) setError(status.error); }).catch(() => {});
    keep(listen<string>("menu-action", ({ payload }) => desktopAction.current(payload)));
    keep(listen<{ paths: string[] }>("tauri://drag-drop", ({ payload }) => { setDragging(false); dropFiles.current(payload.paths); }));
    keep(listen("tauri://drag-enter", () => setDragging(true)));
    keep(listen("tauri://drag-leave", () => setDragging(false)));
    return () => { active = false; stops.forEach((stop) => { void Promise.resolve(stop()).catch(() => {}); }); };
  }, []);

  useEffect(() => {
    let disposed = false;
    void invoke<Preferences>("get_preferences").then((value) => {
      if (disposed || !value) return;
      setPreferences(value);
      if (value.startup === "lastWorkspace") { const last = readRecents()[0]; if (last) openRecent(last); }
      const current = import.meta.env.VITE_RELEASE_TAG;
      if (value.autoUpdate && current && current !== "development") {
        void fetch("https://api.github.com/repos/yaho7/texgo/releases/latest", { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(12000) })
          .then(async (r) => { if (!r.ok) return; const release = await r.json() as { tag_name?: string }; if (!disposed && release.tag_name && release.tag_name !== current) setNotice(`有新版本可用：${release.tag_name}，可从菜单检查应用更新`); }).catch(() => {});
      }
    }).catch((reason) => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, []);

  function goHome() {
    if (operationRef.current) return;
    setSettingsPage(false);
    void invoke("close_workspace").catch((reason) => setError(errorMessage(reason)));
    setDrawerOpen(false);
    clearAssetState(); setProject(null); setError(null); setNotice("就绪");
  }

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
    setProblemId(null);
    setProgress(null);
    setRevision((value) => value + 1);
  }

  async function loadHistory() {
    try { setHistory(await invoke<ConversionHistoryEntry[]>("conversion_history")); }
    catch (reason) { setHistory([]); setError(`无法读取转换记录，请重新扫描后重试：${errorMessage(reason)}`); }
  }

  async function acceptProject(next: Project, preserveSettings: boolean, message?: string) {
    clearAssetState();
    setSettingsPage(false);
    setProject(next);
    setResults(Object.fromEntries(next.convertedImages.map((image) => [image.id, image])));
    setActiveId(next.images.find((image) => image.status === "ready")?.id ?? next.images[0]?.id ?? null);
    setSearch("");
    setFilter("all");
    setFailedRecent(null);
    if (!preserveSettings) {
      setIgnored(new Set());
      setView("assets");
      setSettings(readSettings(workspaceKey(projectEntry(next))) ?? { dpi: String(preferences.dpi), jpegQuality: String(preferences.jpegQuality), outputDir: preferences.outputDir });
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
      const next = await invoke<Project>(add ? "add_image_directory" : "open_directory", { directory, recursive: preferences.recursive });
      await acceptProject(next, add);
    });
  }

  function openRecent(entry: RecentWorkspace) {
    if (project && workspaceKey(projectEntry(project)) === workspaceKey(entry)) return;
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

  function reviewChanges() {
    if (!project || busy || review) return;
    rememberFocus();
    setReviewKind("conversion");
    void execute("reviewing", async () => setReview(await invoke<ChangePreview>("preview_changes")));
  }

  async function ignoreAsset(id: string, value = true) {
    try {
      await invoke("ignore_asset", { imageId: id, ignored: value });
      setIgnored((previous) => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next; });
      setSelected((previous) => new Set([...previous].filter((item) => item !== id)));
      setProblemId(null); setError(null); setNotice(value ? "已忽略本次引用问题，源文件未修改" : "已恢复处理");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function inspectProblem(imageId: string) {
    if (!project || busy) return;
    setView("assets"); setActiveId(imageId); setProblemId(imageId); setRepairCandidates([]); rememberFocus();
    const asset = project.images.find((image) => image.id === imageId);
    if (asset && ["missing", "ambiguous"].includes(asset.status)) void execute("reviewing", async () => setRepairCandidates(await invoke<RepairCandidate[]>("repair_candidates", { imageId })));
  }

  function chooseRepair(imageId: string, target: string) {
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_repair", { imageId, target });
      setReviewKind("repair"); setProblemId(null); setReview(preview);
    });
  }

  function locateRepair(imageId: string) {
    void execute("opening", async () => {
      const target = await open({ multiple: false, directory: false, title: "定位项目内的图片", defaultPath: project?.root, filters: [{ name: "图片或 PDF", extensions: ["png", "jpg", "jpeg", "svg", "webp", "tif", "tiff", "bmp", "pdf"] }] });
      if (typeof target !== "string") return;
      const preview = await invoke<ChangePreview>("preview_repair", { imageId, target });
      setReviewKind("repair"); setProblemId(null); setReview(preview);
    });
  }

  function convert() {
    if (!project || selected.size === 0 || operationRef.current) return;
    if (canReview && !preferences.allowUnreviewed) { reviewChanges(); return; }
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
      setHighlightBatch(null);
      setProgress(null);
      cancelRef.current = false;
      setCancelRequested(false);
      setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !imageIds.includes(id))));
      let acceptingEvents = true;
      let unlisten: (() => void) | undefined;
      let stopResults: (() => void) | undefined;
      try {
        unlisten = await listen<ConversionProgress>("conversion-progress", ({ payload }) => { if (acceptingEvents) setProgress(payload); });
        stopResults = await listen<ImageResult>("conversion-result", ({ payload }) => {
          if (acceptingEvents && imageIds.includes(payload.id)) setResults((previous) => ({ ...previous, [payload.id]: payload }));
        });
        if (cancelRef.current) { setNotice("已取消：0 张已完成"); return; }
        const result = await invoke<ConversionResult>("convert_images", { options: conversionOptions(settings, imageIds) });
        const next: Record<string, ImageResult> = {};
        for (const image of result.images) next[image.id] = { ...image, error: image.error || (!image.pdfPath ? "未生成 PDF" : null) };
        for (const id of imageIds) {
          if (!next[id]) next[id] = { id, pdfPath: null, bytes: null, cached: false, error: result.cancelled ? null : "未返回转换结果", cancelled: result.cancelled };
        }
        setResults((previous) => ({ ...previous, ...next }));
        setSelected(new Set());
        const succeeded = result.images.filter((image) => image.pdfPath && !image.error).length;
        const failed = Object.values(next).filter((image) => image.error).length;
        setNotice(result.cancelled ? `已取消：${succeeded} 张已完成` : `转换完成：${succeeded} 成功，${failed} 失败`);
        setRevision((value) => value + 1);
        if (preferences.afterConversion === "history") setView("history");
        else if (preferences.afterConversion === "review" && project.mode === "tex" && succeeded > 0) { setReviewKind("conversion"); setReview(await invoke<ChangePreview>("preview_changes")); }
      } finally {
        acceptingEvents = false;
        unlisten?.();
        stopResults?.();
        cancelRef.current = false;
        setCancelRequested(false);
        await loadHistory();
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

  function replace(undo: boolean, selection: string[] = []) {
    if (!project || (!undo && !review)) return;
    void execute(undo ? "undoing" : "applying", async () => {
      let result: ReplacementResult;
      try { result = await invoke<ReplacementResult>(undo ? "undo_replacements" : "apply_replacements", undo ? undefined : { selection, expected: review, repair: reviewKind === "repair" }); }
      catch (reason) {
        // A failed write may still have created an undo record or changed some files.
        setReview(null);
        try { await refresh("操作中断，已重新读取工作区"); }
        catch (refreshError) {
          setProject(null);
          throw new Error(`${errorMessage(reason)}；重新扫描失败，请重新打开工作区：${errorMessage(refreshError)}`);
        }
        restoreFocus();
        throw reason;
      }
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
      let next: Project;
      try { next = await invoke<Project>("undo_conversion", { entryId: undoEntry.id }); }
      catch (reason) {
        setUndoEntry(null);
        try { await refresh("撤销未全部完成，已重新读取恢复记录"); }
        catch (refreshError) { setProject(null); throw new Error(`${errorMessage(reason)}；重新扫描失败：${errorMessage(refreshError)}`); }
        restoreFocus();
        throw reason;
      }
      setUndoEntry(null);
      await acceptProject(next, true, "已撤销此次转换");
    });
  }

  const activeAsset = project?.images.find((image) => image.id === activeId) ?? null;
  const visibleImages = (project?.images ?? []).filter((image) => {
    if (filter === "ignored") return ignored.has(image.id);
    if (ignored.has(image.id) && filter !== "all") return false;
    const textMatch = `${image.relativePath} ${image.format}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const result = results[image.id];
    const converted = Boolean(result?.pdfPath && !result.error);
    return textMatch && (filter === "all" || (filter === "converted" ? converted : filter === "pending" ? image.status === "ready" && !converted : filter === "attention" ? ["missing", "ambiguous", "unsupported"].includes(image.status) || Boolean(result?.error) : filter === "updatable" ? Boolean(image.updateAvailable && !converted) : filter === "error" ? Boolean(result?.error) : image.status === filter));
  });
  const canReview = project?.mode === "tex" && project.images.some((image) => {
    const output = results[image.id]?.pdfPath;
    return output && !results[image.id]?.error && image.references.some((reference) => reference.original !== relativeFile(output, project.root));
  });
  backgroundStart.current = (nativeProject) => {
    if (!project || project.root !== nativeProject.root || project.mainFile !== nativeProject.mainFile) return;
    setProject(nativeProject);
    setResults((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && nativeProject.images.some((asset) => asset.id === id))),
      ...Object.fromEntries(nativeProject.convertedImages.map((image) => [image.id, image])),
    }));
    backgroundActive.current = true;
    operationRef.current = "converting"; setOperation("converting"); setProgress(null); setError(null);
  };
  backgroundFinished.current = (report) => {
    if (!project || project.root !== report.project.root || project.mainFile !== report.project.mainFile) return;
    setProject(report.project);
    setResults((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && report.project.images.some((asset) => asset.id === id))),
      ...Object.fromEntries(report.project.convertedImages.map((image) => [image.id, image])),
      ...Object.fromEntries(report.result.images.map((image) => [image.id, image])),
    }));
    setSelected((previous) => new Set([...previous].filter((id) => !report.result.images.some((image) => image.id === id))));
    setRevision((value) => value + 1);
    const failed = report.result.images.filter((image) => image.error).length;
    setNotice(report.result.images.length ? `转换完成：${report.result.images.length - failed} 成功，${failed} 失败` : report.pendingReferences && !preferences.allowUnreviewed ? `${report.pendingReferences} 处引用等待确认` : report.problemIds.length ? `${report.problemIds.length} 个问题需要处理` : "当前工作区没有需要更新的图片");
    void loadHistory();
  };
  notificationNavigate.current = ({ project: next, target }) => {
    void (async () => {
      setReview(null); setProblemId(null); setUndoEntry(null); setUpdateOpen(false); setSettingsPage(false);
      const same = project?.root === next.root && project.mainFile === next.mainFile;
      await acceptProject(next, same);
      setHighlightBatch(target.batchId);
      if (target.view === "review" && next.mode === "tex") {
        setReviewKind("conversion");
        try { const plan = await invoke<ChangePreview>("preview_changes"); if (plan.referenceCount) setReview(plan); else setView("history"); }
        catch (reason) { setError(errorMessage(reason)); setView("history"); }
      } else if (target.view === "problems") {
        setView("assets"); setFilter("attention"); setActiveId(target.imageId);
        if (target.imageId && next.images.some((image) => image.id === target.imageId)) {
          setProblemId(target.imageId); setRepairCandidates([]);
          const imageId = target.imageId;
          if (next.images.some((image) => image.id === imageId && ["missing", "ambiguous"].includes(image.status))) {
            void execute("reviewing", async () => setRepairCandidates(await invoke<RepairCandidate[]>("repair_candidates", { imageId })));
          }
        }
      } else { setView("history"); if (target.imageId) setActiveId(target.imageId); }
    })();
  };
  desktopAction.current = (action) => {
    if (action === "settings") { setSettingsPage(true); setDrawerOpen(false); return; }
    if (action === "check-updates") { setUpdateOpen(true); return; }
    if (operationRef.current || review || undoEntry || updateOpen || problemId) return;
    if (action === "open-project") openProject();
    else if (action === "open-directory") openDirectory();
    else if (action === "add-directory" && project) openDirectory(true);
    else if (action === "refresh" && project) void execute("opening", () => refresh());
    else if (action === "convert") convert();
    else if (action === "review" && canReview) reviewChanges();
    else if (action === "undo-task") {
      const entry = history.find((item) => item.canUndo);
      if (entry) { rememberFocus(); setUndoEntry(entry); }
      else if (project?.undoAvailable) replace(true);
    }
  };
  dropFiles.current = (paths) => {
    if (operationRef.current || review || undoEntry || updateOpen || problemId) return;
    const tex = paths.filter((path) => /\.tex$/i.test(path));
    if (tex.length !== 1) { setError("请一次拖入一个 .tex 主文件"); return; }
    void execute("opening", async () => acceptProject(await invoke<Project>("open_project", { mainFile: tex[0] }), false));
  };

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      const editing = Boolean(element?.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])"));
      if (event.isComposing || event.repeat || event.altKey) return;
      const mod = event.metaKey || event.ctrlKey;
      // Checkbox primitives consume Enter; reserved app accelerators still take priority.
      if (event.defaultPrevented && !(mod && [",", "f", "Enter"].includes(event.key))) return;
      if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSettingsPage(true); return; }
      if (settingsPage) {
        if (event.key === "Escape") { event.preventDefault(); setSettingsPage(false); requestAnimationFrame(() => document.getElementById("main-content")?.focus()); }
        return;
      }
      if (review || undoEntry || updateOpen || drawerOpen || problemId || document.querySelector('[data-slot="dropdown-menu-content"]')) return;
      if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); desktopAction.current(event.shiftKey ? "open-directory" : "open-project"); }
      else if (mod && event.key.toLowerCase() === "r") { event.preventDefault(); desktopAction.current("refresh"); }
      else if (mod && event.key === "Enter") { event.preventDefault(); desktopAction.current(event.shiftKey ? "review" : "convert"); }
      else if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); setView("assets"); document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus(); }
      else if (!editing && !mod && event.key === "/") { event.preventDefault(); document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus(); }
      else if (!editing && !mod && ["ArrowUp", "ArrowDown"].includes(event.key) && visibleImages.length) {
        event.preventDefault(); const index = visibleImages.findIndex((image) => image.id === activeId);
        const next = Math.max(0, Math.min(visibleImages.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        setActiveId(visibleImages[next].id);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.asset-preview-trigger[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" }));
      } else if (event.key === "Escape" && !busy) { setSearch(""); setFilter("all"); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [review, undoEntry, updateOpen, drawerOpen, problemId, busy, selected.size, activeId, visibleImages, settingsPage]);
  const problemAssets = project?.images.filter((image) => !ignored.has(image.id) && ["missing", "ambiguous", "unsupported"].includes(image.status)) ?? [];
  const progressValue = progress && progress.total > 0 ? Math.min(100, Math.max(0, progress.current / progress.total * 100)) : 0;
  const layoutStyle = { "--assets-width": `${assetsWidth}px` } as CSSProperties;
  const sidebar = <WorkspaceSidebar busy={busy} activeKey={project ? workspaceKey(projectEntry(project)) : null} recents={recents} failedRecent={failedRecent}
    onSettings={() => { setDrawerOpen(false); setSettingsPage(true); }} onHome={goHome} onOpenTex={() => { setDrawerOpen(false); openProject(); }} onOpenDirectory={() => { setDrawerOpen(false); openDirectory(); }}
    onRecent={(entry) => { setDrawerOpen(false); openRecent(entry); }}
    onRemove={(entry) => { const saved = removeRecent(entry); setRecents(readRecents()); setNotice(saved ? "已移除最近记录，文件未删除" : "无法移除记录，请检查应用存储权限"); }} />;

  return <TooltipProvider delayDuration={350}><div className="app-shell">
    <div className="workbench" inert={review !== null || undoEntry !== null || problemId !== null || updateOpen}>
      <a href="#main-content" className="skip-link">跳转到工作区</a>
      {!narrow && sidebarOpen && <aside className="workspace-sidebar">{sidebar}</aside>}
      <div className="workspace-main">
      <header className="app-toolbar">
        <IconButton id="sidebar-toggle" label={narrow ? "打开项目导航" : sidebarOpen ? "收起侧栏" : "展开侧栏"} aria-expanded={narrow ? drawerOpen : sidebarOpen} onClick={() => narrow ? setDrawerOpen(true) : setSidebarOpen((value) => !value)}><PanelLeft aria-hidden="true" /></IconButton>
        {project && <IconButton label="返回首页" disabled={busy} onClick={goHome}><ArrowLeft aria-hidden="true" /></IconButton>}
        <div className="project-title">{project ? <><h1 title={project.mainFile || project.root}>{fileName(project.mainFile || project.root)}</h1><p title={project.root}>{project.root}</p></> : <span>新工作区</span>}</div>
        <div className="toolbar-actions">{project && <Badge variant="outline" className="project-file-count">{project.mode === "directory" ? "图片目录" : `${project.texFiles.length} 个 TeX 文件`}</Badge>}<WorkbenchMenu busy={busy} hasProject={Boolean(project)} canUndo={history.some((entry) => entry.canUndo) || Boolean(project?.undoAvailable)} onOpen={openProject} onDirectory={() => openDirectory()} onAddDirectory={() => openDirectory(true)} onRefresh={() => { void execute("opening", () => refresh()); }} onUpdate={() => setUpdateOpen(true)} onUndo={() => {
          const entry = history.find((item) => item.canUndo); if (entry) { rememberFocus(); setUndoEntry(entry); } else if (project?.undoAvailable) replace(true);
        }} /></div>
      </header>
      {error && !review && !undoEntry && !problemId && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>操作未完成</AlertTitle><AlertDescription className="flex items-start justify-between gap-4"><span>{error}</span><IconButton label="关闭错误提示" onClick={() => setError(null)}><X aria-hidden="true" /></IconButton></AlertDescription></Alert>}
      {settingsPage ? <SettingsPage value={preferences} onSaved={setPreferences} onClose={() => setSettingsPage(false)} /> : !project ? <Home busy={busy} onOpenTex={openProject} onOpenDirectory={() => openDirectory()} /> : <>
        {(problemAssets.length > 0 || project.warnings.length > 0) && <Alert className="workbench-alert scan-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>{problemAssets.length ? `${problemAssets.length} 个问题需要处理` : "项目扫描信息"}</AlertTitle><AlertDescription className="scan-actions">{problemAssets.length > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => inspectProblem(problemAssets[0].id)}>查看并修复</Button>}<details><summary>扫描信息</summary><ul>{project.warnings.map((warning, index) => <li key={index}>{warning}</li>)}{problemAssets.map((image) => <li key={image.id}>{image.relativePath}：{image.message || "请检查源文件"}</li>)}</ul></details></AlertDescription></Alert>}
        <Tabs value={view} onValueChange={setView} className="workspace-tabs">
          <div className="workspace-nav"><TabsList variant="line" aria-label="工作区视图"><TabsTrigger value="assets"><Images aria-hidden="true" />图片</TabsTrigger><TabsTrigger value="history"><History aria-hidden="true" />转换记录<Badge variant="secondary">{history.length}</Badge></TabsTrigger></TabsList>
          </div>
          <main id="main-content" tabIndex={-1} className="workspace-grid" data-view={view} style={layoutStyle}>
            <div className="workspace-library"><TabsContent value="assets" className="library-content"><AssetList images={visibleImages} allImages={project.images} ignored={ignored} onIgnore={(id, value) => { void ignoreAsset(id, value); }} onInspect={inspectProblem} onLocate={locateRepair} total={project.images.length} selected={selected} activeId={activeId} results={results} busy={busy} previewDisabled={busy && operation !== "converting"} search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} onActivate={(id) => { setActiveId(id); const asset = project.images.find((image) => image.id === id); if (!busy && asset && ["missing", "ambiguous"].includes(asset.status)) inspectProblem(id); }}
              onSelect={(id) => { if (!busy) setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }}
              onSelectAll={(ids, select) => { if (!busy) setSelected((previous) => { const next = new Set(previous); ids.forEach((id) => { if (select) next.add(id); else next.delete(id); }); return next; }); }} /></TabsContent>
              <TabsContent value="history" className="library-content"><ConversionHistory highlightId={highlightBatch} entries={history} busy={busy} referencesPending={project.undoAvailable} onUndo={(entry) => { rememberFocus(); setError(null); setUndoEntry(entry); }} /></TabsContent></div>
            <Splitter label="调整图片列表宽度" value={assetsWidth} min={380} max={1100} onChange={setAssetsWidth} />
            <div className="asset-inspector" key={workspaceKey(projectEntry(project))}><AssetPreview asset={activeAsset} result={activeAsset ? results[activeAsset.id] : undefined} revision={revision} />
              <ConversionPanel settings={settings} selectedCount={selected.size} busy={busy} converting={operation === "converting"} canReview={Boolean(canReview)} allowUnreviewed={preferences.allowUnreviewed} pendingReferences={project.images.reduce((n, image) => n + (results[image.id]?.pdfPath && !results[image.id]?.error ? image.references.filter((reference) => reference.original !== relativeFile(results[image.id].pdfPath!, project.root)).length : 0), 0)} undoAvailable={project.undoAvailable || history.some((entry) => !entry.undone && Boolean(entry.referencesChanged))} activeAsset={activeAsset} root={project.root} directoryMode={project.mode === "directory"} onSettings={updateSettings} onConvert={convert} onReview={reviewChanges} onUndo={() => replace(true)} />
            </div>
          </main>
        </Tabs>
      </>}
      <footer className="status-bar"><div className="status-text" role="status" aria-live="polite">{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : project ? <Check aria-hidden="true" /> : <span className="status-dot" />}<span>{operation ? cancelRequested ? "正在完成当前图片，随后取消…" : operationLabels[operation] : notice}</span>{operation === "converting" && progress && <span className="progress-name" title={progress.name}>{progress.current} / {progress.total}　{progress.name}</span>}</div>{operation === "converting" && <div className="progress-controls"><Progress value={progressValue} aria-label="转换进度" className="w-28" /><Button variant="outline" size="sm" aria-label="取消转换" disabled={cancelRequested} onClick={() => { void cancelConversion(); }}><Square data-icon="inline-start" aria-hidden="true" />{cancelRequested ? "等待取消…" : "取消转换"}</Button></div>}{!busy && project && <span className="status-file-count">{selected.size} 张已选</span>}</footer>
      </div>
    </div>
    <Dialog open={narrow && drawerOpen} onOpenChange={setDrawerOpen}>
      <DialogContent className="navigation-drawer" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("sidebar-toggle")?.focus(); }}>
        <DialogTitle className="sr-only">项目导航</DialogTitle><DialogDescription className="sr-only">打开项目与最近工作区</DialogDescription>
        <Button variant="ghost" size="icon" className="drawer-close" aria-label="关闭项目导航" title="关闭项目导航" onClick={() => setDrawerOpen(false)}><X aria-hidden="true" /></Button>
        {sidebar}
      </DialogContent>
    </Dialog>
    {problemId && project && <AssetProblems asset={project.images.find((image) => image.id === problemId) ?? null} projectRoot={project.root} busy={busy} candidates={repairCandidates} candidatesLoading={operation === "reviewing"} error={error} onClose={() => { setProblemId(null); setError(null); restoreFocus(); }} onLocate={locateRepair} onChoose={chooseRepair} onIgnore={(id) => { void ignoreAsset(id); }} />}
    {review && project && <ReviewDialog key={JSON.stringify(review)} preview={review} root={project.root} busy={busy} error={error} onClose={() => { if (!operationRef.current) { setReview(null); setError(null); restoreFocus(); } }} onApply={(selection) => replace(false, selection)} />}
    <Dialog open={undoEntry !== null} onOpenChange={(value) => { if (!value && !operationRef.current) { setUndoEntry(null); setError(null); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>撤销此批次？</DialogTitle><DialogDescription>将恢复本次任务修改的引用和 PDF，保留原图片。文件已被其他程序修改时会停止撤销。</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setUndoEntry(null); setError(null); }}>取消</Button><Button variant="destructive" disabled={busy} onClick={undoConversion}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RotateCcw data-icon="inline-start" aria-hidden="true" />}确认撤销</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {updateOpen && <ApplicationUpdate onClose={() => setUpdateOpen(false)} />}
    {dragging && <div className="drop-overlay" role="status">松开以打开 .tex 主文件</div>}
  </div></TooltipProvider>;
}
