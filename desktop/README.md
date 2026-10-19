# Texgo Desktop

Tauri 2 + Rust + React + shadcn/ui. The workbench scans images referenced by a
TeX main file or opens an image directory without TeX references. Recent
workspaces and settings are remembered. PDFs retain the source stem and relative
subdirectories in a custom output folder; source images remain intact.

Conversion settings are DPI and quality percentage only (100 is lossless).
Persistent conversion history groups converted PDFs and reviewed reference
changes into one guarded undo operation. Originals and unrelated PDFs are preserved.
The primary action advances from conversion to reference review. Settings are
collapsed by default; image changes refresh automatically without clearing selection.
Original/PDF comparison, selectable reference review and reviewed missing-image
repairs share the same workspace. Low-frequency actions and GitHub app updates
live in the menu, with native desktop shortcuts and TeX file drag-and-drop.

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

**Every push triggers the desktop build.** Four targets package immediately in
parallel: Windows x64, Linux x64, macOS Apple Silicon and Intel. Every successful
push automatically publishes installers and `SHA256SUMS` to a uniquely tagged
GitHub Release. Main releases become Latest; other branches publish prereleases.

There are no cloud test, screenshot, integration or lockfile-transfer stages.
The engine is built before Tauri so it can be bundled into the same installer.

macOS requires 13.3+; PDF previews require an updated Safari 18+ WebKit runtime.
Windows requires current WebView2; Linux requires current WebKitGTK
4.1. Windows builds are unsigned; macOS builds are ad-hoc signed and not
notarized. See [packaging and installed paths](../docs/desktop-release.md),
[Chinese guide](README.zh.md), [API](../docs/api.md),
[schema](../docs/project.schema.json) and [editor example](../examples/vscode/).
The repository's [MIT license](../LICENSE) applies.
