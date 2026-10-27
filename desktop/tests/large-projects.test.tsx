import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssetList from "../src/AssetList";
import type { ImageAsset } from "../src/types";

describe("large project browsing", () => {
  it.each([100, 500, 1000])("keeps %i images paginated and preserves the current page on refresh", (count) => {
    const images: ImageAsset[] = Array.from({ length: count }, (_, index) => ({
      id: `image-${index}`, path: `/paper/figures/${index}.png`, relativePath: `figures/${index}.png`,
      format: "png", width: 100, height: 100, bytes: 100, status: "ready", message: null, references: [],
    }));
    const props = {
      images, allImages: images, selectionMode: false, pendingIds: new Set(images.map((image) => image.id)),
      problemIds: new Set<string>(), completedIds: new Set<string>(), total: count, selected: new Set<string>(),
      activeId: images[0].id, results: {}, busy: false, search: "", filter: "all",
      onSearch: vi.fn(), onFilter: vi.fn(), onSelect: vi.fn(), onSelectAll: vi.fn(), onActivate: vi.fn(),
    };
    const view = render(<AssetList {...props} />);
    expect(screen.getAllByRole("button", { name: /^预览 / })).toHaveLength(40);
    expect(screen.queryByRole("button", { name: "预览 figures/40.png" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页图片" }));
    expect(screen.getByRole("button", { name: "预览 figures/40.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 figures/0.png" })).not.toBeInTheDocument();

    // New backend objects must not remount or reset the browsing page.
    const refreshed = images.map((image) => ({ ...image, updateAvailable: true }));
    view.rerender(<AssetList {...props} images={refreshed} allImages={refreshed} />);
    expect(screen.getAllByRole("button", { name: /^预览 / })).toHaveLength(40);
    expect(screen.getByRole("button", { name: "预览 figures/40.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览 figures/40.png" }));
    expect(props.onActivate).toHaveBeenLastCalledWith("image-40");
  });
});
