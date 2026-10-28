import native from "./locales/zh-CN/native.json";
import common from "./locales/zh-CN/common.json";
import app from "./locales/zh-CN/app.json";
import applicationUpdate from "./locales/zh-CN/applicationUpdate.json";
import assetActions from "./locales/zh-CN/assetActions.json";
import assetFileActions from "./locales/zh-CN/assetFileActions.json";
import assetList from "./locales/zh-CN/assetList.json";
import assetPreview from "./locales/zh-CN/assetPreview.json";
import assetProblems from "./locales/zh-CN/assetProblems.json";
import assetThumbnail from "./locales/zh-CN/assetThumbnail.json";
import backgroundAutomation from "./locales/zh-CN/backgroundAutomation.json";
import commandBar from "./locales/zh-CN/commandBar.json";
import conversion from "./locales/zh-CN/conversion.json";
import conversionHistory from "./locales/zh-CN/conversionHistory.json";
import dialog from "./locales/zh-CN/dialog.json";
import errorNotice from "./locales/zh-CN/errorNotice.json";
import history from "./locales/zh-CN/history.json";
import historyPresentation from "./locales/zh-CN/historyPresentation.json";
import home from "./locales/zh-CN/home.json";
import pdfPreview from "./locales/zh-CN/pdfPreview.json";
import presets from "./locales/zh-CN/presets.json";
import recentPresentation from "./locales/zh-CN/recentPresentation.json";
import recentProjectDetails from "./locales/zh-CN/recentProjectDetails.json";
import reviewDialog from "./locales/zh-CN/reviewDialog.json";
import reviewFlow from "./locales/zh-CN/reviewFlow.json";
import secondaryViews from "./locales/zh-CN/secondaryViews.json";
import settings from "./locales/zh-CN/settings.json";
import shortcuts from "./locales/zh-CN/shortcuts.json";
import utils from "./locales/zh-CN/utils.json";
import validation from "./locales/zh-CN/validation.json";
import workbenchMenu from "./locales/zh-CN/workbenchMenu.json";
import workspace from "./locales/zh-CN/workspace.json";
import workspaceSearch from "./locales/zh-CN/workspaceSearch.json";
import workspaceSidebar from "./locales/zh-CN/workspaceSidebar.json";
import { useSyncExternalStore } from "react";
export type Locale = "zh-CN" | "en-US";
const chinese = { native, common, app, applicationUpdate, assetActions, assetFileActions, assetList, assetPreview, assetProblems, assetThumbnail, backgroundAutomation, commandBar, conversion, conversionHistory, dialog, errorNotice, history, historyPresentation, home, pdfPreview, presets, recentPresentation, recentProjectDetails, reviewDialog, reviewFlow, secondaryViews, settings, shortcuts, utils, validation, workbenchMenu, workspace, workspaceSearch, workspaceSidebar };
export type Catalog = { [Domain in keyof typeof chinese]: { [Key in keyof typeof chinese[Domain]]: string } };
export type MessageKey = { [Domain in keyof Catalog]: `${Domain}.${Extract<keyof Catalog[Domain], string>}` }[keyof Catalog];
type Variables = Record<string, string | number | null | undefined>;
let englishFormatter: ((message: string, values: Record<string, string | number>) => string) | undefined;
let activeLocale: Locale = "zh-CN";
let catalog: Catalog = chinese;
let english: Promise<Catalog> | undefined;
let loadedEnglish: Catalog | undefined;
export function getLoadedCatalog(locale: Locale): Catalog | undefined { return locale === "zh-CN" ? chinese : loadedEnglish; }
let generation = 0;
const listeners = new Set<() => void>();
export function getLocale(): Locale { return activeLocale; }
export function useLocale(): Locale {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, getLocale, getLocale);
}
export async function loadLocale(locale: Locale): Promise<Catalog> {
  if (locale === "zh-CN") return chinese;
  english ??= import("./locales/en-US").then(module => { englishFormatter = module.formatMessage; loadedEnglish = module.default; return module.default; });
  try { return await english; } catch (error) { english = undefined; throw error; }
}
export async function setLocale(locale: Locale): Promise<void> {
  const request = ++generation;
  const next = await loadLocale(locale);
  if (request !== generation) return;
  activeLocale = locale; catalog = next;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const notify of listeners) notify();
}
export function t(key: MessageKey, variables: Variables = {}): string {
  const [domain, name] = key.split(".");
  const values: Record<string, Record<string, string>> = catalog;
  const message = values[domain][name];
  const normalized = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, value ?? ""]));
  if (activeLocale === "en-US" && englishFormatter) return englishFormatter(message, normalized);
  return message.replace(/\{(\w+)\}/g, (match, parameter: string) => Object.hasOwn(variables, parameter) ? String(variables[parameter]) : match);
}
