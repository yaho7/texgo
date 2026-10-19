# Texgo

[中文](README.zh.md)

A local LaTeX image workbench for Windows, macOS and Linux, built with
Tauri 2, Rust, React and shadcn/ui. Every installer includes both the desktop
application and the independent `texgo-engine` CLI/JSON-RPC API.

## Download

Get the installer for your platform from [GitHub Releases](https://github.com/yaho7/texgo/releases/latest).
macOS requires 13.3+ and an updated Safari 18+ WebKit for PDF previews.
Windows packages are unsigned; macOS packages are
ad-hoc signed and not notarized. See [platform requirements and signing](docs/desktop-release.md).

## Workflow

1. Open a `.tex` main file, or choose an image directory without TeX references.
2. Select images; expand output settings for presets, DPI, quality and destination.
3. Convert to same-stem PDFs while preserving source images and subdirectories.
4. Compare the original and PDF side by side, then review and select reference changes.
5. Undo a complete task, including its references and PDFs, from conversion history.

Image changes are detected in the background. The application menu contains
GitHub release checks, manual rescanning and other less frequent actions.

Conversion does not require GraphicsMagick or TeX. Document compilation through
the engine requires an installed TeX distribution and `latexmk`. Quality 100
uses lossless image encoding; lower DPI never upscales the source image.

## Automation

The bundled engine works independently of the GUI. Use a versioned JSON
configuration or JSON-RPC to scan, convert, compile and watch projects from
VS Code or another editor. No second engine installation is needed.

- [CLI and API](docs/api.md)
- [Project configuration schema](docs/project.schema.json)
- [VS Code and LaTeX Workshop example](examples/vscode/)
- [Installed engine paths](docs/desktop-release.md#one-install-gui-and-cli)

## Development

Application source is in `desktop/`. With development dependencies installed,
run the local no-output static check:

```sh
cd desktop
npm run check
```

Every successful push packages all four platforms and automatically publishes
a uniquely tagged GitHub Release. Main releases become Latest. Compilation,
packaging and publication are handled by GitHub Actions.
See [desktop development](desktop/README.md) and [release workflow](docs/desktop-release.md).

## License

[MIT](LICENSE).
