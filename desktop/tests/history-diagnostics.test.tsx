import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ConversionHistory from "../src/ConversionHistory";
import { TooltipProvider } from "../src/controls/tooltip";
import ErrorNotice from "../src/ErrorNotice";
import { historyCalendarDay } from "../src/historyPresentation";
import { errorMessage } from "../src/utils";
import type { ConversionHistoryEntry } from "../src/types";
const entry: ConversionHistoryEntry = { id: "rename", createdAt: Date.now(), outputDir: "", dpi: 0, jpegQuality: 0, files: [], undone: false, canUndo: false, undoReason: "文件 map.png 已被外部修改，无法安全撤销", rename: { oldSource: "plot.png", newSource: "map.png", newPdf: "out/map.pdf", pdfCount: 2, permanentIgnoreMigrated: true, referencesChanged: 3 } };
it("groups calendar days across midnight", () => {
  const now = new Date(2026, 9, 27, 0, 5);
  expect(historyCalendarDay(new Date(2026, 9, 27, 0, 1).getTime(), now)).toContain("今天");
  expect(historyCalendarDay(new Date(2026, 9, 26, 23, 55).getTime(), now)).toContain("昨天");
  expect(historyCalendarDay(new Date(2026, 9, 25, 23, 55).getTime(), now)).toBe("2026年10月25日");
  expect(historyCalendarDay(NaN, now)).toBe("时间未知");
});
it("shows actual rename effects and native undo reason beside a disabled action", () => {
  const undo = vi.fn(); render(<ConversionHistory entries={[entry]} busy={false} onUndo={undo} />);
  expect(screen.getByText("同步更新：1 张源图片、2 个 PDF、3 处 LaTeX 引用、永久忽略规则")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "撤销" });
  expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription(entry.undoReason!);
  fireEvent.click(button); expect(undo).not.toHaveBeenCalled();
});
it("does not invent migration or PDFs for a source-only rename", () => {
  render(<ConversionHistory entries={[{ ...entry, rename: { oldSource: "a.png", newSource: "b.png", newPdf: null, pdfCount: 0, referencesChanged: 0 } }]} busy={false} onUndo={vi.fn()} />);
  expect(screen.getByText("同步更新：1 张源图片、0 处 LaTeX 引用")).toBeInTheDocument();
  expect(screen.queryByText(/永久忽略规则|1 个 PDF/)).not.toBeInTheDocument();
});
it("retains expanded file pagination across refreshed snapshots", () => {
  const files = Array.from({ length: 45 }, (_, i) => ({ source: `${i}.png`, output: `${i}.pdf`, cached: false, error: null }));
  const props = { entries: [{ ...entry, rename: null, files }], busy: false, onUndo: vi.fn() };
  const view = render(<ConversionHistory {...props} />);
  const details = screen.getByText("详细信息").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  fireEvent.click(screen.getByRole("button", { name: "显示更多文件" }));
  view.rerender(<ConversionHistory {...props} entries={props.entries.map((item) => ({ ...item }))} />);
  expect(screen.getByText("44.png")).toBeInTheDocument();
});
it("presents I/O errors with guidance and full expandable original details", async () => {
  const original = `Permission denied: /paper/${"long-directory/".repeat(30)}main.tex (os error 13)`;
  const close = vi.fn(); render(<TooltipProvider><ErrorNotice message={errorMessage(original)} file="/paper/main.tex" onClose={close} /></TooltipProvider>);
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("请检查相关文件是否仍可访问，并查看技术信息了解失败详情。")).toBeInTheDocument();
  expect(within(alert).getByText("相关文件：/paper/main.tex")).toBeInTheDocument();
  const details = screen.getByText("技术信息").closest("details")!;
  expect(details.open).toBe(false); fireEvent.click(screen.getByText("技术信息"));
  expect(await within(details).findByText(original)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" })); expect(close).toHaveBeenCalledOnce();
});
it("keeps actionable Chinese errors and paths intact", () => {
  const message = "文件 /paper/含有空格 的图.png 已被外部修改，请重新扫描后重试";
  render(<TooltipProvider><ErrorNotice message={message} onClose={vi.fn()} /></TooltipProvider>);
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("labels failed conversion attempts as conversions rather than checks", () => {
  render(<ConversionHistory entries={[{ ...entry, rename: null, files: [{ source: "bad.png", output: "", cached: false, error: "Cannot decode image" }] }]} busy={false} onUndo={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "1 张图片更新失败" })).toBeInTheDocument();
  const details = screen.getByText("详细信息").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  expect(screen.getByText("图片转换")).toBeInTheDocument();
  expect(screen.getByText("1 张图片更新失败")).toBeInTheDocument();
  expect(screen.queryByText("图片检查")).not.toBeInTheDocument();
});
it("keeps long readable errors concise while preserving every technical character", async () => {
  const message = `无法读取文件：${"长路径/".repeat(100)}main.tex`;
  render(<ErrorNotice message={message} />);
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(screen.getByText(`${message.slice(0, 300)}…`)).toBeInTheDocument();
  fireEvent.click(screen.getByText("技术信息"));
  expect(await screen.findByText(message)).toBeInTheDocument();
});

it("supports older server-shaped records that persisted zero beside a managed PDF", () => {
  render(<ConversionHistory entries={[{ ...entry, rename: { oldSource: "a.png", newSource: "b.png", newPdf: "out/b.pdf", pdfCount: 0, referencesChanged: 2 } }]} busy={false} onUndo={vi.fn()} />);
  expect(screen.getByText("同步更新：1 张源图片、1 个 PDF、2 处 LaTeX 引用")).toBeInTheDocument();
  expect(screen.queryByText(/永久忽略规则/)).not.toBeInTheDocument();
});

it.each(["中文图片", "请求图", "无法读取", "已被修改", "不支持", "不存在", "找不到"])("does not mistake the English I/O path %s for recovery guidance", (directory) => {
  render(<ErrorNotice message={`Permission denied: /paper/${directory}/main.tex (os error 13)`} />);
  expect(screen.getByText("请检查相关文件是否仍可访问，并查看技术信息了解失败详情。")).toBeInTheDocument();
});


it("keeps history records unselected while details and Undo remain explicit", () => {
  const undo = vi.fn(); const second = {...entry,id:"second",rename:null,files:[]};
  render(<ConversionHistory entries={[entry,second]} busy={false} onUndo={undo} />);
  const records = screen.getAllByRole("article");
  fireEvent.click(within(records[0]).getByRole("heading"));
  expect(records[0]).not.toHaveAttribute("data-selected");
  expect(records[0].querySelector("details")).not.toHaveAttribute("open");
  fireEvent.keyDown(records[1], {key:"Enter"});
  expect(records[1]).not.toHaveAttribute("data-selected");
  expect(records[0]).not.toHaveAttribute("data-selected"); expect(undo).not.toHaveBeenCalled();
  fireEvent.click(within(records[1]).getByText("详细信息"));
  expect(records[1].querySelector("details")).toHaveAttribute("open");
});
it("locates notified records without adding a selected appearance", () => {
  const second = {...entry,id:"second",rename:null,files:[]};
  const props = {entries:[entry,second],busy:false,onUndo:vi.fn()};
  const view = render(<ConversionHistory {...props} highlightId={entry.id} />);
  const records = screen.getAllByRole("article");
  expect(records[0]).not.toHaveAttribute("data-selected");
  expect(records[0].querySelector("details")).not.toHaveAttribute("open");
  fireEvent.click(records[1]); expect(records[0]).not.toHaveAttribute("data-selected");
  expect(records[1]).not.toHaveAttribute("data-selected");
  view.rerender(<ConversionHistory {...props} entries={[...props.entries]} highlightId={entry.id} />);
  expect(records[1]).not.toHaveAttribute("data-selected");
});
