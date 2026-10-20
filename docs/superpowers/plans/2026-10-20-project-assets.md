# Project asset control implementation plan

> **For agentic workers:** Use scoped parallel tasks for the independent ignore store, rename transaction, and presentation components. Root integrates native commands, Workspace status, and application orchestration.

**Goal:** Add project-scoped persistent ignore and transactional asset rename, and retain explicit manual conversion in every project state.

**Architecture:** Rust remains authoritative for ignore classification, convertible assets, ownership, fingerprint validation, and next-action recommendations. Rename records a durable write intent and backups before moving sources/PDFs and applying scanner byte-range TeX edits; Undo uses the same ownership and fingerprint checks. React presents snapshots and keeps temporary rename/selection state. Manual conversion declares pending/selected/reconvert intent; Smart Convert remains pending-only.

**Tech Stack:** Existing Tauri 2, Rust, React, shadcn, CSS motion tokens. No new application dependencies.

## Unit 1: Project ignore rules

Files: `desktop/src-tauri/src/ignore.rs`, `models.rs`, `workspace.rs`, `commands.rs`, `lib.rs`, tests.

- [ ] Write store and Workspace tests: session writes no file and expires on reopen; permanent survives reopen/missing source; excludes pending/problems/Smart; restore removes rule; slash normalization; corrupt/unknown-version config blocks without overwrite.
- [ ] Implement versioned `.texgo/ignore.json` with atomic writes and external-change detection. Stable path identity carries reference aliases; unresolved identity uses relative TeX file plus original argument, never asset ID or line.
- [ ] Classify none/session/permanent in Rust and immediately return a fresh status snapshot.
- [ ] Commit a coherent ignore feature after static review; run tests remotely with the integration checkpoint.

## Unit 2: Safe asset rename and Undo

Files: new `rename.rs`, `journal.rs`, `transaction.rs`, Workspace rename/refresh/history/undo integration, tests.

- [ ] Write tests for source-only/managed PDF, source/PDF/extensionless references, multiple files, conflicts, external edits, symlinks, identity/ownership migration, ignore migration, complete Undo, interruption recovery, and Smart Convert after rename.
- [ ] Validate basename and immutable extension, project boundaries, all expected source/TeX/PDF/config fingerprints, settled journal, and absent destination before mutation.
- [ ] Persist durable transaction data and backups, move source/PDF without overwrite, apply verified reverse-offset TeX edits, migrate journal/ignore, and rescan. Roll back all owned changes on failure; recover interrupted work before scanning. Never overwrite unrelated external changes.
- [ ] Add rename history and reverse-order safe Undo, preserving older conversion Undo metadata.
- [ ] Return old/new image IDs plus the rescanned Project. Commit independently after review.

## Unit 3: Explicit conversion intent

Files: `models.rs`, `workspace.rs`, `commands.rs`, `tests/manual_conversion.rs`.

- [ ] Write tests that reconvert bypasses cache, includes completed and explicitly ignored images without clearing ignore, respects pending-reference/ownership/symlink/journal protection, and leaves Smart Convert pending-only.
- [ ] Add `ConversionIntent::{Pending,Selected,Reconvert}` to the request boundary without changing existing engine conversion option serialization.
- [ ] Reuse grouped managed destinations and existing conversion transactions. Only an explicit manual intent bypasses cache reuse; it never bypasses file safety.
- [ ] Expose Rust-owned convertible IDs independently of NextAction. Commit after integration review.

## Unit 4: UI integration

Files: `AssetList.tsx`, `AssetPreview.tsx`, `CommandBar.tsx`, `ConversionHistory.tsx`, `App.tsx`, `types.ts`, CSS, frontend tests.

- [ ] Add correct ignore menus and secondary semantics; retain the ignored filter and manual-once action.
- [ ] Add one inline rename state shared by filename double-click, F2, and menu. Select basename on entry, keep extension fixed, Enter submit, Escape/blur cancel, preserve edit/error on rejection.
- [ ] Migrate active/selected IDs using RenameResult, retaining search/filter/scroll/preview/divider.
- [ ] Keep conversion visible in all NextAction states; pending split action and temporary manual panel use backend candidates. At most one visual primary. Pending-reference block explains why and offers review.
- [ ] Reuse fast/normal/feedback motion tokens and reduced motion; render rename history/Undo.
- [ ] Update IPC fixtures and targeted interaction tests before integrating production flow.

## Verification and release

- [ ] Local only: `npm run check --prefix desktop`, `git diff --check`, workflow/schema/script static validation. Do not run local tests, browser, cargo, builds, or packaging.
- [ ] Push coherent main checkpoint to GitHub Actions, inspect frontend/PDF/Rust/native tests and fix actual regressions without weakening coverage.
- [ ] Run manual remote UI review with new ignore/rename/manual states; inspect exported screenshots.
- [ ] Preserve existing four-platform matrix and Apple Developer ID signing/notarization; verify final release points to final main and contains installers/checksums.
