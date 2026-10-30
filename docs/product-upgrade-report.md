# Product upgrade delivery — 2026-10-28

## Scope

The approved desktop upgrade is implemented through Phases 1–4, 6 and 7, with
Phase 9 documenting the resulting product. Phase 5 (LaTeX compilation validation)
and Phase 8 (a new VS Code extension) remain cancelled at the user's request.
Existing CLI/RPC compilation and the editor configuration example are preserved.
This report records local implementation acceptance. Publication of `v0.3.0` is
authorized separately and must pass the release workflow.

## Architecture and file safety

Rust remains the authority for Workspace status, managed outputs, transactions,
journals and recovery. React separates workspace, conversion, background work,
review and history behavior into focused hooks rather than one app-shell state
machine. The GUI, tray, shortcuts and notifications share the native status model.

Native file events use a 500 ms trailing debounce and a bounded queue, with
low-frequency fallback and focus checks. Watcher detects/scans/refreshes only;
Smart Convert updates managed PDFs. Neither applies `.tex` reference changes.
Reference plans require explicit confirmation, complete-file SHA-256 revalidation
immediately before application, and a new scan/confirmation after drift. The review
reminds users to save other editors; disk fingerprints cannot detect dirty buffers.

Output ownership, project-root boundaries, no-follow filesystem checks, durable
journals, interrupted-operation recovery and guarded Undo remain in place. Rename
is a foreground transaction covering source images, managed PDFs, verified references
and persisted ignore identities. External edits block unsafe writes and recovery.

## User experience

The desktop uses Tailwind CSS and owned controls with Radix primitives. Home has
one `.tex` opening action and a bottom-left Settings entry. The workspace groups
Open project and History together, then Library filters and recent projects.
The trailing Home icon returns without closing the project. The toolbar's duplicate
Texgo text button is removed.

The image list has uniform rows, real thumbnails and names without extensions;
dimensions stay in the inspector. The original/PDF overlay supports a keyboard
controlled divider. The command bar retains explicit processing and partial/manual
operations. History is grouped by date with a leading result, secondary time/status,
independent Undo and collapsible file details. The title/path, Name heading and
image names share one horizontal anchor. Sidebar Settings and the command bar
share a measured footer boundary. Columns use left/center/center/right alignment;
the redundant ready-to-process message is removed. Fractional preview measurements
are rounded down to prevent scrollbar-driven render loops.

Settings is a standalone page. Chinese and English are persisted, cover the workspace,
review, menus, tray and notifications, and live in independent JSON resources. English
ICU plurals load on demand; catalog checks validate 729 message keys and parameters.
Diagnostic translation is presentation-only and preserves paths and protocol identity.

## Release delivery

Version checks reconcile npm/Cargo/Tauri manifests and locks. Branch builds are
artifacts only. An exact `v<manifest version>` tag is required to publish; beta stays
a prerelease and stable controls Latest. Packages use `texgo_<version>_<platform>`
names, with macOS architecture suffixes. Every installer includes the engine.

The updater pins a public key, verifies bytes and signed version at download and
installation, rejects invalid origins/downgrades, and coordinates with native project
operation locks. Install and restart require explicit actions; Windows installer
relaunch is part of explicit installation. The private key was transferred to the
repository's Actions secret after explicit authorization; temporary local key files
were removed. Actual release signing/notarization and installed upgrades remain
platform acceptance tasks, not inferred from the secret configuration.

## Verification evidence

Local runs on macOS recorded:

| Check | Result |
| --- | --- |
| Frontend Vitest regression suite | 308 passed |
| Headless Rust (`automation`) | 293 passed |
| Desktop Rust (`updater-tests`) | 288 passed |
| PDF renderer | 1 passed |
| Release policy / signatures / feed | 12 passed |
| TypeScript, bilingual catalog, version consistency | Passed |
| Production frontend build | Passed |
| Workflow actionlint, issue-form YAML, relative documentation links | Passed |

Rust counts are summed from the actual test binaries; feature sets discover different
tests. Native filesystem tests exercised macOS FSEvents with normal system access.
Real signed non-executable fixtures test both the official updater verifier and the
release verifier, including tampering and forged-version failures; no fixture is installed.

Computer-use checks covered Home, workspace, comparison, standalone settings,
English switching, history and sidebar layout with deterministic native mocks.
The [Home](images/home-en.png), [workspace](images/workspace-en.png) and
[comparison](images/compare-en.png) screenshots illustrate the production frontend.
Their sample picker returns a fixture path. They do not establish native file-dialog,
installed-app or real-project acceptance. The separate manual CI visual harness was
syntax-checked locally; a new hosted run was not dispatched for this documentation task.

## Public repository maintenance

- Added concise bilingual READMEs, contribution guidelines, bug/feature forms,
  troubleshooting and translation maintenance instructions.
- Corrected the old automatic-main-release and static-check-only documentation.
- Added platform labels for macOS, Windows and Linux.
- [Issue #1](https://github.com/yaho7/texgo/issues/1) stays open with enhancement and
  Windows labels: actual Windows behavior/performance still requires acceptance.
- [Issue #2](https://github.com/yaho7/texgo/issues/2) was closed as an answered support
  question based on the maintainer's existing answer, with documentation/question
  labels. This is not a new Chinese compilation validation result.

## Main files

| Area | Locations |
| --- | --- |
| Frontend and workflow hooks | `desktop/src/App.tsx`, `desktop/src/hooks/` |
| Native state, safety and events | `desktop/src-tauri/src/` |
| Localization | `desktop/src/locales/`, `desktop/src-tauri/src/localization.rs` |
| Release policy and verifier | `desktop/scripts/`, `.github/workflows/desktop.yml` |
| Regression and visual fixtures | `desktop/tests/`, `desktop/scripts/review-ui.mjs` |
| Documentation and issue forms | `README.md`, `README.zh.md`, `docs/`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/` |

## Remaining acceptance

Run native installed workflows on Windows, Linux, macOS Intel and Apple Silicon:
real project opening, notifications and clicks, tray/close behavior, global shortcuts,
PDF WebView compatibility, and signed update installation/relaunch. Verify actual CI
packaging, Apple signing/notarization and release assets when publication is authorized.
No additional compilation-validation phase or new editor extension is planned.
