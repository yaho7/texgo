import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AssetList from "../src/AssetList";
import type { ImageAsset } from "../src/types";
const ipc = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:ipc.invoke}));
const source="data:image/png;base64,dGh1bWI=";
const images:ImageAsset[]=Array.from({length:1000},(_,index)=>({id:`image-${index}`,path:`/paper/figure-${index}.png`,relativePath:`figures/figure-${index}.png`,format:"png",width:2400,height:1600,bytes:1200,status:"ready",message:null,references:[]}));
function props() { return { images,allImages:images,total:1000,pendingIds:new Set(images.map(image=>image.id)),problemIds:new Set<string>(),completedIds:new Set<string>(),selected:new Set<string>(),activeId:null,results:{},busy:false,selectionMode:false,search:"",filter:"all",onSearch:vi.fn(),onFilter:vi.fn(),onSelect:vi.fn(),onSelectAll:vi.fn(),onActivate:vi.fn(),thumbnailContext:{mainFile:"/paper/main.tex",revision:1,enabled:true} }; }
it("loads only the forty visible rows and uses a separate status cell and basename",async()=>{
  ipc.invoke.mockResolvedValue({kind:"image",data:source});
  const view=render(<AssetList {...props()}/>);
  await waitFor(()=>expect(ipc.invoke).toHaveBeenCalledTimes(40));
  expect(ipc.invoke.mock.calls.every(([command,args])=>command==="asset_thumbnail" && args.expectedMainFile==="/paper/main.tex")).toBe(true);
  const row=screen.getByRole("button",{name:"预览 figures/figure-0.png"}).closest("tr")!;
  expect(within(row).getByText("figure-0")).toBeInTheDocument(); expect(within(row).queryByText("figure-0.png")).not.toBeInTheDocument();
  expect(within(row).getAllByText("PNG")).toHaveLength(1); expect(within(row).queryByText(/2400|1600/)).not.toBeInTheDocument();
  const headers=screen.getAllByRole("columnheader"); const cells=within(row).getAllByRole("cell");
  const statusIndex=headers.findIndex(header=>header.textContent==="状态");
  expect(cells[statusIndex]).toHaveTextContent("待处理"); expect(within(cells[statusIndex]).queryByRole("button")).not.toBeInTheDocument();
  expect(row.querySelector("img")).toHaveAttribute("src",source);
  expect(screen.queryByRole("columnheader",{name:"分辨率"})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"下一页图片"}));
  await waitFor(()=>expect(ipc.invoke).toHaveBeenCalledTimes(80));
  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(40);
});
it("ignores old thumbnails after project switch and makes no new reads while hidden",async()=>{
  let resolveOld!:(value:{kind:string;data:string})=>void;
  ipc.invoke.mockReset(); ipc.invoke.mockImplementation((_command,args)=>args.expectedMainFile==="/paper/main.tex"?new Promise(done=>{resolveOld=done;}):Promise.resolve({kind:"image",data:source}));
  const p={...props(),images:[images[0]],allImages:[images[0]],total:1};
  const view=render(<AssetList {...p}/>);
  view.rerender(<AssetList {...p} thumbnailContext={{mainFile:"/other/main.tex",revision:2,enabled:true}}/>);
  resolveOld({kind:"image",data:"data:image/png;base64,b2xk"});
  await waitFor(()=>expect(view.container.querySelector("img")).toHaveAttribute("src",source));
  const calls=ipc.invoke.mock.calls.length;
  view.rerender(<AssetList {...p} thumbnailContext={{mainFile:"/other/main.tex",revision:3,enabled:false}}/>);
  expect(ipc.invoke).toHaveBeenCalledTimes(calls);
});
