import { useSyncExternalStore } from "react";
import common from "./locales/zh-CN/common.json";
import home from "./locales/zh-CN/home.json";
import settings from "./locales/zh-CN/settings.json";
import shortcuts from "./locales/zh-CN/shortcuts.json";
import presets from "./locales/zh-CN/presets.json";
export type Locale = "zh-CN" | "en-US";
const chinese = { common, home, settings, shortcuts, presets };
export type Catalog = { [Domain in keyof typeof chinese]: { [Key in keyof typeof chinese[Domain]]: string } };
export type MessageKey = { [Domain in keyof Catalog]: `${Domain}.${Extract<keyof Catalog[Domain], string>}` }[keyof Catalog];
type Variables = Record<string, string | number>;
let activeLocale: Locale = "zh-CN";
let catalog: Catalog = chinese;
let english: Promise<Catalog> | undefined;
let generation = 0;
const listeners = new Set<() => void>();
export function getLocale(): Locale { return activeLocale; }
export function useLocale(): Locale {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, getLocale, getLocale);
}
export async function loadLocale(locale: Locale): Promise<Catalog> {
  if (locale === "zh-CN") return chinese;
  english ??= import("./locales/en-US").then(module => module.default);
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
  return values[domain][name].replace(/\{(\w+)\}/g, (match, parameter: string) => Object.hasOwn(variables, parameter) ? String(variables[parameter]) : match);
}
