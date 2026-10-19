import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, LoaderCircle, PanelLeft, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import IconButton from "./IconButton";
import AssetList from "./AssetList";
import AssetPreview from "./AssetPreview";
import CommandBar from "./CommandBar";
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
import { errorMessage, fileName } from "./utils";

type Operation = "opening" | "converting" | "reviewing" | "applying" | "undoing" | "updating";
const operationLabels: Record<Operation, string> = { opening: "正在扫描…", converting: "正在更新图片…", reviewing: "正在读取引用变更…", applying: "正在替换引用…", undoing: "正在撤销…", updating: "正在更新项目状态…" };

function projectEntry(project: Project): Omit<RecentWorkspace, "openedAt"> {
  return { path: project.mainFile };
}

export default function App() {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [settingsPage, setSettingsPage] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [failedRecent, setFailedRecent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [completion, setCompletion] = useState<number | null>(null);
  const [queuedReview, setQueuedReview] = useState<{ key: string; preview: ChangePreview } | null>(null);
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
  const historyRequest = useRef(0);
  const [history, setHistory] = useState<ConversionHistoryEntry[]>([]);
  const [view, setView] = useState<"assets" | "history">("assets");
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
  const [revision, setRevision] = useState(0);
  const [assetsWidth, setAssetsWidth] = useState(480);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const desktopAction = useRef<(action: string) => void>(() => {});
  const dropFiles = useRef<(paths: string[]) => void>(() => {});
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 980px)").matches ?? false);
  const busy = operation !== null;
  const projectRef = useRef(project);
  projectRef.current = project;
  const [windowVisible, setWindowVisible] = useState(!document.hidden);
  useEffect(() => { const update = () => setWindowVisible(!document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const contextKey = project ? workspaceKey(projectEntry(project)) : null;
  const pendingIds = new Set(project?.status.pendingImageIds ?? []);
  const problemIds = new Set(project?.status.problemIds ?? []);
  const ignored = new Set(project?.status.ignoredImageIds ?? []);
  const completedIds = new Set(project?.status.completedImageIds ?? []);
  const canReview = (project?.status.pendingReferences ?? 0) > 0;

  useEffect(() => {
    if (completion === null) return;
    const timer = window.setTimeout(() => setCompletion(null), 650);
    return () => window.clearTimeout(timer);
  }, [completion]);

  useEffect(() => {
    if (!queuedReview) return;
    if (queuedReview.key !== contextKey) { setQueuedReview(null); return; }
    if (busy || completion !== null || settingsPage || !windowVisible || undoEntry || problemId || updateOpen) return;
    rememberFocus(); setReviewKind("conversion"); setReview(queuedReview.preview); setQueuedReview(null);
  }, [queuedReview, completion, busy, contextKey, settingsPage, windowVisible, undoEntry, problemId, updateOpen]);

  useEffect(() => {
    if (!notice.startsWith("检测到")) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
        await acceptProject(next, true, `检测到图片发生变化，项目状态已更新`);
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
    keep(listen<Project>("workspace-updated", ({ payload }) => {
      if (projectRef.current?.mainFile === payload.mainFile) void acceptProject(payload, true, "项目状态已更新").catch((reason) => setError(errorMessage(reason)));
    }));
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

  function closeProject() {
    if (operationRef.current) return;
    void execute("opening", async () => {
      await invoke("close_workspace");
      setSettingsPage(false); setDrawerOpen(false);
      clearAssetState(); projectRef.current = null; historyRequest.current++; setProject(null); setHistory([]); setError(null); setNotice("已关闭当前项目");
    });
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
    setQueuedReview(null);
    setCompletion(null);
    setSelectionMode(false);
    setProblemId(null);
    setProgress(null);
    setRevision((value) => value + 1);
  }

  async function loadHistory() {
    const key = projectRef.current?.mainFile;
    const request = ++historyRequest.current;
    try {
      const entries = await invoke<ConversionHistoryEntry[]>("conversion_history");
      if (request === historyRequest.current && key === projectRef.current?.mainFile) setHistory(entries);
    } catch (reason) {
      if (request === historyRequest.current && key === projectRef.current?.mainFile) {
        setHistory([]); setError(`无法读取操作记录，请重新扫描后重试：${errorMessage(reason)}`);
      }
    }
  }

  async function acceptProject(next: Project, preserveContext: boolean, message?: string) {
    const same = preserveContext && projectRef.current?.mainFile === next.mainFile;
    if (!same) {
      clearAssetState(); setSettingsPage(false); setSearch(""); setFilter("all"); setView("assets");
      setActiveId(next.status.pendingImageIds[0] ?? next.images[0]?.id ?? null);
      setSettings(readSettings(workspaceKey(projectEntry(next))) ?? { dpi: String(preferences.dpi), jpegQuality: String(preferences.jpegQuality), outputDir: preferences.outputDir });
    } else {
      setActiveId((previous) => next.images.some((image) => image.id === previous) ? previous : next.status.pendingImageIds[0] ?? next.images[0]?.id ?? null);
      setSelected((previous) => new Set([...previous].filter((id) => next.status.pendingImageIds.includes(id))));
    }
    projectRef.current = next;
    setProject(next);
    setResults(Object.fromEntries(next.convertedImages.map((image) => [image.id, image])));
    setRevision((value) => value + 1);
    setFailedRecent(null);
    const saved = rememberWorkspace(projectEntry(next));
    setRecents(readRecents());
    setNotice(saved ? message ?? `已识别 ${next.status.totalImages} 张项目图片` : "项目已打开，最近记录暂未保存");
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

  function openRecent(entry: RecentWorkspace) {
    if (project && workspaceKey(projectEntry(project)) === workspaceKey(entry)) return;
    void execute("opening", async () => {
      try {
        const next = await invoke<Project>("open_project", { mainFile: entry.path });
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
    rememberFocus(); setQueuedReview(null);
    setReviewKind("conversion");
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_changes");
      if (preview.referenceCount > 0) setReview(preview);
      else await refresh("引用已是最新状态");
    });
  }

  async function ignoreAsset(id: string, value = true) {
    if (operationRef.current || !projectRef.current) return;
    await execute("updating", async () => {
      const next = await invoke<Project>("ignore_asset", { imageId: id, ignored: value });
      await acceptProject(next, true);
      setSelected((previous) => new Set([...previous].filter((item) => item !== id)));
      setProblemId(null); setError(null); setNotice(value ? "已忽略本次，源文件未修改" : "已恢复处理");
    });
  }

  function retryAsset(imageId: string) {
    if (operationRef.current) return;
    void execute("updating", async () => acceptProject(await invoke<Project>("retry_asset", { imageId }), true, "已准备重试，请确认更新图片"));
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
    if (!project || operationRef.current || project.status.blockingReason) return;
    if (canReview && !preferences.allowUnreviewed) { reviewChanges(); return; }
    const issues = settingsIssues(settings);
    const first = (["dpi", "jpegQuality", "outputDir"] as const).find((key) => issues[key]);
    if (first) {
      document.getElementById({ dpi: "conversion-dpi", jpegQuality: "conversion-quality", outputDir: "conversion-output" }[first])?.focus();
      return;
    }
    const imageIds = project.status.pendingImageIds.filter((id) => !selectionMode || selected.has(id));
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
        setSelectionMode(false);
        const succeeded = result.images.filter((image) => image.pdfPath && !image.error).length;
        const failed = Object.values(next).filter((image) => image.error).length;
        setNotice(result.cancelled ? `已取消：${succeeded} 张已完成` : `已更新 ${succeeded} 张图片${failed ? `，${failed} 张需要处理` : ""}`);
        const fresh = await invoke<Project>("refresh_workspace");
        await acceptProject(fresh, true, result.cancelled ? `已取消：${succeeded} 张已完成` : `已更新 ${succeeded} 张图片${failed ? `，${failed} 张需要处理` : ""}`);
        if (succeeded > 0) setCompletion(succeeded);
        if (fresh.status.pendingReferences > 0) {
          const preview = await invoke<ChangePreview>("preview_changes");
          if (preview.referenceCount > 0) setQueuedReview({ key: workspaceKey(projectEntry(fresh)), preview });
        }
      } catch (reason) {
        // A multi-destination update may have partially completed before returning an error.
        try { await refresh("更新中断，已重新读取项目状态"); }
        catch (recovery) { setProject(null); projectRef.current = null; throw new Error(`${errorMessage(reason)}；重新扫描失败：${errorMessage(recovery)}`); }
        throw reason;
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
      await acceptProject(next, true, "已撤销此次操作");
    });
  }

  const activeAsset = project?.images.find((image) => image.id === activeId) ?? null;
  const visibleImages = (project?.images ?? []).filter((image) => {
    const matches = `${image.relativePath} ${image.format}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matches && (filter === "all" || (filter === "pending" ? pendingIds.has(image.id)
      : filter === "problems" ? problemIds.has(image.id) : filter === "completed" ? completedIds.has(image.id) : filter === "ignored" && ignored.has(image.id)));
  });
  backgroundStart.current = (nativeProject) => {
    if (!project || project.root !== nativeProject.root || project.mainFile !== nativeProject.mainFile) return;
    projectRef.current = nativeProject; setProject(nativeProject);
    setResults((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && nativeProject.images.some((asset) => asset.id === id))),
      ...Object.fromEntries(nativeProject.convertedImages.map((image) => [image.id, image])),
    }));
    backgroundActive.current = true;
    operationRef.current = "converting"; setOperation("converting"); setProgress(null); setError(null);
  };
  backgroundFinished.current = (report) => {
    if (!project || project.root !== report.project.root || project.mainFile !== report.project.mainFile) return;
    projectRef.current = report.project; setProject(report.project);
    setActiveId((id) => report.project.images.some((asset) => asset.id === id) ? id : report.project.images[0]?.id ?? null);
    setResults((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && report.project.images.some((asset) => asset.id === id))),
      ...Object.fromEntries(report.project.convertedImages.map((image) => [image.id, image])),
      ...Object.fromEntries(report.result.images.map((image) => [image.id, image])),
    }));
    setSelected((previous) => new Set([...previous].filter((id) => !report.result.images.some((image) => image.id === id))));
    setRevision((value) => value + 1);
    const failed = report.result.images.filter((image) => image.error).length;
    const updated = report.result.images.length - failed;
    const status = report.project.status;
    setNotice(updated ? `已更新 ${updated} 张图片` : status.pendingReferences ? `${status.pendingReferences} 处引用等待确认` : status.blockingReason ? "项目存在安全问题，请先处理" : status.pendingImages ? `${status.pendingImages} 张图片需要更新` : status.problemCount ? `${status.problemCount} 个问题需要处理` : "项目已是最新状态");
    if (updated > 0) setCompletion(updated);
    if (status.pendingReferences > 0) {
      void invoke<ChangePreview>("preview_changes").then((preview) => {
        if (preview.referenceCount > 0 && projectRef.current?.mainFile === report.project.mainFile) setQueuedReview({ key: workspaceKey(projectEntry(report.project)), preview });
      }).catch((reason) => setError(errorMessage(reason)));
    }
    void loadHistory();
  };
  notificationNavigate.current = ({ project: next, target }) => {
    void (async () => {
      setReview(null); setQueuedReview(null); setCompletion(null); setProblemId(null); setUndoEntry(null); setUpdateOpen(false); setSettingsPage(false);
      const same = project?.root === next.root && project.mainFile === next.mainFile;
      await acceptProject(next, same);
      setHighlightBatch(target.batchId);
      if (target.view === "review") {
        setReviewKind("conversion");
        try { const plan = await invoke<ChangePreview>("preview_changes"); if (plan.referenceCount) setReview(plan); else setView("history"); }
        catch (reason) { setError(errorMessage(reason)); setView("history"); }
      } else if (target.view === "problems") {
        setView("assets"); setFilter("problems");
        if (target.imageId && next.images.some((image) => image.id === target.imageId)) setActiveId(target.imageId);
      } else { setView(target.view === "images" ? "assets" : "history"); if (target.imageId) setActiveId(target.imageId); }
    })();
  };
  desktopAction.current = (action) => {
    if (action === "settings") { setSettingsPage(true); setDrawerOpen(false); return; }
    if (action === "check-updates") { setUpdateOpen(true); return; }
    if (operationRef.current || review || undoEntry || updateOpen || problemId) return;
    if (action === "open-project") openProject();
    else if (action === "close-project") closeProject();
    else if (action === "refresh" && project) void execute("opening", () => refresh());
    else if (action === "convert") nextAction();
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
      if (review || undoEntry || updateOpen || drawerOpen || problemId || document.querySelector('[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-recording="true"]')) return;
      if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); desktopAction.current("open-project"); }
      else if (mod && event.key.toLowerCase() === "r") { event.preventDefault(); desktopAction.current("refresh"); }
      else if (mod && event.key === "Enter") { event.preventDefault(); desktopAction.current(event.shiftKey ? "review" : "convert"); }
      else if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); setView("assets"); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus()); }
      else if (!editing && !mod && event.key === "/") { event.preventDefault(); setView("assets"); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus()); }
      else if (view === "assets" && !editing && !mod && ["ArrowUp", "ArrowDown"].includes(event.key) && visibleImages.length) {
        event.preventDefault(); const index = visibleImages.findIndex((image) => image.id === activeId);
        const next = Math.max(0, Math.min(visibleImages.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        setActiveId(visibleImages[next].id);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.asset-preview-trigger[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" }));
      } else if (event.key === "Escape" && !busy && selectionMode) { setSelectionMode(false); setSelected(new Set()); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [review, undoEntry, updateOpen, drawerOpen, problemId, busy, selected.size, activeId, visibleImages, settingsPage, selectionMode, view]);
  function nextAction() {
    if (!project || busy || project.status.blockingReason) return;
    if (project.status.nextAction === "reviewReferences") reviewChanges();
    else if (project.status.nextAction === "convertImages") convert();
    else if (project.status.nextAction === "resolveProblems") {
      setSettingsPage(false); setView("assets"); setFilter("problems");
      setActiveId(project.status.problemIds[0] ?? activeId);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".preview-panel")?.focus());
    }
  }
  const layoutStyle = { "--assets-width": `${assetsWidth}px` } as CSSProperties;
  const sidebar = <WorkspaceSidebar busy={busy} activeKey={contextKey} projectPath={project?.mainFile ?? null} view={settingsPage ? "settings" : view}
    recents={recents} failedRecent={failedRecent} onView={(next) => { setView(next); setSettingsPage(false); setDrawerOpen(false); }}
    onSettings={() => { setDrawerOpen(false); setSettingsPage(true); }} onOpenTex={() => { setDrawerOpen(false); openProject(); }}
    onRecent={(entry) => { setDrawerOpen(false); setSettingsPage(false); openRecent(entry); }}
    onRemove={(entry) => { const saved = removeRecent(entry); setRecents(readRecents()); setNotice(saved ? "已移除最近记录，文件未删除" : "无法移除记录，请检查应用存储权限"); }} />;

  return <TooltipProvider delayDuration={350}><div className="app-shell">
    <div className="workbench" inert={review !== null || undoEntry !== null || problemId !== null || updateOpen}>
      <a href="#main-content" className="skip-link">跳转到工作区</a>
      {!narrow && <aside className="workspace-sidebar" data-collapsed={!sidebarOpen} aria-hidden={!sidebarOpen} inert={!sidebarOpen}>{sidebar}</aside>}
      <div className="workspace-main">
      <header className="app-toolbar">
        <IconButton id="sidebar-toggle" label={narrow ? "打开项目导航" : sidebarOpen ? "收起侧栏" : "展开侧栏"} aria-expanded={narrow ? drawerOpen : sidebarOpen} onClick={() => narrow ? setDrawerOpen(true) : setSidebarOpen((value) => !value)}><PanelLeft aria-hidden="true" /></IconButton>
        <div className="project-title">{project ? <><h1 title={project.mainFile}>{fileName(project.mainFile)}</h1><p title={project.root}>{project.root}</p></> : <span>Texgo</span>}</div>
        <div className="toolbar-actions">{project && <Badge variant="outline" className="project-file-count">{project.texFiles.length} 个 TeX 文件</Badge>}<WorkbenchMenu busy={busy} hasProject={Boolean(project)} canUndo={history.some((entry) => entry.canUndo) || Boolean(project?.undoAvailable)} onOpen={openProject} onClose={closeProject} onRefresh={() => { void execute("opening", () => refresh()); }} onUpdate={() => setUpdateOpen(true)} onUndo={() => {
          const entry = history.find((item) => item.canUndo); if (entry) { rememberFocus(); setUndoEntry(entry); } else if (project?.undoAvailable) replace(true);
        }} /></div>
      </header>
      {error && !review && !undoEntry && !problemId && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>操作未完成</AlertTitle><AlertDescription className="flex items-start justify-between gap-4"><span>{error}</span><IconButton label="关闭错误提示" onClick={() => setError(null)}><X aria-hidden="true" /></IconButton></AlertDescription></Alert>}
      {project?.status.blockingReason && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>需要先解决安全问题</AlertTitle><AlertDescription>{project.status.blockingReason}</AlertDescription></Alert>}
      {settingsPage && <div className="page-enter settings-view"><SettingsPage value={preferences} onSaved={setPreferences} onClose={() => setSettingsPage(false)} /></div>}
      {!project && !settingsPage && <Home busy={busy} onOpenTex={openProject} recents={recents} onRecent={openRecent} />}
      {project && <>
        <main id={settingsPage ? undefined : "main-content"} tabIndex={-1} className="workspace-content" hidden={settingsPage} data-view={view}>
          <div className="workspace-grid" hidden={view !== "assets"} data-view={view} style={layoutStyle}>
            <div className="workspace-library"><AssetList images={visibleImages} allImages={project.images} ignored={ignored} pendingIds={pendingIds} problemIds={problemIds} completedIds={completedIds}
              selectionMode={selectionMode} onIgnore={(id, value) => { void ignoreAsset(id, value); }} onInspect={inspectProblem} onLocate={locateRepair} total={project.status.totalImages} selected={selected} activeId={activeId} results={results}
              busy={busy} previewDisabled={busy && operation !== "converting"} search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} onActivate={setActiveId}
              onSelect={(id) => { if (!busy && pendingIds.has(id)) setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }}
              onSelectAll={(ids, select) => { if (!busy) setSelected((previous) => { const next = new Set(previous); ids.filter((id) => pendingIds.has(id)).forEach((id) => { if (select) next.add(id); else next.delete(id); }); return next; }); }} /></div>
            <Splitter label="调整图片列表宽度" value={assetsWidth} min={340} max={900} onChange={setAssetsWidth} />
            <div className="asset-inspector" key={contextKey ?? undefined}><AssetPreview busy={busy} asset={activeAsset} result={activeAsset ? results[activeAsset.id] : undefined} revision={revision} ignored={activeAsset ? ignored.has(activeAsset.id) : false}
              statusLabel={activeAsset ? ignored.has(activeAsset.id) ? "已忽略" : problemIds.has(activeAsset.id) ? "需要处理" : pendingIds.has(activeAsset.id) ? activeAsset.updateAvailable ? "有更新" : "待转换" : "已完成" : undefined}
              onInspect={inspectProblem} onLocate={locateRepair} onRetry={project.status.blockingReason ? undefined : retryAsset} onIgnore={(id, value) => { void ignoreAsset(id, value); }} /></div>
          </div>
          <div className="history-view page-enter" hidden={view !== "history"}><ConversionHistory highlightId={highlightBatch} entries={history} busy={busy} onUndo={(entry) => { rememberFocus(); setError(null); setUndoEntry(entry); }} /></div>
        </main>
        <div hidden={settingsPage}><CommandBar status={project.status} settings={settings} selectionMode={selectionMode} selectedCount={selected.size} busy={busy} converting={operation === "converting"} progress={progress} completion={completion} cancelRequested={cancelRequested}
          onAction={nextAction} onSettings={updateSettings} onSelectionMode={(enabled) => { setSelectionMode(enabled); if (!enabled) setSelected(new Set()); }} onCancel={() => { void cancelConversion(); }} /></div>
      </>}
      <footer className="status-bar"><div className="status-text" role="status" aria-live="polite">{operation === "opening" ? <LoaderCircle className="spin" aria-hidden="true" /> : project ? <Check aria-hidden="true" /> : <span className="status-dot" />}<span>{operation && operation !== "converting" ? operationLabels[operation] : notice}</span></div></footer>
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
        <DialogHeader><DialogTitle>撤销此次操作？</DialogTitle><DialogDescription>将恢复本次任务修改的引用和 PDF，保留原图片。文件已被其他程序修改时会停止撤销。</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setUndoEntry(null); setError(null); }}>取消</Button><Button variant="destructive" disabled={busy} onClick={undoConversion}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RotateCcw data-icon="inline-start" aria-hidden="true" />}确认撤销</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {updateOpen && <ApplicationUpdate onClose={() => setUpdateOpen(false)} />}
    {dragging && <div className="drop-overlay" role="status">松开以打开 .tex 主文件</div>}
  </div></TooltipProvider>;
}
