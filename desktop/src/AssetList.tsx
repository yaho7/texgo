import { nativeText } from "./nativeText";
import { t, getLocale, getLoadedCatalog } from "./i18n";
import { useEffect, useRef, useState } from "react";
import AssetThumbnail from "./AssetThumbnail";
import { useAssetThumbnails } from "./hooks/useAssetThumbnails";
import type { ThumbnailContext } from "./hooks/useAssetThumbnails";
import { Check, ChevronLeft, ChevronRight, Search, MoreHorizontal } from "lucide-react";
import { Input } from "@/controls/input";
import { errorMessage } from "./utils";
import { Badge } from "@/controls/badge";
import { Button } from "@/controls/button";
import { Checkbox } from "@/controls/checkbox";
import { Empty, EmptyHeader, EmptyTitle } from "@/controls/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/controls/input-group";
import { Separator } from "@/controls/separator";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/controls/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@/controls/dropdown-menu";
import { assetActions } from "./assetActions";
import type { AssetActionId } from "./assetActions";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from "@/controls/context-menu";
import type { AssetStatus, ImageAsset, ImageResult } from "./types";
import { formatBytes } from "./utils";
import { motionDuration } from "./motion";

export const statusLabels: Record<AssetStatus, string> = {
  get ready() { return t("assetList.pending"); },
  get missing() { return t("assetList.missingFile"); },
  get unsupported() { return t("assetList.unsupported"); },
  get ambiguous() { return t("assetList.ambiguousPath"); },
  pdf: "PDF",
};

interface Props {
  images: ImageAsset[];
  showSearchAndFilters?: boolean;
  showSummary?: boolean;
  thumbnailContext?: ThumbnailContext;
  selectionMode: boolean;
  pendingIds: Set<string>;
  problemIds: Set<string>;
  completedIds: Set<string>;
  allImages?: ImageAsset[];
  ignored?: Set<string>;
  onIgnore?: (id: string, mode: "none" | "session" | "permanent") => void;
  onRename?: (id: string, newBaseName: string) => Promise<void>;
  pendingRename?: { id: string; name: string };
  renameRequest?: { id: string; token: number };
  convertibleIds?: Set<string>;
  onManualConvert?: (id: string) => void;
  onReveal?: (id: string) => void;
  onRevealPdf?: (id: string) => void;
  onCopyPath?: (id: string) => void;
  onInspect?: (id: string) => void;
  onLocate?: (id: string) => void;
  total: number;
  selected: Set<string>;
  activeId: string | null;
  results: Record<string, ImageResult>;
  busy: boolean;
  previewDisabled?: boolean;
  search: string;
  filter: string;
  onSearch: (value: string) => void;
  onFilter: (value: string) => void;
  onSelect: (id: string) => void;
  onSelectAll: (ids: string[], select: boolean) => void;
  onActivate: (id: string) => void;
}

