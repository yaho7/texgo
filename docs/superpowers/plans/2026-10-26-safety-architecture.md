# Safety and App Architecture Implementation Plan

> For agentic workers: use subagent-driven-development for each bounded implementation unit, followed by specification and code review.

**Goal:** Establish the existing safety baseline, then separate App responsibilities without changing file-operation semantics.

**Architecture:** Rust Workspace remains authoritative. React hooks own one domain each and share a typed operation coordinator; operation ownership prevents late completions from clearing newer work. Existing review previews and backend safety checks remain intact.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Tauri 2, Rust.

The approved overall design is `docs/superpowers/specs/2026-10-26-product-upgrade-design.md`. This plan covers the first two phases; later phases receive bounded implementation plans after these boundaries exist.

## Unit 1: Baseline and regression inventory

- [x] Preserve pre-existing `desktop/src/styles.css` and `desktop/scripts/review-ui.mjs` changes.
- [x] Run `npm run check`, `npm test`, `npm run test:pdf`; initial results: 145 frontend tests and one PDF test pass.
- [ ] Run `cargo test --locked --no-default-features --features automation`.
- [ ] Build the native sidecar with `cargo build --locked --no-default-features --features automation --bin texgo-engine`, stage it in ignored `binaries/texgo-engine-aarch64-apple-darwin`, then run `cargo test --locked`.
- [ ] Record counts and platform limits in the design baseline. Desktop baseline initially requires the packaged sidecar; do not create a fake executable to bypass this requirement.
- [ ] Independently review scanner/transaction/journal/rename/ignore/repair invariants and existing regression coverage before production edits.

## Unit 2: Domain ownership and operation arbitration

Files: `desktop/src/App.tsx`, new `desktop/src/state/operationMachine.ts`, new `desktop/src/hooks/useOperation.ts`, `desktop/tests/operation.test.tsx`.

- [ ] Add focused tests proving a second operation cannot acquire an occupied coordinator, stale completion cannot release a newer lease, failure releases the owning lease, and background work cannot claim foreground ownership.
- [ ] Run the focused test before implementation and confirm the missing coordinator failure.
- [ ] Implement an explicit idle/running discriminated union with an operation token and owner (`foreground` / `background`). Keep the current operation label vocabulary during extraction; rename labels only once callers are migrated.
- [ ] Integrate acquisition/release in execute, rename and background handlers. Eliminate direct independent writes to state/ref pairs. Dialog state remains a separate migration unit.
- [ ] Run `npm run check` and `npm test`; inspect cancellation, background, review, rename and focus regressions.
- [ ] Commit only this unit with `refactor: centralize operation ownership`.

## Unit 3: Workspace, selection and history

Files: `App.tsx`, `hooks/useWorkspace.ts`, `hooks/useAssetSelection.ts`, `hooks/useHistory.ts`, existing workflow tests plus focused hook tests.

- [ ] Retain existing open/refresh/ignore/rename regression tests; add delayed old history response and workspace switch tests before extraction.
- [ ] Move project acceptance, settings/recents restoration and snapshot identity into `useWorkspace`; expose semantic actions rather than the entire setter set.
- [ ] Move selection/search/filter and ID migration into `useAssetSelection`; preserve surviving selections, keep ignore behavior and reset only on actual project change.
- [ ] Move guarded history loading and Undo into `useHistory`; retain rename identity restoration and partial failure refresh.
- [ ] Run frontend static and workflow checks, inspect all native invoke arguments for unchanged safety contracts, then commit the coherent extraction.

## Unit 4: Conversion, review and native adapters

Files: `App.tsx`, `hooks/useConversion.ts`, `hooks/useReviewFlow.ts`, `hooks/useDesktopEvents.ts`, `hooks/useBackgroundAutomation.ts`, `hooks/useAppShortcuts.ts`.

- [ ] Preserve existing conversion tests for pending/selected/reconvert/cancel/retry, same-path output and partial review.
- [ ] Add dialog shortcut and late native subscription cleanup tests; demonstrate failures for any new corrected behavior before its implementation.
- [ ] Extract conversion ownership, event subscription lifetime, cancellation and result recovery without changing engine options.
- [ ] Extract review/repair state as a discriminated union retaining the complete reviewed snapshot. Applying or undoing transitions only from permitted business states.
- [ ] Extract desktop listeners and shortcut dispatch, sharing a single overlay/operation eligibility policy. Queue background snapshots while foreground decisions are active.
- [ ] Keep App limited to page/layout/dialog composition and hook connection; do not replace it with another monolithic hook.
- [ ] Run all frontend/PDF/Rust checks, update `docs/background-workflow.md`, inspect conditional native behavior, and commit each coherent domain extraction.

## Phase completion evidence

Do not mark Phase 1 or 2 complete until their unchecked items above have actual verification. Record unavailable native platform checks separately. Start watcher implementation only after frontend ownership and regression checks pass.
