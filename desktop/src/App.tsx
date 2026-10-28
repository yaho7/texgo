import { viewTransition } from "./motion";
import { useWorkspaceGeometry } from "./hooks/useWorkspaceGeometry";
import { nativeText } from "./nativeText";
import { t } from "./i18n";
import { setLocale, useLocale } from "./i18n";
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
import { isTauri, invoke } from "@tauri-apps/api/core";
import { LoaderCircle, PanelLeft, RotateCcw, TriangleAlert, X } from "lucide-react";
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
import "./quiet-workspace.css";
import WorkspaceSidebar from "./WorkspaceSidebar";
import { SettingsView, HistoryView, UpdateView } from "./SecondaryViews";
import { defaultPreferences } from "./preferences";
import type { Preferences } from "./preferences";
import WorkbenchMenu from "./WorkbenchMenu";
import AssetProblems from "./AssetProblems";
import ReviewDialog from "./ReviewDialog";
import Splitter from "./Splitter";
import { readRecents } from "./recents";
import type { Project, NotificationTarget, ChangePreview, RenamePreview, RenameResult, IgnoreMode } from "./types";
import { errorMessage, fileName } from "./utils";

import { useOperation } from "./hooks/useOperation";
import { useWorkspace } from "./hooks/useWorkspace";
import { useAssetSelection } from "./hooks/useAssetSelection";
import { useHistory } from "./hooks/useHistory";
import type { Operation } from "./state/operationMachine";
const operationLabels: Record<Operation, string> = { get opening() { return t("app.scanning"); }, get converting() { return t("app.updatingImages"); }, get reviewing() { return t("app.readingReferenceChanges"); }, get applying() { return t("app.applyingReferenceChanges"); }, get undoing() { return t("app.undoing"); }, get updating() { return t("app.refreshingProjectStatus"); }, get renaming() { return t("app.renamingImage"); } };

