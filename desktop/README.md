# Texgo Desktop

[中文](README.zh.md) · [Download](https://github.com/yaho7/texgo/releases/latest)

Texgo prepares project images to speed up LaTeX compilation. The Tauri desktop
app uses Rust, React, Tailwind CSS and owned controls with Radix primitives.

## Everyday workflow

Open or drop the main `.tex` file. Home has no sidebar or topbar; its Settings
entry sits at the bottom left. In the workspace, Open project and History share
one navigation group, followed by Library filters and recent projects. The Home
icon returns to the landing page without closing the project. Only Close current
project closes the native workspace.

The bottom command bar recommends reference review, pending image processing,
problem resolution or up to date, in that order. It processes all pending images
by default. Temporary selection supports partial processing. Manual reconversion
remains available for the current image or every convertible image; it bypasses
cache reuse, never file ownership or safety checks.

Select an image to inspect its original, PDF or overlay comparison. Thumbnails
help locate images; dimensions appear in the inspector. Parameters live in a
popover with Balanced, High quality and Small file size presets. DPI never
upscales the source; quality 100 uses lossless image encoding. See the
[image and parser details](README.zh.md).

## Reference review and recovery

Monitoring scans and refreshes status. Smart Convert updates managed PDFs only.
Neither edits `.tex` automatically. Changed reference paths become a Pending
Review plan, selectable by file or individual occurrence.

Applying a plan rereads all targets and verifies the complete-file SHA-256
fingerprints recorded when the plan was generated. Changed files stop application
before writes. Rescan and confirm a fresh plan; background refresh does not silently
refresh an existing plan's fingerprints. Save other editors before applying:
Desktop cannot detect their unsaved buffers.

History groups operations by date, leads with the result, and keeps file details
collapsed. Undo validates the entire recovery operation before restoring references
and PDFs. External changes stop recovery. Keep `.texgo/`, which contains managed
mappings, journals and recovery data.

## Image actions

Ignore for this session or persist an ignore rule in `.texgo/ignore.json`. Ignored
images remain visible and can be restored or processed explicitly once. Corrupt
rules block writes rather than being overwritten.

Double-click a filename, press F2, or choose Rename to edit its basename; its
extension stays fixed. Enter submits, Escape or blur cancels. The Rust transaction
migrates the source, managed PDFs, verified reference spans, mappings and ignore
identity. It records durable before/after states and supports guarded Undo.
Conflicts, unsafe paths, external edits and unfinished recovery block writes.
Case-only names, dotted names with extensionless references and external SVG
resources are conservatively rejected.

## Settings and background use

Settings is a standalone page. Chinese and English apply after Save and persist
across launches. General behavior, image defaults, automation, notifications,
recorded global shortcuts and advanced controls are separate groups.

The default global shortcut is Cmd+Option+Enter on macOS and Ctrl+Alt+Enter on
Windows/Linux. Closing normally keeps Texgo in the background; use the tray or
Dock to reopen it. Availability depends on OS permissions and desktop services.
See [background behavior](../docs/background-workflow.md).

App updates require explicit download, install and restart actions. Signatures
and version are checked at download and again at install. On Windows, the explicit
install action lets the installer quit and relaunch the app. See
[release and platform requirements](../docs/desktop-release.md).

## Development and integration

See [local setup and checks](../docs/development.md) and
[contribution guidelines](../CONTRIBUTING.md). Ordinary pushes run lightweight checks; manual builds produce artifacts.
Only an exact `v<manifest version>` tag can publish after all four targets pass.

Every installer includes the independent `texgo-engine` CLI/JSON-RPC engine.
Image processing needs neither TeX nor GraphicsMagick. Existing document compilation
commands need a local TeX distribution and `latexmk`.
[API](../docs/api.md) · [Schema](../docs/project.schema.json) ·
[VS Code configuration example](../examples/vscode/) · [MIT](../LICENSE)
