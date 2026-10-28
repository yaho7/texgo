import type { ImageAsset, IgnoreMode } from "./types";

export type AssetActionId = "rename" | "details" | "inspect" | "locate" | "convert" | "reveal" | "copyPath" | "restore" | "ignoreSession" | "ignorePermanent";
export interface AssetAction { id: AssetActionId; label: string; disabled: boolean; group: "file" | "ignore" }
export interface AssetActionContext {
  asset: ImageAsset; ignored: boolean; ignoreMode: IgnoreMode; problem: boolean;
  convertible: boolean; blocked: boolean;
  available: Partial<Record<AssetActionId, boolean>>;
}
export function revealLabel(platform: string = navigator.platform): string {
  return /mac/i.test(platform) ? "在 Finder 中显示" : /win/i.test(platform) ? "在文件资源管理器中显示" : "在文件管理器中显示";
}
// Both entry points use this projection, including the final selection guard.
export function assetActions(context: AssetActionContext): AssetAction[] {
  const { asset, available, blocked, ignored, ignoreMode, problem, convertible } = context;
  const actions: AssetAction[] = [];
  function add(id: AssetActionId, label: string, visible = true, disabled = false, group: AssetAction["group"] = "file") {
    if (visible && available[id]) actions.push({ id, label, disabled: blocked || disabled, group });
  }
  add("rename", "重命名", Boolean(asset.canRename));
  add("details", "查看详细信息", !problem);
  add("inspect", ["missing", "ambiguous"].includes(asset.status) ? "查看并修复" : "查看详情", problem);
  add("locate", "定位文件", ["missing", "ambiguous"].includes(asset.status));
  add("convert", ignored ? "手动处理一次" : "重新处理此图片", convertible);
  const unresolved = !asset.path || ["missing", "ambiguous"].includes(asset.status);
  add("reveal", revealLabel(), true, unresolved);
  add("copyPath", "复制路径", true, unresolved);
  add(ignored ? "restore" : "ignoreSession", ignored ? "恢复处理" : "忽略本次", true, false, "ignore");
  add("ignorePermanent", "始终忽略", ignoreMode !== "permanent", false, "ignore");
  return actions;
}
