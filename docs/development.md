# Development and local verification

Texgo's frontend requires Node.js 22 and npm. Native tests require Rust/Cargo and the platform's Tauri development prerequisites. On macOS, install Xcode Command Line Tools. This repository supports local tests; GitHub Actions additionally verifies native packaging for Windows, Linux and both macOS architectures.

```sh
cd desktop
npm ci
npm run check
npm run check:i18n
npm test
npm run test:release
npm run test:pdf
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features automation
```

The default desktop feature embeds resources which are generated, not checked into Git. Before its first test run, build the actual bundled engine and generate icons. On Apple Silicon macOS:

```sh
cd desktop
cargo build --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features automation --bin texgo-engine
mkdir -p src-tauri/binaries
cp src-tauri/target/debug/texgo-engine src-tauri/binaries/texgo-engine-aarch64-apple-darwin
npm exec tauri icon app-icon.svg
cargo test --locked --manifest-path src-tauri/Cargo.toml --features updater-tests
```

Use the host triple reported by `rustc -vV` for the sidecar filename on other platforms; Windows additionally uses `.exe`. CI's package job shows platform-specific staging. Generated binaries, icons, target files and frontend distributions remain ignored. Do not commit fake sidecars or bypass resource checks to get tests running.

Passing local tests does not verify installed-app notifications, global shortcuts, signing, notarization, tray availability, or update installation. Those require native platform checks.

Native observation tests include a real filesystem-event smoke test. On macOS a restricted agent sandbox can deny FSEvents stream initialization; run that test with the environment's normal permission review rather than treating a fallback-only run as proof of native events. The product-upgrade verification exercised real macOS FSEvents outside the sandbox. Windows/Linux runtime checks still require their native environments.

The October 28 local verification passed 308 frontend tests, one PDF renderer test,
12 release/signature/feed tests, 293 headless Rust tests and 288 desktop Rust tests
with `updater-tests`. The Rust feature sets deliberately discover different tests.
These counts describe the recorded run; rerun the relevant checks after changes.
Language maintenance is documented in [the locale guide](../desktop/src/locales/README.md).

For local UI development, run `npm run tauri dev` after preparing the resources.
`npm run dev` serves the frontend alone and cannot provide native file dialogs or
project filesystem operations. `scripts/review-ui.mjs` is a separate CI-only visual
harness with deterministic data and mocked native IPC; its file picker intentionally
returns a fixture path. It is not a browser edition of Texgo. The manual UI review
workflow uploads screenshots and a report; inspect its actual run before claiming CI
visual acceptance.

### Desktop diagnostic logs

Advanced settings can enable debug logs after an explicit successful save and
open the application log directory. The default filter records warn/error;
debug adds typed operation events and bounded counts/durations. Logging never
includes project paths, file/document/image/reference contents, payloads,
credentials or raw error strings. The in-window error keeps its original detail.
The headless engine does not initialize a file logger and its JSON output stays
unchanged.

Logs use new, exclusive files with a format marker and JSON Lines records,
rotating at 1 MiB with at most four owned files (current plus three previous).
Startup also prunes previous owned files. Unknown files are preserved. Directory
ancestors and leaves are opened without following symlinks; linked leaves are
rejected and a retained newly-created file handle is the only write target.
Optional directory/disk failures disable diagnostics without blocking startup.
Tests use temporary directories for filter changes, rotation/restart, concurrent
serialization, deterministic I/O failure, FIFO rejection and symlink/hardlink
rejection. Pure notification outcome and close reachability policies are tested
without requiring a real platform service; native adapter startup failures still
need runtime checks on each target platform.
