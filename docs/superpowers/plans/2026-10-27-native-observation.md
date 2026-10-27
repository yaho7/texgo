# Native Workspace Observation Implementation Plan

> For agentic workers: implement each unit with subagent-driven-development and independent specification/code review. Start production changes only after Phase 2 checks pass.

**Goal:** Replace frequent frontend metadata polling with native events, 500 ms debounce and a low-frequency safety fallback.

**Architecture:** A Rust watcher supplies invalidation signals; existing Workspace scanning and file locks remain authoritative. Frontend events pass through the same deferred reconciliation path as background operations, preserving active decisions and browsing context.

**Tech Stack:** Rust notify 8, existing Tauri 2 events, Workspace metadata snapshots and React domain hooks.

## Unit 1: Event policy and internal writes

Files: new `desktop/src-tauri/src/watcher/`, `observation.rs`, `workspace.rs`, native unit/integration tests.

- [ ] Add tests before implementation for source image edits, TeX edits, deletion/rename, 500 ms trailing debounce, burst coalescing and event overflow requiring rescan.
- [ ] Treat external managed-PDF edits as relevant. Never exclude an entire output directory merely because Texgo writes PDFs there.
- [ ] Ignore backup/log churn beneath `.texgo`; external configuration, ignore and mapping changes still require verification. Do not follow symlinks or walk outside the canonical root.
- [ ] Record the paths and expected fingerprints of internal writes. Suppression applies only if the actual file matches the recorded write; concurrent external edits remain dirty. Do not suppress all events during a time window.
- [ ] Keep the existing bounded snapshot traversal as fallback. Refreshing the observation baseline must not absorb an unscanned external source edit made during conversion.
- [ ] Run focused native tests and existing rename/ignore/Undo regressions; commit only the observation policy unit after review.

## Unit 2: Native lifecycle and fallback

Files: watcher runtime, `commands.rs`, `lib.rs`, `Cargo.toml`, `Cargo.lock`, desktop tests.

- [ ] Add notify with native backends; configure recursive observation without following symlinks where supported.
- [ ] Start/replace observation on project identity changes; release the old watcher on close, auto-detect disable and shutdown. Include workspace identity/generation in dispatch.
- [ ] Debounce in Rust, queue invalidation while a mutation holds Workspace ownership, and reconcile afterward. Keep the existing single worker/project-lock ordering and independent preview snapshot.
- [ ] On initialization failure, permission/network-filesystem errors or event loss, retain a 30-second bounded metadata fallback. Retry native initialization without noisy repeated alerts.
- [ ] Use generic user-facing change/unavailable notices. Detailed watcher causes belong in logs, not routine dialogs.
- [ ] Verify default desktop and headless feature builds; desktop-only dependencies must not break the CLI.

## Unit 3: Frontend reconciliation and evidence

Files: relevant background/workspace event hooks, workflow tests, `docs/background-workflow.md`, `docs/api.md`.

- [ ] Route watcher invalidation through the established business-decision/operation gate. Re-read current native state after deferred work instead of applying an old event snapshot.
- [ ] Replace the 2.5-second foreground polling interval with native-driven refresh plus low-frequency fallback. Retain focus verification and retry backoff.
- [ ] Test project switches, hidden/restored windows, active review and internal PDF writes. Assert one refresh for a rapid-save burst and no repeated loop after a completed conversion.
- [ ] Run TypeScript, frontend, PDF and both Rust feature suites. Record actual macOS native smoke evidence separately from Windows/Linux compilation and installed-app checks.
- [ ] Update observation documentation and commit the complete lifecycle integration after independent review.

## Primary references checked

- [notify configuration](https://docs.rs/notify/latest/notify/struct.Config.html): recursive symlink following is enabled by default for supported backends, so disable it explicitly.
- [notify event loss](https://docs.rs/notify/latest/notify/struct.Event.html): `need_rescan()` invalidates assumptions about the event paths.

The plan does not authorize weaker file safety or an incremental TeX parser. All writes continue through the existing transaction services.
