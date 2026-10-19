import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AssetProblems, { type AssetProblemsProps } from "../src/AssetProblems";
import type { ImageAsset } from "../src/types";

const asset: ImageAsset = {
  id: "missing-plot", path: null, relativePath: "plot", format: "",
  width: null, height: null, bytes: null, status: "missing", message: "找不到图片",
  references: [{ file: "/project/chapter.tex", line: 4, start: 20, end: 24, original: "plot" }],
};

function props(overrides: Partial<AssetProblemsProps> = {}): AssetProblemsProps {
  return {
    asset, projectRoot: "/project", busy: false,
    candidates: [{ path: "/project/figs/plot.png", relativePath: "figs/plot.png" }],
    onClose: vi.fn(), onChoose: vi.fn(), onLocate: vi.fn(), onIgnore: vi.fn(), ...overrides,
  };
}

it("requires an explicit candidate selection before requesting a review", async () => {
  const user = userEvent.setup();
  const callbacks = props();
  render(<AssetProblems {...callbacks} />);
  const review = screen.getByRole("button", { name: "查看修复" });
  expect(review).toBeDisabled();
  expect(screen.getByRole("radio")).not.toBeChecked();
  const candidateRow = screen.getByRole("radio", { name: "figs/plot.png" }).closest("label");
  expect(candidateRow).toHaveClass("min-h-10", "w-full");
  await user.click(candidateRow!);
  await user.click(review);
  expect(callbacks.onChoose).toHaveBeenCalledExactlyOnceWith(asset.id, "/project/figs/plot.png");
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

it("locates a file and ignores only this session through separate callbacks", async () => {
  const user = userEvent.setup();
  const callbacks = props();
  render(<AssetProblems {...callbacks} />);
  await user.click(screen.getByRole("button", { name: "定位文件" }));
  expect(callbacks.onLocate).toHaveBeenCalledExactlyOnceWith(asset.id);
  await user.click(screen.getByRole("button", { name: "忽略本次" }));
  expect(callbacks.onIgnore).toHaveBeenCalledExactlyOnceWith(asset.id);
  expect(callbacks.onChoose).not.toHaveBeenCalled();
});

it("disables every mutation and dismissal while busy", async () => {
  const user = userEvent.setup();
  const callbacks = props({ busy: true });
  render(<AssetProblems {...callbacks} />);
  expect(screen.getByRole("radio")).toBeDisabled();
  for (const name of ["定位文件", "忽略本次", "查看修复", "关闭图片问题"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  await user.keyboard("{Escape}");
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

it("allows locating when no exact candidates were found", () => {
  render(<AssetProblems {...props({ candidates: [] })} />);
  expect(screen.getByText("没有匹配的候选文件")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "定位文件" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "查看修复" })).toBeDisabled();
});

it("resets the choice when changing the affected asset", async () => {
  const user = userEvent.setup();
  const callbacks = props();
  const view = render(<AssetProblems {...callbacks} />);
  await user.click(screen.getByRole("radio"));
  view.rerender(<AssetProblems {...callbacks} asset={{ ...asset, id: "another", status: "ambiguous" }} />);
  expect(screen.getByRole("radio")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "查看修复" })).toBeDisabled();
});

it("does not submit a candidate removed by a refresh", async () => {
  const user = userEvent.setup();
  const callbacks = props();
  const view = render(<AssetProblems {...callbacks} />);
  await user.click(screen.getByRole("radio"));
  view.rerender(<AssetProblems {...callbacks} candidates={[]} />);
  expect(screen.getByRole("button", { name: "查看修复" })).toBeDisabled();
  expect(callbacks.onChoose).not.toHaveBeenCalled();
});

it("reports candidate failures and does not offer dynamic-reference repair", () => {
  const callbacks = props({ asset: { ...asset, status: "unsupported" }, error: "扫描失败" });
  render(<AssetProblems {...callbacks} />);
  expect(screen.getByRole("alert")).toHaveTextContent("扫描失败");
  expect(screen.getByRole("button", { name: "查看修复" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "定位文件" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "忽略本次" })).toBeEnabled();
});

it("shows all affected references and does not render without an asset", () => {
  const callbacks = props();
  const view = render(<AssetProblems {...callbacks} />);
  expect(screen.getByText("chapter.tex:4")).toBeInTheDocument();
  view.rerender(<AssetProblems {...callbacks} asset={null} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
