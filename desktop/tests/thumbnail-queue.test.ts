import { expect, it, vi } from "vitest";
import { ThumbnailQueue } from "../src/thumbnailQueue";
const request = (key: string) => ({ key, imageId: key, mainFile: "/paper/main.tex" });
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

it("bounds concurrency across page/project changes and discards obsolete queued/results", async () => {
  const resolve = new Map<string, (value: string) => void>();
  const load = vi.fn(({ key }: { key: string }) => new Promise<string>((done) => resolve.set(key, done)));
  const queue = new ThumbnailQueue(load); const oldNotice = vi.fn(); const notice = vi.fn();
  const stop = queue.set([request("a"), request("b"), request("c")], oldNotice);
  expect(load.mock.calls.map(([item]) => item.key)).toEqual(["a", "b"]);
  stop(); queue.set([request("new-project")], notice);
  expect(load).toHaveBeenCalledTimes(2);
  resolve.get("a")!("old-data"); await flush();
  expect(load.mock.calls.map(([item]) => item.key)).toEqual(["a", "b", "new-project"]);
  expect(queue.get("a")).toBeUndefined(); expect(oldNotice).not.toHaveBeenCalled();
  resolve.get("b")!("old-data"); resolve.get("new-project")!("new-data"); await flush();
  expect(queue.get("new-project")).toBe("new-data"); expect(notice).toHaveBeenCalledOnce();
});
it("reuses cached thumbnails, bounds retained entries, and retries only with a new revision key", async () => {
  const load = vi.fn(async ({ key }: { key: string }) => { if (key === "bad") throw new Error("missing"); return key; });
  const queue = new ThumbnailQueue(load, 2);
  queue.set([request("a"), request("b")], vi.fn()); await flush();
  queue.set([request("a")], vi.fn()); await flush(); expect(load).toHaveBeenCalledTimes(2);
  queue.set([request("bad")], vi.fn()); await flush(); expect(queue.get("bad")).toBeNull(); expect(queue.get("a")).toBeUndefined();
  queue.set([request("bad")], vi.fn()); await flush(); expect(load).toHaveBeenCalledTimes(3);
  queue.set([request("bad-new-revision")], vi.fn()); await flush(); expect(queue.get("bad-new-revision")).toBe("bad-new-revision");
});
it("unmount drops queued work and never notifies a detached view", async () => {
  const resolve: ((value: string) => void)[] = [];
  const load = vi.fn(() => new Promise<string>((done) => resolve.push(done)));
  const notice = vi.fn(); const queue = new ThumbnailQueue(load);
  const stop = queue.set(Array.from({length: 40}, (_, index) => request(String(index))), notice);
  stop(); resolve.forEach((done) => done("png")); await flush();
  expect(load).toHaveBeenCalledTimes(2); expect(notice).not.toHaveBeenCalled();
});
