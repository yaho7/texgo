# Release and signed updater

Proceed after the completed macOS/Tailwind UI units. Phase 5 LaTeX compilation validation
and Phase 8 VS Code extension remain cancelled. Existing CLI/RPC compatibility remains.
No push, tag creation or release publication is authorized in this local task.

## Unit 1: Version and release policy

Use 0.3.0 for this product upgrade, synchronized across npm/Cargo/Tauri manifests and locks.
Add a dependency-free version check and release-policy tests. Main/other branches and unrelated
tags produce artifacts only. Only exact v<manifest version> tags can publish: stable
versions become Latest; beta.N versions are prereleases and never Latest. A mismatched desktop
tag fails before packaging. Preserve all four platform targets and current signing inputs. User tag prefix is `v`, not
`desktop-v`. Release filenames use `texgo_<version>_<platform>`, with a macOS architecture
suffix only where needed to distinguish its two builds.
Do not claim platform signing succeeded merely because secrets are configured.

## Unit 2: Signed updater

Use the published Tauri updater plugin with a real fixed public key and a private key only in
CI secrets. Signed HTTPS feed failures must be ordinary safe errors, never unsigned execution.
Checking, downloading, installing and restarting are explicit UI actions. Native operation and
workspace guards must prevent installation/restart during file work; pending reference review
must retain ownership. Signed package/feed production must follow the exact-tag release policy.
Document any setup and native installed-upgrade checks that cannot be completed without CI/devices.

## Verification

Run version-policy tests against stable/beta/main/unrelated/mismatched tags and stale locks,
frontend checks/build, and native tests appropriate to updater integration. Inspect each diff
and commit each unit before proceeding. Retain the two pre-existing user changes unstaged.

- [x] Version/release policy verified: 0.3.0 synchronized across five files/six version
  fields; exact v<version> stable/beta gating, simple collision-safe installer names and
  moved-tag refusal. Eight policy/installer tests, 296 frontend tests, TypeScript, production
  build, locked/offline Cargo metadata and actionlint/shellcheck passed. No CI release,
  package installation, push or remote tag creation was performed.
- [x] Signed updater integration verified locally: optional official plugin 2.14.1,
  fixed public key, version-bound HTTPS packages, native-only byte cache and opaque tokens,
  explicit check/download/install/restart actions, and workspace/conversion guards.
- [x] 301 frontend tests, 284 native desktop tests (including the official plugin's real
  signature verification), 289 headless tests, 12 release/signature/feed tests, PDF renderer,
  TypeScript, production build and actionlint pass.
- [x] The owner explicitly authorized transmitting this generated signing private key to
  the `yaho7/texgo` repository. `TAURI_SIGNING_PRIVATE_KEY` now exists as an encrypted Actions
  secret; temporary private key and CLI logs were removed. Only the public key and a signed,
  non-executable test payload are tracked.
- [x] Browser fixtures verify separate Download and Install actions. No actual package
  installation/restart, push, tag, release or CI packaging run was performed.

Installed-upgrade acceptance and actual platform signing/notarization remain device/CI checks;
this does not block committing the reviewed implementation. Branch packaging does not receive
this updater private key. Phase 9 documentation and final delivery audit follow this unit.
