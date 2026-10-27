import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ReviewDialog from "../src/ReviewDialog";

it("bounds a large selected-file summary while keeping every target accessible", async () => {
  const files = Array.from({ length: 100 }, (_, index) => ({ path: `/paper/chapters/${index}/a-long-chapter-name.tex`, fingerprint: `hash-${index}`, changes: [{ id: `change-${index}`, line: 1, before: "a.png", after: "a.pdf" }] }));
  render(<ReviewDialog preview={{ files, referenceCount: files.length }} root="/paper" busy={false} error={null} onClose={vi.fn()} onApply={vi.fn()} />);
  const summary = screen.getByRole("list", { name: "所选文件" });
  expect(summary).toHaveClass("max-h-16", "overflow-y-auto");
  expect(within(summary).getAllByRole("listitem")).toHaveLength(100);
  expect(summary).toHaveTextContent("chapters/99/a-long-chapter-name.tex（1 处）");
  expect(screen.getByText(/应用前请保存其他编辑器中的未保存修改/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "应用 100 处引用修改" })).toBeEnabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "全选" }));
  expect(screen.getByText("已选择 0 个文件，0 处引用")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "应用 0 处引用修改" })).toBeDisabled();
});
