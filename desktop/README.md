# Texgo Desktop

Tauri 2 + Rust + React + shadcn/ui. Texgo maintains images referenced by a LaTeX project. Open or drop the main `.tex` file; the sidebar is the only main navigation.

Rust publishes one `WorkspaceStatus` snapshot for the GUI, Smart Convert, tray and notifications. The next action is reference review, image updates, problem resolution, or up to date, in that order. The bottom command bar is the only primary action area. Updates include all pending images by default; temporary selection mode supports partial updates.

The current-image inspector contains the original/PDF overlay (original left, PDF right), metadata, reference locations and problem details. Conversions open reference review automatically only when paths change. Output settings are a lightweight popover with three presets; custom values are inferred. Operation records contain guarded Undo with technical details folded away.

Settings cover general behavior, conversion defaults, background/notifications, recorded global shortcuts and advanced safety controls. Page, action, badge, preview and surface transitions share CSS motion tokens and respect reduced motion. Refresh and navigation preserve browsing context.

Every installer includes the independent `texgo-engine` CLI/JSON-RPC API.
Install once for both GUI and automation; no second engine download is needed.
Use its [installed path](../docs/desktop-release.md#one-install-gui-and-cli)
in VS Code or another editor. Compilation needs an installed TeX distribution
and `latexmk`; image conversion does not need GraphicsMagick or TeX.

## Development

Local static check, with development dependencies installed:

```sh
npm run check
```

Compilation and packaging happen on GitHub Actions, not locally. Existing unit
tests and browser fixtures remain available for explicitly requested testing.

## Packaging

Push and manual dispatch run frontend typechecking, frontend/PDF tests and headless Rust tests. Four native package jobs then test and package Windows x64, Linux x64, macOS Apple Silicon and Intel. The engine is built first and bundled with Tauri. Successful main/tag runs publish installers and `SHA256SUMS`; other branches only upload artifacts.

Local test/build commands are not used in this workflow; use no-emit static checking locally and GitHub Actions for executable validation.

macOS requires 13.3+; PDF previews require an updated Safari 18+ WebKit runtime.
Windows requires current WebView2; Linux requires current WebKitGTK
4.1. Windows builds are unsigned; macOS builds use Developer ID signing and Apple notarization. See [packaging and installed paths](../docs/desktop-release.md),
[Chinese guide](README.zh.md), [API](../docs/api.md),
[schema](../docs/project.schema.json) and [editor example](../examples/vscode/).
The repository's [MIT license](../LICENSE) applies.

## Explicit asset control

The Command Bar recommends one primary action but keeps manual conversion available in every project state. Its conversion menu updates pending images, selects a temporary subset, or explicitly reconverts the current/all convertible assets. A manual reconvert bypasses cache reuse, never output ownership, external-edit, symlink, journal, or pending-reference protection. Smart Convert remains pending-only.

Asset menus distinguish session ignore from permanent project ignore (`.texgo/ignore.json`, version 1). Permanent identities use normalized project-relative source paths, or relative TeX file plus original reference argument for unresolved assets; IDs and line numbers are not persisted. Ignored assets can be converted explicitly once without removing their ignore rule. Corrupt rules block writes rather than being overwritten.

Double-click the filename text, press F2, or choose Rename to edit its basename with a fixed extension. Enter submits; Escape/blur cancels; errors remain inline. The Rust transaction migrates the source, managed PDFs, verified TeX reference spans, ownership, mappings, and ignore identities. It records durable before/after states before writing and rolls back interrupted work before scanning. History and safe reverse-order Undo include rename operations. Keep `.texgo/` to preserve recovery data. Case-only names, dotted names with extensionless references, and assets referenced as external SVG resources are conservatively rejected.
