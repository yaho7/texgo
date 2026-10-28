import { useEffect, useRef, useState } from "react";
import AssetThumbnail from "./AssetThumbnail";
import { useAssetThumbnails } from "./hooks/useAssetThumbnails";
import type { ThumbnailContext } from "./hooks/useAssetThumbnails";
import { ChevronLeft, ChevronRight, CircleCheck, RefreshCw, Search, MoreHorizontal } from "lucide-react";
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
  ready: "待处理",
  missing: "文件缺失",
  unsupported: "不支持",
  ambiguous: "路径不明确",
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
  renameRequest?: { id: string; token: number };
  convertibleIds?: Set<string>;
  onManualConvert?: (id: string) => void;
  onReveal?: (id: string) => void;
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
      setRename({ ...rename, error: "请输入有效的文件名，不包含路径、扩展名或系统保留字符" }); return;
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
    catch (reason) { renameIdentity.current = null; setRename({ ...rename, saving: false, error: errorMessage(reason, "无法安全重命名，请重新扫描后重试") }); requestAnimationFrame(() => renameRef.current?.focus()); }
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
    { value: "pending", label: "待处理", count: props.pendingIds.size },
    { value: "problems", label: "问题", count: props.problemIds.size },
    { value: "completed", label: "已完成", count: props.completedIds.size },
    { value: "all", label: "全部", count: sourceImages.length },
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
    const animation = node.animate([{ opacity: .7 }, { opacity: 1 }], { duration: motionDuration("fast"), easing: "ease-out" });
    return () => animation.cancel();
  }, [props.filter]);
  function actionsFor(asset: ImageAsset, isExiting = false) {
    const current = latestProps.current;
    const ignoreMode = asset.ignoreMode ?? (current.ignored?.has(asset.id) ? "session" : "none");
    return assetActions({ asset, ignoreMode, ignored: ignoreMode !== "none", problem: current.problemIds.has(asset.id),
      convertible: (current.convertibleIds ?? current.pendingIds).has(asset.id), blocked: current.busy || isExiting || Boolean(currentRename.current) || savingRename.current,
      available: { details: true, rename: Boolean(current.onRename), inspect: Boolean(current.onInspect), locate: Boolean(current.onLocate), convert: Boolean(current.onManualConvert),
        reveal: Boolean(current.onReveal), copyPath: Boolean(current.onCopyPath), restore: Boolean(current.onIgnore), ignoreSession: Boolean(current.onIgnore), ignorePermanent: Boolean(current.onIgnore) } });
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
    <section className="asset-panel @container flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label="项目图片">
      <header hidden={props.showSearchAndFilters === false} className="flex shrink-0 flex-col gap-3 px-4 py-3">
        <h2 className="sr-only">项目图片</h2>
        <div className="flex min-w-0 items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupInput type="search" name="imageSearch" autoComplete="off" spellCheck={false} aria-label="搜索图片" placeholder="搜索路径或格式…" value={props.search} onChange={(event) => props.onSearch(event.target.value)} />
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          </InputGroup>
          {ignoredCount > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="更多筛选"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onSelect={() => props.onFilter("ignored")}>已忽略 {ignoredCount}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
        </div>
        <ToggleGroup type="single" className="asset-summary" value={props.filter} onValueChange={(value) => { if (value) props.onFilter(value); }} aria-label="图片状态摘要">
          {summary.map((item) => <ToggleGroupItem key={item.value} value={item.value} aria-label={`${item.label} ${item.count}`}><span>{item.label}</span><span className="tabular-nums">{item.count}</span></ToggleGroupItem>)}
        </ToggleGroup>
      </header>
      {props.showSearchAndFilters !== false && <Separator />}
      <div ref={scrollArea} className="asset-scroll min-h-0 flex-1 overflow-auto">
        <Table className="table-fixed asset-filter-content min-w-[560px]" data-filter={props.filter}>
          <TableCaption className="sr-only">项目图片及处理状态</TableCaption>
          <TableHeader>
            <TableRow>
              {props.selectionMode && <TableHead className="asset-selection-cell w-12">
                <label className="asset-selection-target"><Checkbox aria-label="选择当前列表" checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false} disabled={props.busy || readyIds.length === 0} onCheckedChange={() => props.onSelectAll(readyIds, !allChecked)} /></label>
              </TableHead>}
              <TableHead>名称</TableHead>
              <TableHead className="w-14 text-center">格式</TableHead>
              <TableHead className="w-20 text-center">大小</TableHead>
              <TableHead className="w-24 text-center">状态</TableHead>
              <TableHead className="w-9 text-center"><span className="sr-only">图片操作</span></TableHead>
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
              const label = ignored ? "已忽略" : problem ? referenceProblem ? statusLabels[asset.status] : "需要处理" : result?.cancelled ? "已取消" : converted ? "已完成" : updatable ? "有更新" : statusLabels[asset.status];
              const normalizedPath = asset.relativePath.replaceAll("\\", "/");
              const slash = normalizedPath.lastIndexOf("/");
              const filename = normalizedPath.slice(slash + 1);
              const dot = filename.lastIndexOf(".");
              const baseName = dot > 0 ? filename.slice(0, dot) : filename;
              return (
                <ContextMenu key={rowKeys.current.get(asset.id) ?? asset.id}><ContextMenuTrigger asChild disabled={props.busy || isExiting || Boolean(rename)}><TableRow tabIndex={isExiting ? -1 : 0} aria-selected={props.activeId === asset.id} onKeyDown={(event) => {
                  if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && !props.busy && !isExiting && !rename) {
                    event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 20, clientY: rect.top + rect.height / 2 }));
                  }
                }} data-state={props.activeId === asset.id ? "selected" : undefined} data-exiting={isExiting || undefined} aria-hidden={isExiting || undefined} data-disabled={Boolean(props.previewDisabled) || isExiting} data-highlight={renamedId === asset.id ? "success" : highlights[asset.id]} className="asset-row h-[72px]">
                  {props.selectionMode && <TableCell className="asset-selection-cell">
                    <label className="asset-selection-target"><Checkbox aria-label={`选择 ${asset.relativePath}`} checked={props.selected.has(asset.id)} disabled={props.busy || isExiting || !convertible.has(asset.id)} onCheckedChange={() => props.onSelect(asset.id)} /></label>
                  </TableCell>}
                  <TableCell className="min-w-0 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-2.5"><AssetThumbnail source={thumbnail(asset.id)} problem={problem} /><div className="flex min-w-0 flex-1 flex-col gap-1">
                      {rename?.id === asset.id ? <div className="asset-rename" onClick={(event) => event.stopPropagation()}>
                        <div className="asset-rename-field"><Input ref={renameRef} aria-label="图片新名称" value={rename.name} readOnly={rename.saving} aria-invalid={Boolean(rename.error)} aria-describedby={rename.error ? `rename-error-${asset.id}` : undefined} onChange={(event) => setRename({ ...rename, name: event.target.value, error: null })} onBlur={(event) => {
                          if (savingRename.current) return;
                          const target = event.relatedTarget;
                          if (renameHandoff.current && (!target || target instanceof HTMLElement && target.closest('.asset-preview-trigger, .asset-more, [role="menu"]'))) return;
                          renameHandoff.current = false; setRename(null);
                        }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); void submitRename(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!savingRename.current) setRename(null); } }} /></div>
                        {rename.error && <p role="alert" id={`rename-error-${asset.id}`} className="absolute left-2 top-full z-10 max-w-80 rounded border border-destructive/30 bg-background px-2 py-1 text-xs text-destructive shadow-sm">{rename.error}</p>}
                      </div> : <Button variant="ghost" className="asset-preview-trigger h-auto min-w-0 justify-start px-0 py-0 hover:bg-transparent!" disabled={props.previewDisabled || isExiting} aria-label={`预览 ${asset.relativePath}`} aria-pressed={props.activeId === asset.id} onClick={() => props.onActivate(asset.id)} title={asset.relativePath}>
                        <span className="truncate asset-filename" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); beginRename(asset); }}>{baseName}</span>
                      </Button>}
                    </div></div>
                  </TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{asset.format.toUpperCase()}</span></TableCell>
                  <TableCell className="text-right"><span className="text-xs tabular-nums text-muted-foreground">{formatBytes(asset.bytes)}</span></TableCell>
                  <TableCell className="text-center">
                    <Badge key={label} className={updatable && !problem ? "status-badge update-badge" : "status-badge"} variant={ignored ? "secondary" : problem ? referenceProblem ? "warning" : "destructive" : converted ? "success" : "secondary"} title={asset.message ?? result?.error ?? (ignored ? ignoreMode === "permanent" ? "始终忽略" : "仅本次忽略" : updatable ? "源图片或 SVG 依赖已变化，可重新处理" : result?.pdfPath ?? undefined)}>
                      {converted && !problem && !ignored && <CircleCheck data-icon="inline-start" aria-hidden="true" />}{updatable && !problem && !ignored && <RefreshCw data-icon="inline-start" aria-hidden="true" />}{label}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-2 text-right">
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="asset-more size-6! min-h-6! min-w-6!" aria-label={`更多操作 ${asset.relativePath}`} disabled={props.busy || isExiting || Boolean(rename)}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (renameHandoff.current || renameRef.current) event.preventDefault(); }}>{menuItems(asset, isExiting, false)}</DropdownMenuContent></DropdownMenu>
                  </TableCell>
                </TableRow></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={(event) => { if (renameHandoff.current || renameRef.current) event.preventDefault(); }}>{menuItems(asset, isExiting, true)}</ContextMenuContent></ContextMenu>
              );
            })}
          </TableBody>
        </Table>
        {props.images.length === 0 && <Empty><EmptyHeader><EmptyTitle>{props.total ? "没有匹配的图片" : "项目中还没有图片"}</EmptyTitle></EmptyHeader></Empty>}
      </div>
      {(showResultCount || pageCount > 1) && <><Separator />
      <footer className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span>{showResultCount ? props.search.trim() || props.filter !== "all" ? `${props.images.length} 项结果` : `${props.total} 张图片` : ""}</span>
        {pageCount > 1 && <div className="flex items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label="上一页图片" disabled={page === 0} onClick={() => setPagination({ key: pageKey, page: page - 1 })}><ChevronLeft aria-hidden="true" /></Button><span className="tabular-nums">{page + 1} / {pageCount}</span><Button variant="ghost" size="icon-sm" aria-label="下一页图片" disabled={page + 1 >= pageCount} onClick={() => setPagination({ key: pageKey, page: page + 1 })}><ChevronRight aria-hidden="true" /></Button></div>}
      </footer></>}
    </section>
  );
}
