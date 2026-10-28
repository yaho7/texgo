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
- [ ] Signed updater integration verified and committed.
