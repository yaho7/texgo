import { expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { getLocale, loadLocale, setLocale, t } from "../src/i18n";
import { conversionPresets } from "../src/preferences";
it("keeps independent catalogs and interpolation parameters in parity", async () => {
  const chinese = await loadLocale("zh-CN"), english = await loadLocale("en-US");
  for (const domain of Object.keys(chinese) as (keyof typeof chinese)[]) {
    expect(Object.keys(english[domain]).sort()).toEqual(Object.keys(chinese[domain]).sort());
    const zh: Record<string,string> = chinese[domain], en: Record<string,string> = english[domain];
    for (const key of Object.keys(zh)) {
      const params = [...zh[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]);
      const found = new Set<string>();
      const message = new IntlMessageFormat(en[key], "en-US", undefined, {ignoreTag:true});
      function visit(nodes: ReturnType<IntlMessageFormat["getAst"]>) {
        for (const node of nodes) {
          if (node.type !== 0 && node.type !== 7 && "value" in node) found.add(node.value);
          if ("options" in node) for (const option of Object.values(node.options)) visit(option.value);
        }
      }
      visit(message.getAst());
      expect([...found].sort(), `${domain}.${key}`).toEqual([...new Set(params)].sort());
      expect(() => message.format(Object.fromEntries(params.map(name => [name, 2])))).not.toThrow();
    }
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
it("formats English singular and plural counts independently", async () => {
  await setLocale("en-US");
  expect(t("commandBar.processValueImages",{arg0:1})).toBe("Process 1 image");
  expect(t("commandBar.processValueImages",{arg0:2})).toBe("Process 2 images");
  expect(t("reviewDialog.summary",{files:1,references:2})).toBe("1 file, 2 references");
});

it("localizes safety diagnostics without translating filenames or references", async () => {
  const { nativeText } = await import("../src/nativeText");
  const message = "/论文/实验结果.tex 在审核期间已被修改或无法验证。Texgo 未修改引用文件，请重新扫描引用。";
  await setLocale("en-US");
  const english = nativeText(message);
  expect(english).toContain("/论文/实验结果.tex");
  expect(english).toContain("Texgo did not edit the reference files");
  expect(nativeText("后台任务失败：工作区状态不可用")).toBe("Background task failed: Workspace state is unavailable");
  expect(nativeText("unknown technical error: /论文/实验.tex")).toBe("unknown technical error: /论文/实验.tex");
  await setLocale("zh-CN");
  expect(nativeText(english)).toBe(message);
});
