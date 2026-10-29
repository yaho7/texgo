# Desktop Packaging

## Workflow

Code pushes run lightweight version, TypeScript, localization and release-policy checks.
Documentation-only pushes are skipped. Ordinary branches do not build four installers.
Exact `v<manifest version>` tags build and publish; manual dispatch can build artifacts
or rebuild an existing unpublished version tag without moving it.

The default release path is:

1. **Check / frontend** validates versions and release policy, then builds the frontend once.
2. **Package** downloads that frontend on four runners, builds the engine and desktop in
   release mode with the committed lockfile, and signs/collects installers. Workspaces
   share a target-specific Rust cache. The CLI builds directly, avoiding an extra artifact
   transformation layer and stale bundle output.
3. **Publish** checks the five installers and confirms the tag still points to the exact packaged source commit.

Full frontend/PDF/headless/native suites remain available through the manual `full_tests`
option and the local development commands. They are off by default for publication:
recompiling a separate debug/test dependency graph on every platform adds no installer.
Version checks and native release compilation remain mandatory.

To recover an unpublished release, dispatch Desktop on `main` with `release_tag` set to
its exact tag, for example `v0.3.0`. The current workflow checks out that tag's original
source for all jobs and pins the captured commit. It does not move the tag or publish
main's newer source under an old version. An existing published release is never overwritten.
Leave `release_tag` empty for a development artifact build. Enable `full_tests` only when
that additional regression run is needed.

No LaTeX compilation verification is added to this workflow. Lockfiles are committed, and
installers include the standalone engine; no separate engine archives are produced.

| Platform | Target | Installer |
| --- | --- | --- |
| Windows x64 | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| Linux x64 | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` |
| macOS Apple Silicon | `aarch64-apple-darwin` | `.dmg` |
| macOS Intel | `x86_64-apple-darwin` | `.dmg` |

Linux bundles use Ubuntu 22.04 as the build baseline. macOS requires 13.3+ for
the WebKit used by the Tailwind interface. PDF previews additionally
require Safari 18+ WebKit on macOS and a current WebView runtime elsewhere,
following [PDF.js browser support](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported).
The legacy PDF.js bundle supplies polyfills but does not support every older
WebView. The independent conversion engine does not depend on WebView.
Windows requires WebView2;
Linux requires an up-to-date WebKitGTK 4.1. Bundling is not a claim that every
native GUI workflow has been tested on every operating system.

## Local checks

With development dependencies installed:

```sh
cd desktop
npm run version:check
npm run test:release
npm run check
npm test
npm run test:pdf
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --features automation
```

Also inspect `git diff --check` and validate edited JSON/TOML/YAML. Local GUI/native tests
may require operating-system file watcher access. These checks do not install an update or
publish a release. Packaging/installation and native behavior need platform-specific checks.

## Release policy

The current desktop version is `0.3.2`. `version:check` compares `package.json`, both npm lock
version fields, the Cargo manifest and desktop package in its lockfile, and `tauri.conf.json`.
Supported release versions are `X.Y.Z` and `X.Y.Z-beta.N`, without numeric leading zeroes.

| Git ref | Result |
| --- | --- |
| `main` or another branch, including manual branch runs | Tests and installer artifacts only |
| Unrelated tag | Artifacts only |
| Exact `v0.3.0` with all versions `0.3.0` | Stable release marked Latest |
| Exact `v0.3.0-beta.1` with all versions `0.3.0-beta.1` | Prerelease; never Latest |
| Desktop tag that differs from the manifests | Fails verification before packaging |

Creating/pushing a release tag is an explicit maintainer action; ordinary main pushes no
longer create public releases. Do not move or reuse a published version tag. Before publication,
the job checks that the remote tag still resolves to the packaged commit, generates SHA-256
checksums, uploads a draft using the existing tag, and publishes it with the verified channel.
Existing releases/assets are not overwritten by this workflow.

Release job outputs follow [GitHub Actions job outputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs).
Publication uses the CLI's [existing-tag and prerelease options](https://cli.github.com/manual/gh_release_create).
Build identity uses the actual release tag; branch builds are identified as development builds,
not invented automatic release tags.

## One Install, GUI and CLI

Installing the desktop package supplies both the GUI and the independent
`texgo-engine` CLI/JSON-RPC executable. The GUI need not be running to call it.
Document compilation still requires a local TeX distribution and `latexmk`.

| Format | Installed engine |
| --- | --- |
| macOS DMG | `/Applications/Texgo.app/Contents/MacOS/texgo-engine` |
| Windows NSIS | `<chosen install directory>\texgo-engine.exe`; default `%LOCALAPPDATA%\Texgo\texgo-engine.exe` |
| Debian | `/usr/bin/texgo-engine` |
| AppImage | `squashfs-root/usr/bin/texgo-engine` after `--appimage-extract` |

No shell profiles or persistent PATH settings are modified. Debian naturally
installs the command on PATH. On other platforms use the absolute engine path
in both `.vscode/tasks.json` and `.vscode/settings.json`; keep arguments as a
separate JSON array. Do not embed shell quotes, `~`, or `%LOCALAPPDATA%` in the
JSON command expecting shell expansion. Keep extracted AppImages in a stable
directory rather than using their temporary mount paths.

See [the API](api.md), [schema](project.schema.json) and
[VS Code example](../examples/vscode/). Tauri's
[sidecar mechanism](https://v2.tauri.app/develop/sidecar/) bundles the engine;
no webview shell permission or HTTP API listener is introduced.

## Integrity and Signing

Release filenames are intentionally short:

- `texgo_0.3.2_windows.exe`
- `texgo_0.3.2_linux.deb` / `texgo_0.3.2_linux.AppImage`
- `texgo_0.3.2_macos_arm64.dmg` / `texgo_0.3.2_macos_x64.dmg`

Only macOS needs an architecture suffix to distinguish its two targets. Original Tauri
bundle names and the `desktop` prefix are omitted. Collection rejects multiple candidates,
empty/nonregular installers and existing destination names instead of silently overwriting.
The release contains exactly five platform installers. Update archives, `latest.json`,
signature sidecars and `SHA256SUMS` are not published. Windows packages
are unsigned. The workflow supports a Developer ID Application certificate and Apple notarization through Tauri’s supported environment variables; successful signing/notarization must be verified in the actual release job. The workflow references the five Apple repository Secrets without printing their values. Both macOS architectures share the same signing step. A configured secret or local test is not an installed-upgrade acceptance result.


## Application updates

The update menu opens the fixed GitHub latest-release page in the default browser.
Users download the installer for their platform and install it themselves.
Automatic checks read stable-release metadata from the GitHub API and only show a notice
when a newer version is available. They never download or install a package.
The application no longer uses a Tauri updater feed or updater signing keys.
Apple code signing and notarization remain part of the macOS packaging process.
If `hdiutil create` fails with `Resource busy`, packaging retries at most twice, reusing
the release compilation cache. Other failures are reported immediately.
