import { t } from "./i18n";
import type { ImageAsset, IgnoreMode } from "./types";

export type AssetActionId = "rename" | "details" | "inspect" | "locate" | "convert" | "reveal" | "copyPath" | "restore" | "ignoreSession" | "ignorePermanent";
export interface AssetAction { id: AssetActionId; label: string; disabled: boolean; group: "file" | "ignore" }
export interface AssetActionContext {
  asset: ImageAsset; ignored: boolean; ignoreMode: IgnoreMode; problem: boolean;
  convertible: boolean; blocked: boolean;
  available: Partial<Record<AssetActionId, boolean>>;
}
export function revealLabel(platform: string = navigator.platform): string {
  return /mac/i.test(platform) ? t("assetActions.revealInFinder") : /win/i.test(platform) ? t("assetActions.showInFileExplorer") : t("assetActions.showInFileManager");
}
// Both entry points use this projection, including the final selection guard.
export function assetActions(context: AssetActionContext): AssetAction[] {
  const { asset, available, blocked, ignored, ignoreMode, problem, convertible } = context;
  const actions: AssetAction[] = [];
  function add(id: AssetActionId, label: string, visible = true, disabled = false, group: AssetAction["group"] = "file") {
    if (visible && available[id]) actions.push({ id, label, disabled: blocked || disabled, group });
  }
  add("rename", t("assetActions.rename"), Boolean(asset.canRename));
  add("details", t("assetActions.viewDetails"), !problem);
  add("inspect", ["missing", "ambiguous"].includes(asset.status) ? t("assetActions.reviewAndRepair") : t("assetActions.viewDetails2"), problem);
  add("locate", t("assetActions.locateFile"), ["missing", "ambiguous"].includes(asset.status));
  add("convert", ignored ? t("assetActions.processOnce") : t("assetActions.reprocessThisImage"), convertible);
  const unresolved = !asset.path || ["missing", "ambiguous"].includes(asset.status);
  add("reveal", revealLabel(), true, unresolved);
  add("copyPath", t("assetActions.copyPath"), true, unresolved);
  add(ignored ? "restore" : "ignoreSession", ignored ? t("assetActions.resumeProcessing") : t("assetActions.ignoreThisSession"), true, false, "ignore");
  add("ignorePermanent", t("assetActions.alwaysIgnore"), ignoreMode !== "permanent", false, "ignore");
  return actions;
}
