import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, FileImage, FileWarning, RefreshCw, Search, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { AssetStatus, ImageAsset, ImageResult } from "./types";
import { formatBytes } from "./utils";

export const statusLabels: Record<AssetStatus, string> = {
  ready: "待转换",
  missing: "文件缺失",
  unsupported: "不支持",
  ambiguous: "路径不明确",
  pdf: "PDF",
};

interface Props {
  images: ImageAsset[];
  selectionMode: boolean;
  pendingIds: Set<string>;
  problemIds: Set<string>;
  completedIds: Set<string>;
  allImages?: ImageAsset[];
  ignored?: Set<string>;
  onIgnore?: (id: string, ignored: boolean) => void;
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
  const pageSize = 40;
  const pageKey = `${props.search}\0${props.filter}`;
  const [pagination, setPagination] = useState({ key: pageKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(props.images.length / pageSize));
  const page = pagination.key === pageKey ? Math.min(pagination.page, pageCount - 1) : 0;
  const pageImages = props.images.slice(page * pageSize, (page + 1) * pageSize);
  const readyIds = props.images.filter((image) => props.pendingIds.has(image.id)).map((image) => image.id);
  const checkedCount = readyIds.filter((id) => props.selected.has(id)).length;
  const allChecked = readyIds.length > 0 && checkedCount === readyIds.length;
  const sourceImages = props.allImages ?? props.images;
  const ignoredCount = sourceImages.filter((image) => props.ignored?.has(image.id)).length;
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
    const duration = getComputedStyle(document.documentElement).getPropertyValue("--motion-fast").trim() || "120ms";
    const animation = node.animate([{ opacity: .7 }, { opacity: 1 }], { duration: Number.parseFloat(duration), easing: "ease-out" });
    return () => animation.cancel();
  }, [props.filter]);
  return (
    <section className="asset-panel @container flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label="项目图片">
      <header className="flex shrink-0 flex-col gap-3 px-4 py-3">
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
      <Separator />
      <div ref={scrollArea} className="asset-scroll min-h-0 flex-1 overflow-auto">
        <Table className="table-fixed asset-filter-content" data-filter={props.filter}>
          <TableCaption className="sr-only">项目图片及转换状态</TableCaption>
          <TableHeader>
            <TableRow>
              {props.selectionMode && <TableHead className="asset-selection-cell w-12">
                <label className="asset-selection-target"><Checkbox aria-label="选择当前列表" checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false} disabled={props.busy || readyIds.length === 0} onCheckedChange={() => props.onSelectAll(readyIds, !allChecked)} /></label>
              </TableHead>}
              <TableHead>图片</TableHead>
              <TableHead className="w-20 text-right">大小</TableHead>
              <TableHead className="w-28 pr-4 text-right">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageImages.map((asset) => {
              const result = props.results[asset.id];
              const converted = props.completedIds.has(asset.id);
              const updatable = Boolean(asset.updateAvailable && props.pendingIds.has(asset.id));
              const warning = ["missing", "unsupported", "ambiguous"].includes(asset.status);
              const ignored = props.ignored?.has(asset.id);
              const label = ignored ? "已忽略" : result?.cancelled ? "已取消" : result?.error ? "转换失败" : converted ? "已完成" : updatable ? "有更新" : statusLabels[asset.status];
              const normalizedPath = asset.relativePath.replaceAll("\\", "/");
              const slash = normalizedPath.lastIndexOf("/");
              const filename = normalizedPath.slice(slash + 1);
              const folder = slash < 0 ? "." : normalizedPath.slice(0, slash);
              return (
                <TableRow key={asset.id} data-state={props.activeId === asset.id ? "selected" : undefined} data-disabled={Boolean(props.previewDisabled)} data-highlight={highlights[asset.id]} className="asset-row h-[60px]">
                  {props.selectionMode && <TableCell className="asset-selection-cell">
                    <label className="asset-selection-target"><Checkbox aria-label={`选择 ${asset.relativePath}`} checked={props.selected.has(asset.id)} disabled={props.busy || ignored || !props.pendingIds.has(asset.id)} onCheckedChange={() => props.onSelect(asset.id)} /></label>
                  </TableCell>}
                  <TableCell className="min-w-0 whitespace-normal">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Button variant="ghost" className="asset-preview-trigger h-auto min-w-0 justify-start px-0 py-0" disabled={props.previewDisabled} aria-label={`预览 ${asset.relativePath}`} aria-pressed={props.activeId === asset.id} onClick={() => props.onActivate(asset.id)} title={asset.relativePath}>
                        {warning ? <FileWarning data-icon="inline-start" aria-hidden="true" /> : <FileImage data-icon="inline-start" aria-hidden="true" />}
                        <span className="truncate">{filename}</span>
                      </Button>
                      <p className="truncate text-xs text-muted-foreground" title={asset.relativePath}>{folder} · {asset.format.toUpperCase()}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""}</p>
                      {result?.error && !result.cancelled && <p className="break-words text-xs text-destructive">{result.error}</p>}
                      {asset.message && <p className="break-words text-xs text-muted-foreground">{asset.message}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right"><span className="text-xs tabular-nums text-muted-foreground">{formatBytes(asset.bytes)}</span></TableCell>
                  <TableCell className="pr-4 text-right">
                    <Badge key={label} className={updatable && !result?.error ? "status-badge update-badge" : "status-badge"} variant={result?.error && !result.cancelled ? "destructive" : converted ? "success" : warning ? "warning" : "secondary"} title={updatable ? "源图片或 SVG 依赖已变化，可重新转换" : result?.pdfPath ?? undefined}>
                      {converted && <CircleCheck data-icon="inline-start" aria-hidden="true" />}{updatable && !result?.error && <RefreshCw data-icon="inline-start" aria-hidden="true" />}{label}
                    </Badge>
                    {(warning || result?.error || ignored) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="asset-more" aria-label={`更多操作 ${asset.relativePath}`} disabled={props.busy}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => props.onInspect?.(asset.id)}>{asset.status === "unsupported" || result?.error ? "查看详情" : "查看并修复"}</DropdownMenuItem>
                      {["missing", "ambiguous"].includes(asset.status) && <DropdownMenuItem onSelect={() => props.onLocate?.(asset.id)}>定位文件</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => props.onIgnore?.(asset.id, !ignored)}>{ignored ? "恢复处理" : "忽略本次"}</DropdownMenuItem>
                    </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {props.images.length === 0 && <Empty><EmptyHeader><EmptyTitle>{props.total ? "没有匹配的图片" : "项目中还没有图片"}</EmptyTitle></EmptyHeader></Empty>}
      </div>
      <Separator />
      <footer className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span>{props.images.length} 张可见 · {ignoredCount} 张已忽略 · 共 {props.total} 张</span>
        <div className="flex items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label="上一页图片" disabled={page === 0} onClick={() => setPagination({ key: pageKey, page: page - 1 })}><ChevronLeft aria-hidden="true" /></Button><span className="tabular-nums">{page + 1} / {pageCount}</span><Button variant="ghost" size="icon-sm" aria-label="下一页图片" disabled={page + 1 >= pageCount} onClick={() => setPagination({ key: pageKey, page: page + 1 })}><ChevronRight aria-hidden="true" /></Button></div>
      </footer>
    </section>
  );
}
