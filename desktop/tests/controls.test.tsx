import { useState, type FormEvent } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "../src/controls/button";
import { Checkbox } from "../src/controls/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../src/controls/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../src/controls/dropdown-menu";
import { FieldLabel, FieldSet } from "../src/controls/field";
import { Input } from "../src/controls/input";
import { NativeSelect, NativeSelectOption } from "../src/controls/native-select";
import { Progress } from "../src/controls/progress";
import { ToggleGroup, ToggleGroupItem } from "../src/controls/toggle-group";
import { hasTransientOverlay } from "../src/hooks/useTransientOverlay";

it("exposes mixed checkbox selection and toggles it with Space", async () => {
  const user = userEvent.setup();
  function Selection() {
    const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
    return <><Checkbox id="select-files" checked={checked} onCheckedChange={setChecked} /><FieldLabel htmlFor="select-files">选择图片</FieldLabel></>;
  }
  render(<Selection />);
  const checkbox = screen.getByRole("checkbox", { name: "选择图片" });
  expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  await user.tab();
  expect(checkbox).toHaveFocus();
  await user.keyboard(" ");
  expect(checkbox).toBeChecked();
  await user.keyboard(" ");
  expect(checkbox).not.toBeChecked();
});

it("native fields inherit disabled state and actions do not accidentally submit forms", async () => {
  const user = userEvent.setup(); const submit = vi.fn((event: FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><FieldSet disabled><Input aria-label="DPI" /><NativeSelect aria-label="启动时"><NativeSelectOption>最近项目</NativeSelectOption></NativeSelect><Checkbox aria-label="自动更新" /></FieldSet><Button>检查</Button></form>);
  expect(screen.getByRole("textbox", { name: "DPI" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "启动时" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "自动更新" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "检查" }));
  expect(submit).not.toHaveBeenCalled();
});

it("menus skip disabled entries, support keyboard selection, and release overlay tracking", async () => {
  const user = userEvent.setup(); const blocked = vi.fn(); const selected = vi.fn();
  render(<DropdownMenu><DropdownMenuTrigger asChild><Button>更多操作</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem disabled onSelect={blocked}>不可用</DropdownMenuItem><DropdownMenuItem onSelect={selected}>重新扫描</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
  const trigger = screen.getByRole("button", { name: "更多操作" });
  await user.tab(); await user.keyboard("{Enter}");
  expect(hasTransientOverlay()).toBe(true);
  expect(screen.getByRole("menuitem", { name: "不可用" })).toHaveAttribute("aria-disabled", "true");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "重新扫描" })).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(blocked).not.toHaveBeenCalled(); expect(selected).toHaveBeenCalledOnce();
  await waitFor(() => expect(hasTransientOverlay()).toBe(false));
  expect(trigger).toHaveFocus();
});

it("dialogs trap tab focus and dismiss with Escape while tracked as overlays", async () => {
  const user = userEvent.setup();
  function Review() {
    const [open, setOpen] = useState(false);
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button>审核引用</Button></DialogTrigger><DialogContent><DialogTitle>审核</DialogTitle><DialogDescription>确认后更新引用</DialogDescription><Input aria-label="文件" /><Button>确认</Button></DialogContent></Dialog>;
  }
  render(<Review />); const trigger = screen.getByRole("button", { name: "审核引用" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "审核" })).toBeInTheDocument();
  expect(hasTransientOverlay()).toBe(true);
  expect(screen.getByRole("textbox", { name: "文件" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("textbox", { name: "文件" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(hasTransientOverlay()).toBe(false);
  expect(trigger).toHaveFocus();
});

it("segmented modes keep radio semantics and keyboard selection while skipping disabled modes", async () => {
  const user = userEvent.setup(); const change = vi.fn();
  render(<ToggleGroup type="single" defaultValue="original" aria-label="预览版本" onValueChange={change}><ToggleGroupItem value="original">原图</ToggleGroupItem><ToggleGroupItem value="pdf" disabled>PDF</ToggleGroupItem><ToggleGroupItem value="compare">对比</ToggleGroupItem></ToggleGroup>);
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
  await user.tab(); await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "对比" })).toHaveFocus();
  await user.keyboard(" ");
  expect(change).toHaveBeenCalledWith("compare");
  expect(screen.getByRole("radio", { name: "PDF" })).toBeDisabled();
});

it("progress exposes completed work and omits a value for indeterminate work", () => {
  const view = render(<Progress aria-label="图片转换" value={7} max={10} />);
  expect(screen.getByRole("progressbar", { name: "图片转换" })).toHaveAttribute("aria-valuenow", "7");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "10");
  view.rerender(<Progress aria-label="图片转换" value={null} />);
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});
