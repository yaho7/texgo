# Native Workspace Observation Implementation Plan

> For agentic workers: implement each unit with subagent-driven-development and independent specification/code review. Start production changes only after Phase 2 checks pass.

**Goal:** Replace frequent frontend metadata polling with native events, 500 ms debounce and a low-frequency safety fallback.

**Architecture:** A Rust watcher supplies invalidation signals; existing Workspace scanning and file locks remain authoritative. Frontend events pass through the same deferred reconciliation path as background operations, preserving active decisions and browsing context.

**Tech Stack:** Rust notify 8, existing Tauri 2 events, Workspace metadata snapshots and React domain hooks.

## Unit 1: Event policy and internal writes

Files: new `desktop/src-tauri/src/watcher/`, `observation.rs`, `workspace.rs`, native unit/integration tests.

- [x] Add tests before implementation for source image edits, TeX edits, deletion/rename, 500 ms trailing debounce, burst coalescing and event overflow requiring rescan.
- [x] Treat external managed-PDF edits as relevant. Never exclude an entire output directory merely because Texgo writes PDFs there. Same-size/same-timestamp external PDF edits are tested through native invalidation.
- [x] Ignore backup/log churn beneath `.texgo`; external configuration, ignore and mapping changes still require verification. Use a retained directory capability and per-component no-follow opens; controlled leaf/ancestor/root replacement regressions demonstrated red→green.
- [x] Record the paths and expected fingerprints of internal writes. Suppression applies only if the actual file matches the recorded write; concurrent external edits remain dirty. Do not suppress all events during a time window.
- [x] Keep the existing bounded snapshot traversal as fallback. Refreshing the observation baseline must not absorb an unscanned external source edit made during conversion. Exact SVG dependency paths remain tracked regardless of extension.
- [x] Run focused native tests and existing rename/ignore/Undo regressions. Policy and lifecycle are delivered as one coherent watcher feature after review.

## Unit 2: Native lifecycle and fallback

Files: watcher runtime, `commands.rs`, `lib.rs`, `Cargo.toml`, `Cargo.lock`, desktop tests.

- [x] Add notify with native backends; configure recursive observation without following symlinks where supported.
- [x] Start/replace observation on project identity changes; release the old watcher on close, auto-detect disable and shutdown. Include workspace identity/generation in dispatch.
- [x] Debounce in Rust, queue invalidation while a mutation holds Workspace ownership, and reconcile afterward. Keep the existing single worker/project-lock ordering and independent preview snapshot. Publish while the Workspace mutex still serializes mutations; controlled P1/P2 interleaving regression demonstrated red→green.
- [x] On initialization failure, permission/network-filesystem errors or event loss, retain a 30-second bounded metadata fallback. Retry native initialization without noisy repeated alerts.
- [x] Use generic user-facing change/unavailable notices. Detailed watcher causes belong in logs, not routine dialogs.
- [x] Verify default desktop and headless feature builds; desktop-only dependencies must not break the CLI.

## Unit 3: Frontend reconciliation and evidence

Files: relevant background/workspace event hooks, workflow tests, `docs/background-workflow.md`, `docs/api.md`.

- [x] Route watcher invalidation through the established business-decision/operation gate. Re-read current native state after deferred work instead of applying an old event snapshot. Buffer one early native update until the current asynchronous identity read resolves.
- [x] Replace the 2.5-second foreground polling interval with native-driven refresh plus low-frequency fallback. Retain focus verification and retry backoff.
- [x] Test project switches, hidden/restored windows, active review and internal PDF writes. Bursts coalesce once; known internal writes do not invalidate the metadata baseline. Hidden rerenders and in-flight responses wait for restored visibility.
- [x] Run TypeScript, frontend, PDF and both Rust feature suites. Results: 191 frontend tests, one PDF test, production build, 239 desktop Rust tests and 248 headless Rust tests. Real macOS native source-save smoke passed outside the sandbox; Windows/Linux runtime verification remains pending.
- [x] Update observation documentation and complete independent specification/code-quality review. Both reviews passed after fixing visibility, anchored-read and publication races.
- [ ] Commit the complete lifecycle integration.

## Primary references checked

- [notify configuration](https://docs.rs/notify/latest/notify/struct.Config.html): recursive symlink following is enabled by default for supported backends, so disable it explicitly.
- [notify event loss](https://docs.rs/notify/latest/notify/struct.Event.html): `need_rescan()` invalidates assumptions about the event paths.

The plan does not authorize weaker file safety or an incremental TeX parser. All writes continue through the existing transaction services.
