import { useAssetFileActions } from "./hooks/useAssetFileActions";
import { useTransientOverlay } from "./hooks/useTransientOverlay";
import { useWorkspaceGuard } from "./hooks/useWorkspaceGuard";
import { mayStartOperation } from "./state/businessDecision";
import type { DecisionAction } from "./state/businessDecision";
import { useDesktopEvents } from "./hooks/useDesktopEvents";
import { useBackgroundAutomation } from "./hooks/useBackgroundAutomation";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useConversion } from "./hooks/useConversion";
import { useReviewFlow } from "./hooks/useReviewFlow";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, LoaderCircle, PanelLeft, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/controls/alert";
import { Button } from "@/controls/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/controls/dialog";
import { TooltipProvider } from "@/controls/tooltip";
import IconButton from "./IconButton";
import AssetList from "./AssetList";
import AssetPreview from "./AssetPreview";
import CommandBar from "./CommandBar";
import ErrorNotice from "./ErrorNotice";
import Home from "./Home";
import WorkspaceSearch from "./WorkspaceSearch";
import "./workspace-native.css";
import "./overview.css";
import WorkspaceSidebar from "./WorkspaceSidebar";
import { SettingsView, HistoryView, UpdateView } from "./SecondaryViews";
import { defaultPreferences } from "./preferences";
import type { Preferences } from "./preferences";
import WorkbenchMenu from "./WorkbenchMenu";
import AssetProblems from "./AssetProblems";
import ReviewDialog from "./ReviewDialog";
import Splitter from "./Splitter";
import { readRecents } from "./recents";
import type { Project, NotificationTarget, ChangePreview, RenameResult, IgnoreMode } from "./types";
import { errorMessage, fileName } from "./utils";

import { useOperation } from "./hooks/useOperation";
import { useWorkspace } from "./hooks/useWorkspace";
import { useAssetSelection } from "./hooks/useAssetSelection";
import { useHistory } from "./hooks/useHistory";
import type { Operation } from "./state/operationMachine";
const operationLabels: Record<Operation, string> = { opening: "正在扫描…", converting: "正在更新图片…", reviewing: "正在读取引用变更…", applying: "正在替换引用…", undoing: "正在撤销…", updating: "正在更新项目状态…", renaming: "正在重命名图片…" };

