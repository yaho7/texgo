# v0.3.0 release recovery and shorter CI

User authorization: finish and publish v0.3.0; simplify slow Actions and omit
unnecessary/repeated tests, especially duplicate compilation.

First run 40653783482 failed: Windows compiled a Unix inode test without its cfg;
macOS installer collection could not select exactly one updater archive after the
Action's artifact processing. Linux was cancelled, and nothing was published.

- Restrict the inode-specific test to Unix on main.
- Ordinary pushes: lightweight checks; no four-platform packaging.
- Release/manual: build the frontend once and reuse its artifact across platforms.
- Default packaging: release builds only; optional full tests retain the existing
  regression commands without a mandatory debug/test build on every runner.
- Reuse target-specific Rust caches, including workspace artifacts.
- Use the pinned local Tauri CLI directly; clear only generated bundle directories.
- Preserve Apple signing/notarization, updater signatures, version/source checks,
  exact-tag policy and immutable published releases.
- Rebuild existing unpublished v0.3.0 through a main-branch workflow dispatch that
  checks out its original source. Do not move or force-push the tag.

Focused verification: actionlint, 12 release/signature tests, Unix inode regression.
Actual timing and package success must come from the recovery run, not estimates.

Recovery run 40656747293: Windows and Linux passed. Both macOS builds and Apple
notarizations succeeded, then collection failed because the matrix requested only
`dmg`. The bundler explicitly warned that no updater-enabled target was selected.
Correct both macOS entries to `app,dmg`; retain the successful notarization/signing
path and reuse the populated Rust caches. No additional test suite is required.