export default function App() {
  useLocale();
  const transientOverlayOpen = useTransientOverlay();
  const captureAppLifetime = useWorkspaceGuard(() => 0);
  const conversionRef = useRef<ReturnType<typeof useConversion> | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [settingsPage, setSettingsPage] = useState(false);
  const [homePage, setHomePage] = useState(false);
  const [pendingRename, setPendingRename] = useState<{ id:string; name:string; fingerprint:string; mainFile:string; preview:RenamePreview } | null>(null);
  const [renameReviewOpen, setRenameReviewOpen] = useState(false);
  const [renameConflict, setRenameConflict] = useState<{path:string;message:string}>();
  const [highlightBatch, setHighlightBatch] = useState<string | null>(null);
  const notificationNavigate = useRef<(payload: { project: Project; target: NotificationTarget }) => Promise<void>>(async () => {});
  const [view, setView] = useState<"assets" | "history">("assets");
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const { state: operationState, current: currentOperation, acquire: acquireOperation, release: releaseOperation, run: runOperation } = useOperation();
  const operation = operationState.status === "running" ? operationState.kind : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
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
  useEffect(() => { setPendingRename(null); setRenameReviewOpen(false); setRenameConflict(undefined); }, [project?.mainFile]);
  const homeVisible = !project || homePage;
  const homeLanding = homeVisible && !settingsPage;
  const { shellRef, commandRef } = useWorkspaceGeometry(Boolean(project) && !homeVisible && !settingsPage, notice);
  const sidebarExpanded = sidebarOpen;
  const showWorkspace: typeof setView = (next) => { setHomePage(false); setView(next); };
  const captureWorkspace = useWorkspaceGuard(() => workspace.generation.current);
  const selection = useAssetSelection(project);
  const { selected, selectionMode, renameRequest, activeId, search, filter, activeAsset, visibleImages,
    pendingIds, convertibleIds, problemIds, ignored, completedIds, activate: setActiveId,
    changeSearch: setSearch, changeFilter: setFilter } = selection;
  const reviewFlow = useReviewFlow({ workspace, selection, execute, currentOperationKind, setError, setNotice, rememberFocus, restoreFocus, setView: showWorkspace,
    completionVisible: () => conversionRef.current?.completionVisible() ?? false, automaticReviewAllowed: !homeVisible && !settingsPage && windowVisible && !updateOpen && !drawerOpen && !transientOverlayOpen && !pendingRename });
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
    autoWatch: preferences.autoWatch, held: decisionOpen || completion !== null || updateOpen || homeVisible || Boolean(pendingRename),
    onNavigate: (payload) => notificationNavigate.current(payload), setRevision });
  useDesktopEvents({ background, onAction: (action) => desktopAction.current(action), onDrop: (paths) => dropFiles.current(paths), setDragging });
  useEffect(() => {
    if (!notice || notice === t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable")) return;
    const timer = window.setTimeout(() => setNotice(""), notice === t("assetFileActions.copiedTheFullImagePath") ? 1500 : 4000);
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
      void setLocale(value.language ?? "zh-CN").catch(reason => setError(errorMessage(reason)));
      if (value.startup === "lastWorkspace") { const last = readRecents()[0]; if (last) openRecent(last); }
      const current = import.meta.env.VITE_RELEASE_TAG;
      if (value.autoUpdate && current && current !== "development") {
        void invoke<import("./ApplicationUpdate").ApplicationUpdateInfo>("check_application_update")
          .then(info => { if (!disposed && info.stage === "available") setNotice(t("app.versionValueIsAvailableCheckForUpdatesInTheMenu", { arg0: info.version })); }).catch(() => {});
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
    try { await runOperation(kind, "foreground", async () => { setError(null); await action(); if (isMounted()) workspace.recordActivity(); }); }
    catch (reason) { if (isMounted() && (workspace.generation.current === generation || !projectRef.current)) setError(errorMessage(reason)); }
  }

  const { revealAsset, revealPdf, copyAssetPath } = useAssetFileActions({ currentProject: () => projectRef.current, isBusy: () => Boolean(currentOperationKind()), captureWorkspace, execute, onNotice: setNotice });

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
      setProblemId(null); setError(null); setNotice("");
    }, reviewFlow.problemId === id ? "ignore-problem" : undefined);
  }

  async function renameAsset(imageId: string, newBaseName: string) {
    const current = projectRef.current;
    if (!current || reviewFlow.decisionRef.current.kind !== "none") throw new Error(t("app.aProjectOperationIsRunningTryAgainWhenItFinishes"));
    const outcome = await runOperation("reviewing", "foreground", async () => {
      const fingerprint = current.stateFingerprint ?? "";
      const preview = await invoke<RenamePreview>("preview_rename", {imageId, newBaseName, expectedFingerprint:fingerprint});
      setPendingRename({id:imageId,name:newBaseName,fingerprint,mainFile:current.mainFile,preview});
      setRenameConflict(undefined); setError(null); workspace.recordActivity();
    });
    if (!outcome.acquired) throw new Error(t("app.aProjectOperationIsRunningTryAgainWhenItFinishes"));
  }
  async function applyRename() {
    const plan = pendingRename;
    if (!plan || projectRef.current?.mainFile !== plan.mainFile) return;
    await execute("renaming", async () => {
      try {
        const result = await invoke<RenameResult>("rename_asset", {imageId:plan.id,newBaseName:plan.name,expectedFingerprint:plan.fingerprint});
        selection.migrateIdentity(result.oldImageId,result.newImageId);
        await acceptProject(result.project,true); workspace.recordActivity();
        setPendingRename(null); setRenameReviewOpen(false); setRenameConflict(undefined); setError(null);
        setNotice("");
      } catch (reason) { setRenameConflict({path:plan.mainFile,message:errorMessage(reason)}); throw reason; }
    });
  }
  async function rescanRename() {
    const plan = pendingRename;
    if (!plan) return;
    await execute("reviewing", async () => {
      await refresh(); const current = projectRef.current;
      if (!current || current.mainFile !== plan.mainFile) return;
      const preview = await invoke<RenamePreview>("preview_rename", {imageId:plan.id,newBaseName:plan.name,expectedFingerprint:current.stateFingerprint ?? ""});
      setPendingRename({...plan,fingerprint:current.stateFingerprint ?? "",preview}); setRenameConflict(undefined); setError(null);
    });
  }

  function retryAsset(imageId: string) {
    if (currentOperationKind()) return;
    void execute("updating", async () => acceptProject(await invoke<Project>("retry_asset", { imageId }), true, t("app.readyToRetryConfirmImageProcessingToContinue")));
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
    if (decisionOpen || updateOpen || renameReviewOpen) return;
    if (action === "settings") { setSettingsPage(true); setDrawerOpen(false); return; }
    if (action === "check-updates") { if (!currentOperationKind()) setUpdateOpen(true); return; }
    if (currentOperationKind() || decisionOpen || updateOpen || renameReviewOpen) return;
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
    if (currentOperationKind() || decisionOpen || updateOpen || renameReviewOpen) return;
    const tex = paths.filter((path) => /\.tex$/i.test(path));
    if (tex.length !== 1) { setError(t("app.dropOneTexMainFileAtATime")); return; }
    void workspace.openPath(tex[0]);
  };

  useAppShortcuts({ homePage: homeVisible, settingsPage, setSettingsPage, blocked: decisionOpen || updateOpen || drawerOpen || renameReviewOpen,
    busy, view, setView: showWorkspace, activeAsset, activeId, visibleImages, selection, desktopAction });
  function nextAction() {
    if (pendingRename) { setRenameReviewOpen(true); return; }
    if (!project || busy || project.status.blockingReason) return;
    if (project.status.nextAction === "reviewReferences") reviewChanges();
    else if (project.status.nextAction === "convertImages") convert();
    else if (project.status.nextAction === "resolveProblems") {
      setSettingsPage(false); setView("assets"); setFilter("problems");
      setActiveId(project.status.problemIds[0] ?? activeId);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".preview-panel")?.focus());
    }
  }
  function toggleSidebar() {
    setSidebarOpen(value => !value);
    requestAnimationFrame(() => document.getElementById("sidebar-toggle")?.focus());
  }
  const layoutStyle = { "--assets-width": `${assetsWidth}px` } as CSSProperties;
  const sidebar = <WorkspaceSidebar compact={!narrow && !sidebarExpanded} busy={busy} activeKey={contextKey} projectPath={project?.mainFile ?? null} status={project?.status} filter={filter} onFilter={setFilter} onHome={showHome} onToggleSidebar={narrow ? undefined : toggleSidebar} view={settingsPage ? "settings" : homeVisible ? "home" : view}
    recents={recents} failedRecent={failedRecent} onView={(next) => { showWorkspace(next); setSettingsPage(false); setDrawerOpen(false); }}
    onSettings={() => { setDrawerOpen(false); setSettingsPage(true); }} onOpenTex={() => { setDrawerOpen(false); openProject(); }}
    onRecent={(entry) => { setDrawerOpen(false); setSettingsPage(false); openRecentEntry(entry); }}
    onRemove={workspace.forgetRecent} />;

  return <TooltipProvider delayDuration={350}><div className={`app-shell mac-workspace${isTauri() && /Mac/.test(navigator.platform) ? " native-macos" : ""}`}><div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />
    <div ref={shellRef} className={homeLanding || settingsPage ? "workbench pl-0!" : "workbench"} inert={review !== null || undoEntry !== null || problemId !== null || updateOpen || conversionBlocked || renameReviewOpen}>
      <a href="#main-content" className="skip-link">{t("app.skipToWorkspace")}</a>
      {!homeLanding && !settingsPage && !narrow && <aside className="workspace-sidebar" data-compact={!sidebarExpanded}>{sidebar}</aside>}
      {!homeLanding && !settingsPage && narrow && <aside className="workspace-navigation-rail"><IconButton id="sidebar-toggle" label={narrow ? t("app.openProjectNavigation") : t("app.showSidebar")} aria-expanded={narrow ? drawerOpen : false} onClick={() => narrow ? setDrawerOpen(true) : toggleSidebar()}><PanelLeft aria-hidden="true" /></IconButton></aside>}
      <div className={homeLanding || settingsPage ? "workspace-main border-l-0!" : "workspace-main"}>
      {!homeLanding && !settingsPage && <header className="app-toolbar">
        <div className="project-title">{project && !homeVisible && !settingsPage ? <><h1 title={project.mainFile}>{fileName(project.mainFile)}</h1><p title={project.root}>{project.root}</p></> : null}</div>
        {project && !homeVisible && !settingsPage && view === "assets" && <WorkspaceSearch value={search} onChange={setSearch} />}
        <div className="toolbar-actions"><WorkbenchMenu busy={busy} hasProject={Boolean(project)} canUndo={history.some((entry) => entry.canUndo) || Boolean(project?.undoAvailable)} onOpen={openProject} onClose={closeProject} onRefresh={() => { void execute("opening", () => refresh()); }} onUpdate={() => { if (!currentOperationKind() && reviewFlow.decisionRef.current.kind === "none") setUpdateOpen(true); }} onUndo={() => {
          const entry = history.find((item) => item.canUndo); if (entry) { rememberFocus(); reviewFlow.requestUndo(entry); } else if (project?.undoAvailable) replace(true);
        }} /></div>
      </header>}
      {error && !review && !undoEntry && !problemId && <ErrorNotice message={error} className="workbench-alert" onClose={() => setError(null)} />}
      {project?.status.blockingReason && !homeVisible && !settingsPage && <Alert variant="destructive" role="alert" className="workbench-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>{t("app.resolveTheSafetyIssueFirst")}</AlertTitle><AlertDescription>{nativeText(project.status.blockingReason)}</AlertDescription></Alert>}
      <div className={`settings-view ${viewTransition(settingsPage)}`} hidden={!settingsPage} inert={!settingsPage}><SettingsView active={settingsPage} value={preferences} onSaved={(next) => { preferencesRef.current = next; setPreferences(next); }} onClose={() => setSettingsPage(false)} /></div>
      {homeVisible && !settingsPage && <Home onSettings={() => setSettingsPage(true)} busy={busy} onOpenTex={openProject} recents={recents} failedRecent={failedRecent} onRecent={openRecentEntry} onRemove={workspace.forgetRecent} />}
      {project && <>
        <main id={settingsPage || homeVisible ? undefined : "main-content"} tabIndex={-1} className="workspace-content" hidden={settingsPage || homeVisible} inert={settingsPage || homeVisible} data-view={view} onKeyDownCapture={(event) => {
          if (selectionMode && event.key === "Escape" && !busy && view === "assets" && !(event.target as HTMLElement).closest(".asset-rename")) {
            event.preventDefault(); event.stopPropagation(); selection.clearSelection();
          }
        }}>
          <div className={`workspace-grid ${viewTransition(view === "assets")}`} hidden={view !== "assets"} inert={view !== "assets"} data-view={view} style={layoutStyle}>
            <div className="workspace-library"><AssetList showSummary={narrow || !sidebarExpanded} thumbnailContext={{ mainFile: project.mainFile, revision, enabled: !homeVisible && !settingsPage && view === "assets" }} showSearchAndFilters={false} images={visibleImages} allImages={project.images} ignored={ignored} pendingIds={pendingIds} problemIds={problemIds} completedIds={completedIds}
              onReveal={revealAsset} onRevealPdf={revealPdf} onCopyPath={copyAssetPath} selectionMode={selectionMode} renameRequest={renameRequest} onRename={renameAsset} pendingRename={pendingRename ? {id:pendingRename.id,name:pendingRename.name} : undefined} convertibleIds={convertibleIds} onManualConvert={(id) => convert("reconvert", [id])} onIgnore={(id, value) => { void ignoreAsset(id, value); }} onInspect={inspectProblem} onLocate={locateRepair} total={project.status.totalImages} selected={selected} activeId={activeId} results={results}
              busy={busy} previewDisabled={busy && operation !== "converting"} search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} onActivate={setActiveId}
              onSelect={(id) => { if (!busy) selection.toggleSelected(id); }}
              onSelectAll={(ids, select) => { if (!busy) selection.selectMany(ids, select); }} /></div>
            <Splitter label={t("app.resizeImageList")} value={assetsWidth} min={340} max={900} onChange={setAssetsWidth} />
            <div className="asset-inspector" key={contextKey ?? undefined}><AssetPreview root={project.root} busy={busy} canConvert={activeId ? convertibleIds.has(activeId) : false} onManualConvert={(id) => convert("reconvert", [id])} asset={activeAsset} result={activeAsset ? results[activeAsset.id] : undefined} revision={revision} ignored={activeAsset ? ignored.has(activeAsset.id) : false}
              statusLabel={activeAsset ? ignored.has(activeAsset.id) ? t("app.ignored") : problemIds.has(activeAsset.id) ? t("app.needsAttention") : pendingIds.has(activeAsset.id) ? activeAsset.updateAvailable ? t("app.updatedSource") : t("app.pending") : t("app.completed") : undefined}
              onInspect={inspectProblem} onLocate={locateRepair} onRetry={project.status.blockingReason ? undefined : retryAsset} onIgnore={(id, value) => { void ignoreAsset(id, value); }} /></div>
          </div>
          <HistoryView active={view === "history"} onReturn={() => setView("assets")} highlightId={highlightBatch} entries={history} busy={busy} onUndo={(entry) => { rememberFocus(); setError(null); reviewFlow.requestUndo(entry); }} />
        </main>
        <div ref={commandRef} hidden={settingsPage || homeVisible}><CommandBar pendingRename={pendingRename ? {referenceCount:pendingRename.preview.references.referenceCount} : undefined} status={project.status} settings={settings} selectionMode={selectionMode} selectedCount={selected.size} busy={busy} converting={operation === "converting"} progress={progress} completion={completion} cancelRequested={cancelRequested}
          onAction={nextAction} onConvert={convert} onManualOpen={allowManualConversionPanel} currentImageId={activeId} convertibleIds={[...convertibleIds]} onSettings={updateSettings} onSelectionMode={(enabled) => { setView("assets"); selection.changeSelectionMode(enabled); }} onCancel={() => { void cancelConversion(); }} /></div>
      </>}
      {operation && operation !== "converting" && !homeVisible && !settingsPage && <div className="activity-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />{operationLabels[operation]}</div>}
      {notice && !operation && !homeVisible && !settingsPage && <div className="transient-notice" role="status" aria-live="polite">{nativeText(notice)}</div>}
      </div>
    </div>
    <Dialog open={!homeLanding && !settingsPage && narrow && drawerOpen} onOpenChange={setDrawerOpen}>
      <DialogContent className="navigation-drawer translate-x-0! translate-y-0!" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("sidebar-toggle")?.focus(); }}>
        <DialogTitle className="sr-only">{t("app.projectNavigation")}</DialogTitle><DialogDescription className="sr-only">{t("app.openProjectsAndRecentWorkspaces")}</DialogDescription>
        <Button variant="ghost" size="icon" className="drawer-close" aria-label={t("app.closeProjectNavigation")} title={t("app.closeProjectNavigation")} onClick={() => setDrawerOpen(false)}><X aria-hidden="true" /></Button>
        {sidebar}
      </DialogContent>
    </Dialog>
    {problemId && project && <AssetProblems asset={project.images.find((image) => image.id === problemId) ?? null} projectRoot={project.root} busy={busy} candidates={repairCandidates} candidatesLoading={operation === "reviewing"} error={error} onClose={() => { setProblemId(null); setError(null); restoreFocus(); }} onLocate={locateRepair} onChoose={chooseRepair} onIgnore={(id) => { void ignoreAsset(id); }} />}
    {renameReviewOpen && pendingRename && project && <ReviewDialog key={JSON.stringify(pendingRename.preview)} preview={pendingRename.preview.references} root={project.root} busy={busy} title={t("app.reviewRename")} description={t("app.renameDescription")} applyLabel={t("app.applyRename")} lockSelection error={error} conflict={renameConflict} onRescan={() => { void rescanRename(); }} onClose={() => { if (!currentOperationKind()) { setRenameReviewOpen(false); setPendingRename(null); setRenameConflict(undefined); setError(null); } }} onApply={() => { void applyRename(); }} />}
    {review && project && <ReviewDialog key={JSON.stringify(review)} preview={review} root={project.root} busy={busy} error={error} conflict={reviewFlow.decision.kind === "review" ? reviewFlow.decision.conflict : undefined} onRescan={reviewFlow.rescanReview} onClose={() => { if (!currentOperationKind()) { setReview(null); setError(null); restoreFocus(); } }} onApply={(selection) => replace(false, selection)} />}
    <Dialog open={conversionBlocked} onOpenChange={setConversionBlocked}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogHeader><DialogTitle>{t("app.reviewReferencesFirst")}</DialogTitle><DialogDescription>{t("app.pendingReviewDescription", {count:project?.status.pendingReferences ?? 0})}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConversionBlocked(false)}>{t("app.cancel")}</Button><Button onClick={() => { setConversionBlocked(false); reviewChanges(); }}>{t("app.reviewReferences")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={undoEntry !== null} onOpenChange={(value) => { if (!value && !currentOperationKind()) { reviewFlow.dismissUndo(); setError(null); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t("app.undoThisOperation")}</DialogTitle><DialogDescription>{t("app.restoreThisOperationSFilesAndReferencesIncludingOriginalFilenames")}</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { reviewFlow.dismissUndo(); setError(null); }}>{t("app.cancel")}</Button><Button variant="destructive" disabled={busy} onClick={undoConversion}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RotateCcw data-icon="inline-start" aria-hidden="true" />}{t("app.undoOperation")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {updateOpen && <UpdateView onClose={() => setUpdateOpen(false)} />}
    {dragging && <div className="drop-overlay" role="status">{t("app.dropToOpenTheTexMainFile")}</div>}
  </div></TooltipProvider>;
}
