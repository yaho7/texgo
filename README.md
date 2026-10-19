# Texgo

[中文](README.zh.md)

A local LaTeX project image assistant for Windows, macOS and Linux, built with
Tauri 2, Rust, React and shadcn/ui. Every installer includes both the desktop
application and the independent `texgo-engine` CLI/JSON-RPC API.

## Download

Get the installer for your platform from [GitHub Releases](https://github.com/yaho7/texgo/releases/latest).
macOS requires 13.3+ and an updated Safari 18+ WebKit for PDF previews.
Windows packages are unsigned; macOS packages use Developer ID signing and Apple notarization. See [platform requirements and signing](docs/desktop-release.md).

## Workflow

1. Open or drop a LaTeX main file. Texgo discovers the project's image references.
2. Follow the single recommended action: review references, update pending images, or resolve problems.
3. Update all pending images by default. Use “Select some images” only when needed; output parameters live in the bottom command bar.
4. Compare the original on the left and PDF on the right with an overlay divider. Reference changes open for review automatically and are applied only after confirmation.
5. Browse images and operation records from the sidebar. Undo restores the operation's references and PDFs together.

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
