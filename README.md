# Texgo

[中文](README.zh.md)

**Speed up LaTeX compilation.** Texgo prepares project images as PDFs, keeps them
up to date, and lets you review reference changes before touching your `.tex` files.
Available for Windows, macOS and Linux. Projects stay on your computer.

[Download](https://github.com/yaho7/texgo/releases/latest) ·
[User guide](desktop/README.md) · [Troubleshooting](docs/troubleshooting.md)

## Open, process, review

1. Open or drop the main `.tex` file. Texgo scans its included files and images.
2. Process pending images; compare the original with the resulting PDF.
3. Review proposed LaTeX reference changes and explicitly apply your selection.

Background monitoring refreshes status. Smart Convert can update Texgo-managed
PDFs, but neither feature edits `.tex` files automatically. Before applying a
reference plan, Texgo rereads target files and checks their complete fingerprints.
Changed files stop the write and require a new scan. Save unsaved changes in other
editors before applying; Desktop cannot inspect their in-memory buffers.

Operation history provides guarded Undo. Image menus offer rename, retry, temporary
or permanent ignore, and explicit reconversion. Settings include Chinese/English,
processing defaults, background behavior, notifications and global shortcuts.

### Home

![Texgo Home](docs/images/home.jpg)

### Workspace

![Texgo workspace](docs/images/workspace.jpg)

### Compare

![Original and PDF comparison](docs/images/compare.jpg)

Screenshots show the production frontend with deterministic sample data and mocked
native services. The preview opens a sample project; the installed desktop app opens
a native file picker. These are UI illustrations, not installed-platform acceptance tests.

## Desktop and automation

One installer includes the desktop app and the independent `texgo-engine` CLI/JSON-RPC
engine. Image processing needs neither TeX nor GraphicsMagick. Existing engine
compilation commands require a local TeX distribution and `latexmk`.

- [CLI and API](docs/api.md), [configuration schema](docs/project.schema.json),
  [VS Code / LaTeX Workshop configuration example](examples/vscode/)
- [Platform requirements, installed engine paths and signed updates](docs/desktop-release.md)
- [Development](docs/development.md), [contributing](CONTRIBUTING.md),
  [architecture and delivery status](docs/product-upgrade-report.md)

Built with Tauri 2, Rust, React and Tailwind CSS. Branch builds produce artifacts;
only an exact `v<manifest version>` tag can publish a release after all four platform
builds pass. Windows installers are unsigned; macOS signing and notarization results
must be checked in the release workflow.

## Contributors

[yaho7](https://github.com/yaho7), with AI-assisted contributions from Codex in
implementation, verification and documentation.

[MIT license](LICENSE).