export default function AssetList(props: Props) {
  const [rename, setRename] = useState<{ id: string; name: string; error: string | null; saving: boolean } | null>(null);
  const latestProps = useRef(props); latestProps.current = props;
  const currentRename = useRef(rename); currentRename.current = rename;
  const renameRef = useRef<HTMLInputElement>(null);
  const renameHandoff = useRef(false);
  const latestImages = useRef(props.allImages ?? props.images);
  latestImages.current = props.allImages ?? props.images;
  const savingRename = useRef(false);
  const renameIdentity = useRef<{ oldId: string; newPath: string } | null>(null);
  const rowKeys = useRef(new Map<string, string>());
  const [renamedPath, setRenamedPath] = useState<string | null>(null);
  const [renamedId, setRenamedId] = useState<string | null>(null);
  function beginRename(asset: ImageAsset) {
    if (!props.onRename || !asset.canRename || props.busy || savingRename.current) return;
    const filename = asset.relativePath.replaceAll("\\", "/").split("/").pop()!;
    const dot = filename.lastIndexOf(".");
    renameHandoff.current = true;
    setRename({ id: asset.id, name: dot > 0 ? filename.slice(0, dot) : filename, error: null, saving: false });
  }
  useEffect(() => {
    if (!rename || rename.saving) return;
    renameRef.current?.focus(); renameRef.current?.select();
    // Native double-click and Radix FocusScope finish their focus handoff after
    // the editor mounts. Preserve only that handoff; genuine outside blur cancels.
    const frame = requestAnimationFrame(() => {
      const input = renameRef.current;
      if (input && document.activeElement !== input) { input.focus(); input.select(); }
      renameHandoff.current = false;
    });
    return () => { cancelAnimationFrame(frame); renameHandoff.current = false; };
  }, [rename?.id]);
  useEffect(() => {
    const request = props.renameRequest;
    if (request) { const asset = (props.allImages ?? props.images).find((image) => image.id === request.id); if (asset) beginRename(asset); }
  }, [props.renameRequest?.token]);
  useEffect(() => {
    if (!renamedPath) return;
    const image = (props.allImages ?? props.images).find((item) => item.relativePath.replaceAll("\\", "/") === renamedPath);
    if (image) { setRenamedId(image.id); setRenamedPath(null); }
  }, [renamedPath, props.allImages, props.images]);
  useEffect(() => { if (!renamedId) return; const timer = window.setTimeout(() => setRenamedId(null), 600); return () => clearTimeout(timer); }, [renamedId]);
  async function submitRename() {
    if (!rename || savingRename.current || !props.onRename) return;
    const name = rename.name;
    if (!name.trim() || name === "." || name === ".." || /[\\/\x00-\x1f\x7f]/.test(name) || /[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      setRename({ ...rename, error: t("assetList.enterAValidFilenameWithoutAPathExtensionOrReserved") }); return;
    }
    savingRename.current = true; setRename({ ...rename, saving: true, error: null });
    try {
      const oldAsset = latestImages.current.find((image) => image.id === rename.id);
      const oldPath = oldAsset?.relativePath.replaceAll("\\", "/") ?? "";
      const filename = oldPath.split("/").pop() ?? "";
      const newPath = oldPath.slice(0, oldPath.length - filename.length) + name + filename.slice(filename.lastIndexOf("."));
      renameIdentity.current = { oldId: rename.id, newPath };
      await props.onRename(rename.id, name);
      const renamed = latestImages.current.find((image) => image.relativePath.replaceAll("\\", "/") === newPath);
      setRenamedId(renamed?.id ?? rename.id); setRenamedPath(renamed ? null : newPath); setRename(null);
    }
    catch (reason) { renameIdentity.current = null; setRename({ ...rename, saving: false, error: errorMessage(reason, t("assetList.cannotRenameSafelyRescanAndTryAgain")) }); requestAnimationFrame(() => renameRef.current?.focus()); }
    finally { savingRename.current = false; }
  }
  const pageSize = 40;
  const pageKey = `${props.search}\0${props.filter}`;
  const [pagination, setPagination] = useState({ key: pageKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(props.images.length / pageSize));
  const page = pagination.key === pageKey ? Math.min(pagination.page, pageCount - 1) : 0;
  const pageImages = props.images.slice(page * pageSize, (page + 1) * pageSize);
  const thumbnail = useAssetThumbnails(pageImages, props.thumbnailContext);
  const convertible = props.convertibleIds ?? props.pendingIds;
  const readyIds = props.images.filter((image) => convertible.has(image.id)).map((image) => image.id);
  const checkedCount = readyIds.filter((id) => props.selected.has(id)).length;
  const allChecked = readyIds.length > 0 && checkedCount === readyIds.length;
  const sourceImages = props.allImages ?? props.images;
  const migrated = renameIdentity.current ? sourceImages.find((image) => image.relativePath.replaceAll("\\", "/") === renameIdentity.current!.newPath) : undefined;
  if (migrated && renameIdentity.current && migrated.id !== renameIdentity.current.oldId) rowKeys.current.set(migrated.id, rowKeys.current.get(renameIdentity.current.oldId) ?? renameIdentity.current.oldId);
  const showResultCount = props.showSummary !== false || Boolean(props.search.trim()) || props.filter !== "all";
  const pageImageKey = pageImages.map((image) => image.id).join("\0");
  const presenceKey = `${pageKey}\0${page}`;
  const [presence, setPresence] = useState({ key: presenceKey, ids: pageImageKey, previous: pageImages, exiting: [] as { asset: ImageAsset; index: number }[] });
  let exiting = presence.exiting;
  if (presence.key !== presenceKey || presence.ids !== pageImageKey) {
    const removed = presence.key === presenceKey ? presence.previous.flatMap((asset, index) => (sourceImages.some((current) => current.id === asset.id) || (migrated && renameIdentity.current?.oldId === asset.id)) ? [] : [{ asset, index }]) : [];
    exiting = presence.key === presenceKey ? [...presence.exiting, ...removed].filter((image, index, items) => items.findIndex((other) => other.asset.id === image.asset.id) === index) : [];
    setPresence({ key: presenceKey, ids: pageImageKey, previous: pageImages, exiting });
  }
  const displayImages = [...pageImages];
  for (const { asset, index } of exiting) {
    if (!displayImages.some((current) => current.id === asset.id)) displayImages.splice(Math.min(index, displayImages.length), 0, asset);
  }
  useEffect(() => {
    if (!presence.exiting.length) return;
    const timer = window.setTimeout(() => setPresence((previous) => ({ ...previous, exiting: [] })), motionDuration("fast"));
    return () => window.clearTimeout(timer);
  }, [presence.exiting]);
  const ignoredCount = sourceImages.filter((image) => image.ignoreMode ? image.ignoreMode !== "none" : props.ignored?.has(image.id)).length;
  const summary = [
    { value: "pending", label: t("assetList.pending"), count: props.pendingIds.size },
    { value: "problems", label: t("assetList.problems"), count: props.problemIds.size },
    { value: "completed", label: t("assetList.completed"), count: props.completedIds.size },
    { value: "all", label: t("assetList.allImages"), count: sourceImages.length - ignoredCount },
  ];
  const scrollArea = useRef<HTMLDivElement>(null);
  const previousStates = useRef<Record<string, string>>({});
  const [highlights, setHighlights] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    const changed: Record<string, string> = {};
    for (const image of sourceImages) {
      const state = props.problemIds.has(image.id) ? "error" : props.completedIds.has(image.id) ? "success" : "pending";
      next[image.id] = state;
      if (previousStates.current[image.id] && previousStates.current[image.id] !== state && state !== "pending") changed[image.id] = state;
    }
    previousStates.current = next;
    if (!Object.keys(changed).length) return;
    setHighlights(changed);
  }, [sourceImages, props.problemIds, props.completedIds]);
  useEffect(() => {
    if (!Object.keys(highlights).length) return;
    const timer = window.setTimeout(() => setHighlights({}), 600);
    return () => window.clearTimeout(timer);
  }, [highlights]);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const node = scrollArea.current;
    if (!node?.animate) return;
    const animation = node.animate([{ opacity: .85, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: motionDuration("fast"), easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [props.filter]);
  function actionsFor(asset: ImageAsset, isExiting = false) {
    const current = latestProps.current;
    const ignoreMode = asset.ignoreMode ?? (current.ignored?.has(asset.id) ? "session" : "none");
    return assetActions({ asset, ignoreMode, ignored: ignoreMode !== "none", problem: current.problemIds.has(asset.id),
      convertible: (current.convertibleIds ?? current.pendingIds).has(asset.id), blocked: current.busy || isExiting || Boolean(currentRename.current) || savingRename.current,
      available: { details: true, rename: Boolean(current.onRename), inspect: Boolean(current.onInspect), locate: Boolean(current.onLocate), convert: Boolean(current.onManualConvert),
        reveal: Boolean(current.onReveal), revealPdf: Boolean(current.onRevealPdf && current.results[asset.id]?.pdfPath), copyPath: Boolean(current.onCopyPath), restore: Boolean(current.onIgnore), ignoreSession: Boolean(current.onIgnore), ignorePermanent: Boolean(current.onIgnore) } });
  }
  function selectAction(id: string, action: AssetActionId) {
    const current = latestProps.current;
    const asset = (current.allImages ?? current.images).find((image) => image.id === id);
    if (!asset || !current.images.some((image) => image.id === id) || !actionsFor(asset).some((item) => item.id === action && !item.disabled)) return;
    if (action === "rename") beginRename(asset);
    else if (action === "details") current.onActivate(id);
    else if (action === "inspect") current.onInspect?.(id);
    else if (action === "locate") current.onLocate?.(id);
    else if (action === "convert") current.onManualConvert?.(id);
    else if (action === "reveal") current.onReveal?.(id);
    else if (action === "revealPdf") current.onRevealPdf?.(id);
    else if (action === "copyPath") current.onCopyPath?.(id);
    else current.onIgnore?.(id, action === "restore" ? "none" : action === "ignoreSession" ? "session" : "permanent");
  }
  function menuItems(asset: ImageAsset, isExiting: boolean, context: boolean) {
    const Group = context ? ContextMenuGroup : DropdownMenuGroup;
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Divider = context ? ContextMenuSeparator : DropdownMenuSeparator;
    const actions = actionsFor(asset, isExiting);
    return (["file", "ignore"] as const).map((group, index) => <Group key={group}>
      {index > 0 && actions.some((action) => action.group === group) && <Divider />}
      {actions.filter((action) => action.group === group).map((action) => <Item key={action.id} disabled={action.disabled} onSelect={() => selectAction(asset.id, action.id)}>{action.label}</Item>)}
    </Group>);
  }
  return (
    <section className="asset-panel @container flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label={t("assetList.projectImages")}>
      <header hidden={props.showSearchAndFilters === false} className="flex shrink-0 flex-col gap-3 px-4 py-3">
        <h2 className="sr-only">{t("assetList.projectImages")}</h2>
        <div className="flex min-w-0 items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupInput type="search" name="imageSearch" autoComplete="off" spellCheck={false} aria-label={t("assetList.searchImages")} placeholder={t("assetList.searchPathsOrFormats")} value={props.search} onChange={(event) => props.onSearch(event.target.value)} />
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          </InputGroup>
          {ignoredCount > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("assetList.moreFilters")}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onSelect={() => props.onFilter("ignored")}>{t("assetList.ignored")}{ignoredCount}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
        </div>
        <ToggleGroup type="single" className="asset-summary" value={props.filter} onValueChange={(value) => { if (value) props.onFilter(value); }} aria-label={t("assetList.imageStatusFilters")}>
          {summary.map((item) => <ToggleGroupItem key={item.value} value={item.value} aria-label={`${item.label} ${item.count}`}><span>{item.label}</span><span className="tabular-nums">{item.count}</span></ToggleGroupItem>)}
        </ToggleGroup>
      </header>
      {props.showSearchAndFilters !== false && <Separator />}
      <div ref={scrollArea} className="asset-scroll min-h-0 flex-1 overflow-auto">
        <Table className="table-fixed asset-filter-content min-w-[480px]" data-filter={props.filter}>
          <colgroup>{props.selectionMode && <col style={{width:48}} />}<col /><col style={{width:56}} /><col style={{width:80}} /><col style={{width:getLocale() === "en-US" ? 112 : 96}} /><col style={{width:36}} /></colgroup>
          <TableCaption className="sr-only">{t("assetList.projectImagesAndProcessingStatus")}</TableCaption>
          <TableHeader className="sr-only">
            <TableRow>
              {props.selectionMode && <TableHead className="asset-selection-cell w-12">
                <label className="asset-selection-target"><Checkbox aria-label={t("assetList.selectVisibleImages")} checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false} disabled={props.busy || readyIds.length === 0} onCheckedChange={() => props.onSelectAll(readyIds, !allChecked)} /></label>
              </TableHead>}
              <TableHead className="asset-name-heading">{t("assetList.name")}</TableHead>
              <TableHead className="w-14 text-center">{t("assetList.format")}</TableHead>
              <TableHead className="w-20 text-center">{t("assetList.size")}</TableHead>
              <TableHead className={getLocale() === "en-US" ? "w-28 text-center" : "w-24 text-center"}>{t("assetList.status")}</TableHead>
              <TableHead className="w-9 text-center"><span className="sr-only">{t("assetList.imageActions")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayImages.map((asset) => {
              const isExiting = exiting.some((image) => image.asset.id === asset.id);
              const result = props.results[asset.id];
              const converted = props.completedIds.has(asset.id);
              const updatable = Boolean(asset.updateAvailable && props.pendingIds.has(asset.id));
              const referenceProblem = ["missing", "unsupported", "ambiguous"].includes(asset.status);
              const problem = props.problemIds.has(asset.id);
              const ignoreMode = asset.ignoreMode ?? (props.ignored?.has(asset.id) ? "session" : "none");
              const ignored = ignoreMode !== "none";
              const missingPdf = asset.message === getLoadedCatalog("zh-CN")?.native.managedPdfMissing;
              const pendingRename = props.pendingRename?.id === asset.id;
              const rowSelected = props.selectionMode ? props.selected.has(asset.id) : props.activeId === asset.id;
              const label = pendingRename ? t("assetList.pendingRename") : ignored ? t("assetList.ignored") : problem ? referenceProblem ? statusLabels[asset.status] : t("assetList.needsAttention") : result?.cancelled ? t("assetList.cancelled") : missingPdf ? t("assetList.missingPDF") : converted || asset.status === "pdf" ? "" : updatable ? t("assetList.updatedSource") : statusLabels[asset.status];
              const normalizedPath = asset.relativePath.replaceAll("\\", "/");
              const slash = normalizedPath.lastIndexOf("/");
              const filename = normalizedPath.slice(slash + 1);
              const dot = filename.lastIndexOf(".");
              const baseName = props.pendingRename?.id === asset.id ? props.pendingRename.name : dot > 0 ? filename.slice(0, dot) : filename;
              return (
                <ContextMenu key={rowKeys.current.get(asset.id) ?? asset.id}><ContextMenuTrigger asChild disabled={props.busy || isExiting || Boolean(rename)}><TableRow tabIndex={isExiting ? -1 : 0} aria-selected={rowSelected} onKeyDown={(event) => {
                  if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && !props.busy && !isExiting && !rename) {
                    event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 20, clientY: rect.top + rect.height / 2 }));
                  }
                }} data-state={rowSelected ? "selected" : undefined} data-exiting={isExiting || undefined} aria-hidden={isExiting || undefined} data-disabled={Boolean(props.previewDisabled) || isExiting} data-highlight={renamedId === asset.id ? "success" : highlights[asset.id]} className="asset-row h-[72px]">
                  {props.selectionMode && <TableCell className="asset-selection-cell">
                    <label className="asset-selection-target"><Checkbox aria-label={t("assetList.selectValue", { arg0: asset.relativePath })} checked={props.selected.has(asset.id)} disabled={props.busy || isExiting || !convertible.has(asset.id)} onCheckedChange={() => props.onSelect(asset.id)} /></label>
                  </TableCell>}
                  <TableCell className="min-w-0 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-2.5"><AssetThumbnail source={thumbnail(asset.id)} problem={problem} /><div className="flex min-w-0 flex-1 flex-col gap-1">
                      {rename?.id === asset.id ? <div className="asset-rename" onClick={(event) => event.stopPropagation()}>
                        <div className="asset-rename-field"><Input ref={renameRef} aria-label={t("assetList.newImageName")} value={rename.name} readOnly={rename.saving} aria-invalid={Boolean(rename.error)} aria-describedby={rename.error ? `rename-error-${asset.id}` : undefined} onChange={(event) => setRename({ ...rename, name: event.target.value, error: null })} onBlur={(event) => {
                          if (savingRename.current) return;
                          if (event.relatedTarget instanceof HTMLElement && event.currentTarget.closest(".asset-rename")?.contains(event.relatedTarget)) return;
                          const target = event.relatedTarget;
                          if (renameHandoff.current && (!target || target instanceof HTMLElement && target.closest('.asset-preview-trigger, .asset-more, [role="menu"]'))) return;
                          renameHandoff.current = false; setRename(null);
                        }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void submitRename(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!savingRename.current) setRename(null); } }} /><Button className="asset-rename-confirm" variant="ghost" size="icon-xs" aria-label={t("assetList.confirmRename")} disabled={rename.saving} onPointerDown={(event) => event.preventDefault()} onClick={() => { void submitRename(); }}><Check aria-hidden="true" /></Button></div>
                        {rename.error && <p role="alert" id={`rename-error-${asset.id}`} className="absolute left-2 top-full z-10 max-w-80 rounded-xs border border-destructive/30 bg-background px-2 py-1 text-xs text-destructive shadow-sm">{rename.error}</p>}
                      </div> : <Button variant="ghost" className="asset-preview-trigger h-auto min-w-0 justify-start px-0 py-0 hover:bg-transparent!" disabled={props.previewDisabled || isExiting} aria-label={t("assetList.previewValue", { arg0: asset.relativePath })} aria-pressed={props.activeId === asset.id} onClick={() => props.onActivate(asset.id)} title={asset.relativePath}>
                        <span className="truncate asset-filename" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); beginRename(asset); }}>{baseName}</span>
                      </Button>}
                    </div></div>
                  </TableCell>
                  <TableCell className="text-center"><span className="text-xs text-muted-foreground">{asset.format.toUpperCase()}</span></TableCell>
                  <TableCell className="text-center"><span className="text-xs tabular-nums text-muted-foreground">{formatBytes(asset.bytes)}</span></TableCell>
                  <TableCell className="text-center">
                    {label && <Badge key={label} className={updatable && !problem ? "status-badge update-badge" : "status-badge"} variant={ignored ? "secondary" : missingPdf ? "warning" : problem ? referenceProblem ? "warning" : "destructive" : converted ? "success" : "secondary"} title={nativeText(asset.message ?? result?.error ?? "") || (ignored ? ignoreMode === "permanent" ? t("assetList.alwaysIgnore") : t("assetList.ignoreForThisSession") : updatable ? t("assetList.theSourceImageOrSVGDependencyChangedAndCanBe") : result?.pdfPath ?? undefined)}>
                      {label}
                    </Badge>}
                  </TableCell>
                  <TableCell className="pr-2 text-right">
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="asset-more size-6! min-h-6! min-w-6!" aria-label={t("assetList.moreActionsForValue", { arg0: asset.relativePath })} disabled={props.busy || isExiting || Boolean(rename)}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (renameHandoff.current || renameRef.current) event.preventDefault(); }}>{menuItems(asset, isExiting, false)}</DropdownMenuContent></DropdownMenu>
                  </TableCell>
                </TableRow></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={(event) => { if (renameHandoff.current || renameRef.current) event.preventDefault(); }}>{menuItems(asset, isExiting, true)}</ContextMenuContent></ContextMenu>
              );
            })}
          </TableBody>
        </Table>
        {props.images.length === 0 && <Empty><EmptyHeader><EmptyTitle>{props.total ? t("assetList.noMatchingImages") : t("assetList.thisProjectHasNoImagesYet")}</EmptyTitle></EmptyHeader></Empty>}
      </div>
      {(showResultCount || pageCount > 1) && <><Separator />
      <footer className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span>{showResultCount ? props.search.trim() || props.filter !== "all" ? t("assetList.valueResults", { arg0: props.images.length }) : t("assetList.valueImages", { arg0: props.total }) : ""}</span>
        {pageCount > 1 && <div className="flex items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label={t("assetList.previousImagePage")} disabled={page === 0} onClick={() => setPagination({ key: pageKey, page: page - 1 })}><ChevronLeft aria-hidden="true" /></Button><span className="tabular-nums">{page + 1} / {pageCount}</span><Button variant="ghost" size="icon-sm" aria-label={t("assetList.nextImagePage")} disabled={page + 1 >= pageCount} onClick={() => setPagination({ key: pageKey, page: page + 1 })}><ChevronRight aria-hidden="true" /></Button></div>}
      </footer></>}
    </section>
  );
}
