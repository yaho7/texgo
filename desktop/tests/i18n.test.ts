import { expect, it } from "vitest";
import { getLocale, loadLocale, setLocale, t } from "../src/i18n";
import { conversionPresets } from "../src/preferences";
it("keeps independent catalogs and interpolation parameters in parity", async () => {
  const chinese = await loadLocale("zh-CN"), english = await loadLocale("en-US");
  for (const domain of Object.keys(chinese) as (keyof typeof chinese)[]) {
    expect(Object.keys(english[domain]).sort()).toEqual(Object.keys(chinese[domain]).sort());
    const zh: Record<string,string> = chinese[domain], en: Record<string,string> = english[domain];
    for (const key of Object.keys(zh)) expect(en[key].match(/\{\w+\}/g) ?? []).toEqual(zh[key].match(/\{\w+\}/g) ?? []);
  }
});
it("updates existing preset labels and interpolates paths without changing them", async () => {
  const presets = conversionPresets;
  await setLocale("en-US");
  expect(getLocale()).toBe("en-US");
  expect(document.documentElement.lang).toBe("en-US");
  expect(presets[0].label).toBe("Balanced");
  expect(t("home.removeRecentProjectValue", {arg0:"/论文/研究.tex"})).toBe("Remove recent project /论文/研究.tex");
  await setLocale("zh-CN");
  expect(presets[0].label).toBe("平衡");
});