export default function App() {
  const transientOverlayOpen = useTransientOverlay();
  const captureAppLifetime = useWorkspaceGuard(() => 0);
  const conversionRef = useRef<ReturnType<typeof useConversion> | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [settingsPage, setSettingsPage] = useState(false);
  const [homePage, setHomePage] = useState(false);
  const [highlightBatch, setHighlightBatch] = useState<string | null>(null);
  const notificationNavigate = useRef<(payload: { project: Project; target: NotificationTarget }) => Promise<void>>(async () => {});
  const [view, setView] = useState<"assets" | "history">("assets");
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const { state: operationState, current: currentOperation, acquire: acquireOperation, release: releaseOperation, run: runOperation } = useOperation();
  const operation = operationState.status === "running" ? operationState.kind : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("就绪");
  const [revision, setRevision] = useState(0);
  const [assetsWidth, setAssetsWidth] = useState(600);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const desktopAction = useRef<(action: string) => void>(() => {});
  const dropFiles = useRef<(paths: string[]) => void>(() => {});
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 980px)").matches ?? false);
  const busy = operation !== null;
  const [windowVisible, setWindowVisible] = useState(!document.hidden);
  useEffect(() => { const update = () => setWindowVisible(!document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const workspace = useWorkspace({
    preferences: () => preferencesRef.current, execute, isBusy: () => Boolean(currentOperationKind()),
    onAccept: (next, same) => {
      if (!same) { clearAssetState(); setHomePage(false); setSettingsPage(false); setView("assets"); historyDomain.reset(); }
      selection.acceptSnapshot(next, same);
      setResults(Object.fromEntries(next.convertedImages.map((image) => [image.id, image])));
      setRevision((value) => value + 1);
    },
    onReset: () => { setHomePage(true); clearAssetState(); historyDomain.reset(); setSettingsPage(false); setDrawerOpen(false); },
    loadHistory: () => historyDomain.load(), onNotice: setNotice,
  });
  const { project, current: projectRef, contextKey, recents, failedRecent, settings, acceptProject, refresh,
    openProject, openRecent, closeProject, updateSettings } = workspace;
  const homeVisible = !project || homePage;
  const homeLanding = homeVisible && !settingsPage;
  const sidebarExpanded = sidebarOpen;
  const showWorkspace: typeof setView = (next) => { setHomePage(false); setView(next); };
  const captureWorkspace = useWorkspaceGuard(() => workspace.generation.current);
  const selection = useAssetSelection(project);
  const { selected, selectionMode, renameRequest, activeId, search, filter, activeAsset, visibleImages,
    pendingIds, convertibleIds, problemIds, ignored, completedIds, activate: setActiveId,
    changeSearch: setSearch, changeFilter: setFilter } = selection;
  const reviewFlow = useReviewFlow({ workspace, selection, execute, currentOperationKind, setError, setNotice, rememberFocus, restoreFocus, setView: showWorkspace,
    completionVisible: () => conversionRef.current?.completionVisible() ?? false, automaticReviewAllowed: !homeVisible && !settingsPage && windowVisible && !updateOpen && !drawerOpen && !transientOverlayOpen });
  const historyDomain = useHistory({
    currentProject: () => projectRef.current, generation: () => workspace.generation.current,
    execute, acceptProject, refresh, discardProject: workspace.discardProject,
    restoreRename: selection.restoreRename, restoreFocus, onError: setError,
    undoEntry: () => reviewFlow.undoEntry, requestUndo: (entry) => reviewFlow.requestUndo(entry), dismissUndo: () => reviewFlow.dismissUndo(),
  });
  const { history, load: loadHistory, undoConversion } = historyDomain;
  const canReview = (project?.status.pendingReferences ?? 0) > 0;
  const conversion = useConversion({ workspace, selection, execute, currentOperationKind, setError, setNotice, rememberFocus, restoreFocus, preferences, reviewFlow, loadHistory, setHighlightBatch });
  conversionRef.current = conversion;
  const { completion, results, progress, cancelRequested, setCompletion, setResults, convert, cancelConversion, allowManualConversionPanel } = conversion;
  const { review, problemId, undoEntry, conversionBlocked, repairCandidates, setReview, setProblemId, setConversionBlocked, reviewChanges, inspectProblem, chooseRepair, locateRepair, replace } = reviewFlow;


  const decisionOpen = reviewFlow.decision.kind !== "none";
  const background = useBackgroundAutomation({ workspace, selection, execute, currentOperationKind, setError, setNotice,
    conversion, reviewFlow, historyDomain, operationDomain: { current: currentOperation, acquire: acquireOperation, release: releaseOperation },
    autoWatch: preferences.autoWatch, held: decisionOpen || completion !== null || updateOpen || homeVisible,
    onNavigate: (payload) => notificationNavigate.current(payload), setRevision });
  useDesktopEvents({ background, onAction: (action) => desktopAction.current(action), onDrop: (paths) => dropFiles.current(paths), setDragging });
  useEffect(() => {
    if (!notice.startsWith("检测到")) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 980px)");
    if (!media) return;
    const update = () => { setNarrow(media.matches); setDrawerOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let disposed = false;
    void invoke<Preferences>("get_preferences").then((value) => {
      if (disposed || !value) return;
      preferencesRef.current = value;
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

  function showHome() {
    if (currentOperationKind() || reviewFlow.decisionRef.current.kind !== "none" || updateOpen) return;
    setHomePage(true); setSettingsPage(false); setDrawerOpen(false); setNotice("");
  }
  function openRecentEntry(entry: Parameters<typeof openRecent>[0]) {
    if (currentOperationKind() || reviewFlow.decisionRef.current.kind !== "none" || updateOpen) return;
    if (projectRef.current?.mainFile === entry.path) { showWorkspace("assets"); setSettingsPage(false); }
    else openRecent(entry);
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

  function currentOperationKind() {
    const state = currentOperation();
    return state.status === "running" ? state.kind : null;
  }

  async function execute(kind: Operation, action: () => Promise<void>, decisionAction?: DecisionAction) {
    if (!mayStartOperation(reviewFlow.decisionRef.current, kind, decisionAction)) return;
    const isMounted = captureAppLifetime();
    const generation = workspace.generation.current;
    try { await runOperation(kind, "foreground", async () => { setError(null); await action(); }); }
    catch (reason) { if (isMounted() && (workspace.generation.current === generation || !projectRef.current)) setError(errorMessage(reason)); }
  }

  const { revealAsset, copyAssetPath } = useAssetFileActions({ currentProject: () => projectRef.current, isBusy: () => Boolean(currentOperationKind()), captureWorkspace, execute, onNotice: setNotice });

  function clearAssetState() {
    selection.reset();
    conversion.reset();
    reviewFlow.reset();
    setRevision((value) => value + 1);
  }

  async function ignoreAsset(id: string, mode: IgnoreMode = "session") {
    if (currentOperationKind() || !projectRef.current) return;
    await execute("updating", async () => {
      const next = await invoke<Project>("ignore_asset", { imageId: id, mode });
      await acceptProject(next, true);
      selection.removeSelected([id]);
      setProblemId(null); setError(null); setNotice(mode === "permanent" ? "已始终忽略，可随时恢复处理" : mode === "session" ? "已忽略本次，源文件未修改" : "已恢复处理");
    }, reviewFlow.problemId === id ? "ignore-problem" : undefined);
  }

  async function renameAsset(imageId: string, newBaseName: string) {
    const current = projectRef.current;
    if (!current || reviewFlow.decisionRef.current.kind !== "none") throw new Error("已有项目操作正在运行，请稍后重试");
    const outcome = await runOperation("renaming", "foreground", async () => {
      setError(null);
      const result = await invoke<RenameResult>("rename_asset", { imageId, newBaseName, expectedFingerprint: current.stateFingerprint ?? "" });
      selection.migrateIdentity(result.oldImageId, result.newImageId);
      await acceptProject(result.project, true);
      const entry = result.project.images.find((image) => image.id === result.newImageId);
      setNotice(`已重命名${entry?.references.length ? `，并更新 ${entry.references.length} 处 LaTeX 引用` : ""}`);
    });
    if (!outcome.acquired) throw new Error("已有项目操作正在运行，请稍后重试");
  }

  function retryAsset(imageId: string) {
    if (currentOperationKind()) return;
    void execute("updating", async () => acceptProject(await invoke<Project>("retry_asset", { imageId }), true, "已准备重试，请确认更新图片"));
  }

  notificationNavigate.current = async ({ project: next, target }) => {
      setHomePage(false);
      setReview(null); reviewFlow.clearQueue(); setCompletion(null); setProblemId(null); reviewFlow.dismissUndo(); setUpdateOpen(false); setSettingsPage(false);
      const same = project?.root === next.root && project?.mainFile === next.mainFile;
      await acceptProject(next, same);
      const isCurrent = captureWorkspace();
      if (!isCurrent()) return;
      setHighlightBatch(target.batchId);
      if (target.view === "review") {

        try { const plan = await invoke<ChangePreview>("preview_changes"); if (!isCurrent()) return; if (plan.referenceCount) setReview(plan); else setView("history"); }
        catch (reason) { if (isCurrent()) { setError(errorMessage(reason)); setView("history"); } }
      } else if (target.view === "problems") {
        setView("assets"); setFilter("problems");
        if (target.imageId && next.images.some((image) => image.id === target.imageId)) setActiveId(target.imageId);
      } else { setView(target.view === "images" ? "assets" : "history"); if (target.imageId) setActiveId(target.imageId); }
  };
  desktopAction.current = (action) => {
    if (decisionOpen || updateOpen) return;
    if (action === "settings") { setSettingsPage(true); setDrawerOpen(false); return; }
    if (action === "check-updates") { setUpdateOpen(true); return; }
    if (currentOperationKind() || decisionOpen || updateOpen) return;
    if (["convert", "review", "undo-task"].includes(action)) setHomePage(false);
    if (action === "open-project") openProject();
    else if (action === "close-project") closeProject();
    else if (action === "refresh" && project) void execute("opening", () => refresh());
    else if (action === "convert") nextAction();
    else if (action === "review" && canReview) reviewChanges();
    else if (action === "undo-task") {
      const entry = history.find((item) => item.canUndo);
      if (entry) { rememberFocus(); reviewFlow.requestUndo(entry); }
      else if (project?.undoAvailable) replace(true);
    }
  };
  dropFiles.current = (paths) => {
    if (currentOperationKind() || decisionOpen || updateOpen) return;
    const tex = paths.filter((path) => /\.tex$/i.test(path));
    if (tex.length !== 1) { setError("请一次拖入一个 .tex 主文件"); return; }
    void workspace.openPath(tex[0]);
  };

  useAppShortcuts({ homePage: homeVisible, settingsPage, setSettingsPage, blocked: decisionOpen || updateOpen || drawerOpen,
    busy, view, setView: showWorkspace, activeAsset, activeId, visibleImages, selection, desktopAction });
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
  const sidebar = <WorkspaceSidebar busy={busy} activeKey={contextKey} projectPath={project?.mainFile ?? null} status={project?.status} filter={filter} onFilter={setFilter} onHome={showHome} view={settingsPage ? "settings" : homeVisible ? "home" : view}
    recents={recents} failedRecent={failedRecent} onView={(next) => { showWorkspace(next); setSettingsPage(false); setDrawerOpen(false); }}
    onSettings={() => { setDrawerOpen(false); setSettingsPage(true); }} onOpenTex={() => { setDrawerOpen(false); openProject(); }}
    onRecent={(entry) => { setDrawerOpen(false); setSettingsPage(false); openRecentEntry(entry); }}
    onRemove={workspace.forgetRecent} />;

  return <TooltipProvider delayDuration={350}><div className="app-shell mac-workspace">
    <div className="workbench" inert={review !== null || undoEntry !== null || problemId !== null || updateOpen || conversionBlocked}>
      <a href="#main-content" className="skip-link">跳转到工作区</a>
      {!homeLanding && !narrow && <aside className="workspace-sidebar" data-collapsed={!sidebarExpanded} aria-hidden={!sidebarExpanded} inert={!sidebarExpanded}>{sidebar}</aside>}
      <div className="workspace-main">
      <header className="app-toolbar">
        {!homeLanding && <IconButton id="sidebar-toggle" label={narrow ? "打开项目导航" : sidebarExpanded ? "收起侧栏" : "展开侧栏"} aria-expanded={narrow ? drawerOpen : sidebarExpanded} onClick={() => narrow ? setDrawerOpen(true) : setSidebarOpen((value) => !value)}><PanelLeft aria-hidden="true" /></IconButton>}
        {(narrow || !sidebarExpanded) && (!homeVisible || settingsPage) && <Button variant="ghost" className="px-2!" aria-label="Texgo 首页" disabled={busy} onClick={showHome}>Texgo</Button>}<div className="project-title">{project && !homeVisible && !settingsPage ? <><h1 title={project.mainFile}>{fileName(project.mainFile)}</h1><p title={project.root}>{project.root}</p></> : null}</div>
        {project && !homeVisible && !settingsPage && view === "assets" && <WorkspaceSearch value={search} onChange={setSearch} />}
        <div className="toolbar-actions"><WorkbenchMenu busy={busy} hasProject={Boolean(project)} canUndo={history.some((entry) => entry.canUndo) || Boolean(project?.undoAvailable)} onOpen={openProject} onClose={closeProject} onRefresh={() => { void execute("opening", () => refresh()); }} onUpdate={() => setUpdateOpen(true)} onUndo={() => {
          const entry = history.find((item) => item.canUndo); if (entry) { rememberFocus(); reviewFlow.requestUndo(entry); } else if (project?.undoAvailable) replace(true);
        }} /></div>
      </header>
      {error && !review && !undoEntry && !problemId && <ErrorNotice message={error} className="workbench-alert" onClose={() => setError(null)} />}
      {project?.status.blockingReason && !homeVisible && !settingsPage && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>需要先解决安全问题</AlertTitle><AlertDescription>{project.status.blockingReason}</AlertDescription></Alert>}
      <div className="page-enter settings-view" hidden={!settingsPage} inert={!settingsPage}><SettingsView active={settingsPage} value={preferences} onSaved={(next) => { preferencesRef.current = next; setPreferences(next); }} onClose={() => setSettingsPage(false)} /></div>
      {homeVisible && !settingsPage && <Home busy={busy} onOpenTex={openProject} recents={recents} failedRecent={failedRecent} onRecent={openRecentEntry} onRemove={workspace.forgetRecent} />}
      {project && <>
        <main id={settingsPage || homeVisible ? undefined : "main-content"} tabIndex={-1} className="workspace-content" hidden={settingsPage || homeVisible} data-view={view} onKeyDownCapture={(event) => {
          if (selectionMode && event.key === "Escape" && !busy && view === "assets" && !(event.target as HTMLElement).closest(".asset-rename")) {
            event.preventDefault(); event.stopPropagation(); selection.clearSelection();
          }
        }}>
          <div className="workspace-grid" hidden={view !== "assets"} data-view={view} style={layoutStyle}>
            <div className="workspace-library"><AssetList showSummary={narrow || !sidebarExpanded} thumbnailContext={{ mainFile: project.mainFile, revision, enabled: !homeVisible && !settingsPage && view === "assets" }} showSearchAndFilters={false} images={visibleImages} allImages={project.images} ignored={ignored} pendingIds={pendingIds} problemIds={problemIds} completedIds={completedIds}
              onReveal={revealAsset} onCopyPath={copyAssetPath} selectionMode={selectionMode} renameRequest={renameRequest} onRename={renameAsset} convertibleIds={convertibleIds} onManualConvert={(id) => convert("reconvert", [id])} onIgnore={(id, value) => { void ignoreAsset(id, value); }} onInspect={inspectProblem} onLocate={locateRepair} total={project.status.totalImages} selected={selected} activeId={activeId} results={results}
              busy={busy} previewDisabled={busy && operation !== "converting"} search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} onActivate={setActiveId}
              onSelect={(id) => { if (!busy) selection.toggleSelected(id); }}
              onSelectAll={(ids, select) => { if (!busy) selection.selectMany(ids, select); }} /></div>
            <Splitter label="调整图片列表宽度" value={assetsWidth} min={340} max={900} onChange={setAssetsWidth} />
            <div className="asset-inspector" key={contextKey ?? undefined}><AssetPreview busy={busy} canConvert={activeId ? convertibleIds.has(activeId) : false} onManualConvert={(id) => convert("reconvert", [id])} asset={activeAsset} result={activeAsset ? results[activeAsset.id] : undefined} revision={revision} ignored={activeAsset ? ignored.has(activeAsset.id) : false}
              statusLabel={activeAsset ? ignored.has(activeAsset.id) ? "已忽略" : problemIds.has(activeAsset.id) ? "需要处理" : pendingIds.has(activeAsset.id) ? activeAsset.updateAvailable ? "有更新" : "待处理" : "已完成" : undefined}
              onInspect={inspectProblem} onLocate={locateRepair} onRetry={project.status.blockingReason ? undefined : retryAsset} onIgnore={(id, value) => { void ignoreAsset(id, value); }} /></div>
          </div>
          <HistoryView active={view === "history"} onReturn={() => setView("assets")} highlightId={highlightBatch} entries={history} busy={busy} onUndo={(entry) => { rememberFocus(); setError(null); reviewFlow.requestUndo(entry); }} />
        </main>
        <div hidden={settingsPage || homeVisible}><CommandBar status={project.status} settings={settings} selectionMode={selectionMode} selectedCount={selected.size} busy={busy} converting={operation === "converting"} progress={progress} completion={completion} cancelRequested={cancelRequested}
          onAction={nextAction} onConvert={convert} onManualOpen={allowManualConversionPanel} currentImageId={activeId} convertibleIds={[...convertibleIds]} onSettings={updateSettings} onSelectionMode={(enabled) => { setView("assets"); selection.changeSelectionMode(enabled); }} onCancel={() => { void cancelConversion(); }} /></div>
      </>}
      {notice && notice !== "就绪" && !notice.startsWith("已识别") && !homeVisible && <footer className="status-bar"><div className="status-text" role="status" aria-live="polite">{operation === "opening" ? <LoaderCircle className="spin" aria-hidden="true" /> : project ? <Check aria-hidden="true" /> : <span className="status-dot" />}<span>{operation && operation !== "converting" ? operationLabels[operation] : notice}</span></div></footer>}
      </div>
    </div>
    <Dialog open={!homeLanding && narrow && drawerOpen} onOpenChange={setDrawerOpen}>
      <DialogContent className="navigation-drawer translate-x-0! translate-y-0!" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("sidebar-toggle")?.focus(); }}>
        <DialogTitle className="sr-only">项目导航</DialogTitle><DialogDescription className="sr-only">打开项目与最近工作区</DialogDescription>
        <Button variant="ghost" size="icon" className="drawer-close" aria-label="关闭项目导航" title="关闭项目导航" onClick={() => setDrawerOpen(false)}><X aria-hidden="true" /></Button>
        {sidebar}
      </DialogContent>
    </Dialog>
    {problemId && project && <AssetProblems asset={project.images.find((image) => image.id === problemId) ?? null} projectRoot={project.root} busy={busy} candidates={repairCandidates} candidatesLoading={operation === "reviewing"} error={error} onClose={() => { setProblemId(null); setError(null); restoreFocus(); }} onLocate={locateRepair} onChoose={chooseRepair} onIgnore={(id) => { void ignoreAsset(id); }} />}
    {review && project && <ReviewDialog key={JSON.stringify(review)} preview={review} root={project.root} busy={busy} error={error} conflict={reviewFlow.decision.kind === "review" ? reviewFlow.decision.conflict : undefined} onRescan={reviewFlow.rescanReview} onClose={() => { if (!currentOperationKind()) { setReview(null); setError(null); restoreFocus(); } }} onApply={(selection) => replace(false, selection)} />}
    <Dialog open={conversionBlocked} onOpenChange={setConversionBlocked}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogHeader><DialogTitle>请先审核引用</DialogTitle><DialogDescription>当前有 {project?.status.pendingReferences ?? 0} 处引用尚未审核。建议先完成引用审核，再开始新的转换。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConversionBlocked(false)}>取消</Button><Button onClick={() => { setConversionBlocked(false); reviewChanges(); }}>检查引用</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={undoEntry !== null} onOpenChange={(value) => { if (!value && !currentOperationKind()) { reviewFlow.dismissUndo(); setError(null); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>撤销此次操作？</DialogTitle><DialogDescription>将恢复此次操作修改的文件与引用。重命名操作也会恢复原文件名；文件被外部修改时会停止撤销。</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { reviewFlow.dismissUndo(); setError(null); }}>取消</Button><Button variant="destructive" disabled={busy} onClick={undoConversion}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RotateCcw data-icon="inline-start" aria-hidden="true" />}确认撤销</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {updateOpen && <UpdateView onClose={() => setUpdateOpen(false)} />}
    {dragging && <div className="drop-overlay" role="status">松开以打开 .tex 主文件</div>}
  </div></TooltipProvider>;
}
