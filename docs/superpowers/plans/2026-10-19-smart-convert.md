# Texgo background workflow implementation plan

Goal: Extend the existing workbench with session ignore, aligned comparison, persistent settings, and Rust-owned background conversion.
Architecture: Retain Workspace, transaction preflight, journal and the existing React workbench. Native preferences and desktop integrations live in Rust; React configures and renders the current workspace.
Tech stack: Tauri 2, Rust, React, existing shadcn primitives, Vitest.

1. Session ignore and review safety
   - Add regression tests for ignored counts/filtering and primary review priority.
   - Keep ignored IDs in the Workspace session (never TeX); expose a command and share with Smart Convert.
   - Guard conversion before journal.begin; advanced bypass must put mixed reference changes in a separate reference-only batch.
   - Verify focused Vitest/Rust tests and commit.
2. Comparison
   - Test pointer drag, reset, contextual keyboard controls and stale preview responses.
   - Render PDF page one in a shared source-aspect frame; both layers fill the identical frame. Clip PDF without independent fit/zoom/pan.
   - Verify preview tests and commit.
3. Settings
   - Test defaults, validation and atomic persistence in app config.
   - Add sidebar settings page, startup/close behavior, general/conversion/notification/shortcut fields; retain per-workspace inspector choices.
   - Rename high-quality preset and default to balanced. Verify typecheck/tests and commit.
4. Background desktop integration
   - Test native shortcut replacement/rollback, Smart Convert outcomes and notification destination mapping.
   - Register Tauri plugins in desktop-only feature. Trigger Smart Convert from Rust with one mutation gate; retain independent preview snapshots and per-image events.
   - Refresh workspace before selecting only managed changed images; never apply references automatically. Preserve the managed output directory of each image.
   - Send shared outcome notifications; notification clicks alone show/focus and route to stored workspace/batch/problem. Add tray open/convert/quit for hidden window access.
   - Verify npm check/test/test:pdf, Rust tests and desktop build as requested; inspect rendered UI, document platform limits and commit.

User override (2026-10-19): do not run tests or compilation locally. Local edits and static no-emit checks only; tests/builds run on CI.

CI checks: use npm run check, npm test, npm run test:pdf; cargo test --no-default-features, cargo test, cargo build. Cross-platform compilation requires corresponding runners; preserve the existing CI matrix and extend checks there.


Implementation checkpoint: all four units are committed locally. Independent static review found stale success retention and failed Smart retry problems; fixes and regression tests are included in the follow-up commit. TypeScript no-emit checking passes. Local testing/compilation stopped at the user's override. Remote CI is prepared but pushing the feature branch was rejected by automatic approval review pending explicit human authorization. Cargo.lock resolution and platform validation remain pending CI; no full-completion claim is made.
