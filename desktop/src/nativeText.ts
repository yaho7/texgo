import { getLoadedCatalog, t } from "./i18n";
import type { Catalog, MessageKey } from "./i18n";
import parameters from "./locales/native-parameters.json";
type Rule = { key: MessageKey; pattern: RegExp; names: string[]; recursive: string[]; weight: number };
let cachedEnglish: Catalog | undefined;
let rules: Rule[] | undefined;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function messageRules(): Rule[] {
  const english = getLoadedCatalog("en-US");
  if (rules && cachedEnglish === english) return rules;
  cachedEnglish = english; rules = [];
  for (const catalog of [getLoadedCatalog("zh-CN"), english]) {
    if (!catalog) continue;
    for (const [domain, messages] of Object.entries(catalog)) for (const [name, text] of Object.entries(messages)) {
      // ICU plurals are formatted from keys, never inferred from arbitrary document text.
      if (/\{\w+,\s*(?:plural|select)/.test(text)) continue;
      const names: string[] = []; let at = 0, expression = "^", weight = 0;
      for (const match of text.matchAll(/\{(\w+)\}/g)) {
        const literal = text.slice(at, match.index); expression += escaped(literal) + "(.*?)"; weight += literal.length;
        names.push(match[1]); at = match.index + match[0].length;
      }
      expression += escaped(text.slice(at)) + "$"; weight += text.length - at;
      const metadata: Record<string, string[]> = parameters;
      rules.push({ key: `${domain}.${name}` as MessageKey, pattern: new RegExp(expression, "s"), names, recursive: domain === "native" ? metadata[name] ?? [] : [], weight });
    }
  }
  return rules.sort((a,b) => b.weight - a.weight);
}
/** Presentation only. Never use translated text as file identity or a write precondition. */
export function nativeText(message: string, depth = 0): string {
  if (!message || depth > 4) return message;
  for (const rule of messageRules()) {
    const match = rule.pattern.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(rule.names.map((name,index) => [name, rule.recursive.includes(name) ? nativeText(match[index + 1], depth + 1) : match[index + 1]]));
    return t(rule.key, values);
  }
  return message;
}
export function isKnownMessage(message: string): boolean { return messageRules().some(rule => rule.pattern.test(message)); }
