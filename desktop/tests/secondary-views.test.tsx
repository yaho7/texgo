import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HistoryView } from "../src/SecondaryViews";
import type { ConversionHistoryEntry } from "../src/types";

it("loads history only when opened and retains expanded file/entry pagination while hidden", async () => {
  const files = Array.from({ length: 45 }, (_, index) => ({ source: `${index}.png`, output: `${index}.pdf`, cached: false, error: null }));
  const entries: ConversionHistoryEntry[] = Array.from({ length: 22 }, (_, index) => ({ id: `entry-${index}`, createdAt: Date.now(), outputDir: "pdf", dpi: 300, jpegQuality: 90, files: index === 0 ? files : [], undone: false, canUndo: false }));
  const props = { entries, busy: false, onUndo: vi.fn(), onReturn: vi.fn() };
  const view = render(<HistoryView {...props} active={false} />);
  expect(screen.queryByRole("region", { name: "操作记录", hidden: true })).not.toBeInTheDocument();
  view.rerender(<HistoryView {...props} active />);
  const history = await screen.findByRole("region", { name: "操作记录" });
  const details = within(history).getAllByText("详细信息")[0].closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  fireEvent.click(screen.getByRole("button", { name: "显示更多文件" }));
  fireEvent.click(screen.getByRole("button", { name: "显示更早记录" }));
  expect(screen.getByText("44.png")).toBeInTheDocument();
  expect(document.getElementById("operation-entry-21")).toBeInTheDocument();
  view.rerender(<HistoryView {...props} active={false} />);
  expect(history).not.toBeVisible();
  view.rerender(<HistoryView {...props} active />);
  expect(screen.getByRole("region", { name: "操作记录" })).toBe(history);
  expect(details.open).toBe(true); expect(screen.getByText("44.png")).toBeVisible();
  expect(document.getElementById("operation-entry-21")).toBeVisible();
});
