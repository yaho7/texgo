# Safety and App Architecture Implementation Plan

> For agentic workers: use subagent-driven-development for each bounded implementation unit, followed by specification and code review.

**Goal:** Establish the existing safety baseline, then separate App responsibilities without changing file-operation semantics.

**Architecture:** Rust Workspace remains authoritative. React hooks own one domain each and share a typed operation coordinator; operation ownership prevents late completions from clearing newer work. Existing review previews and backend safety checks remain intact.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Tauri 2, Rust.

The approved overall design is `docs/superpowers/specs/2026-10-26-product-upgrade-design.md`. This plan covers the first two phases; later phases receive bounded implementation plans after these boundaries exist.

## Unit 1: Baseline and regression inventory

- [x] Preserve pre-existing `desktop/src/styles.css` and `desktop/scripts/review-ui.mjs` changes.
- [x] Run `npm run check`, `npm test`, `npm run test:pdf`; initial results: 145 frontend tests and one PDF test pass.
- [x] Run `cargo test --locked --no-default-features --features automation`: 209 passed.
- [x] Build the native sidecar with `cargo build --locked --no-default-features --features automation --bin texgo-engine`, stage it in ignored `binaries/texgo-engine-aarch64-apple-darwin`, generate icons with `npm exec tauri icon app-icon.svg`, then run `cargo test --locked`: 197 passed.
- [x] Record counts and platform limits in the design baseline. Desktop baseline initially requires the packaged sidecar; do not create a fake executable to bypass this requirement.
- [x] Independently review scanner/transaction/journal/rename/ignore/repair invariants and existing regression coverage before production edits. Joint TeX/PDF preflight, original review snapshots, LIFO Undo, ignore identities, preview disposal and mounted list context are preserved boundaries.

## Unit 2: Domain ownership and operation arbitration

Files: `desktop/src/App.tsx`, new `desktop/src/state/operationMachine.ts`, new `desktop/src/hooks/useOperation.ts`, `desktop/tests/operation.test.tsx`.

- [x] Add focused tests proving a second operation cannot acquire an occupied coordinator, stale completion cannot release a newer lease, failure releases the owning lease, and background work cannot claim foreground ownership.
- [x] Run the focused test before implementation and confirm the missing coordinator failure. Foreground conversion regression also failed before integration because background idle removed the cancel action.
- [x] Implement an explicit idle/running discriminated union with an operation token and owner (`foreground` / `background`). Keep the current operation label vocabulary during extraction; rename labels only once callers are migrated.
- [x] Integrate acquisition/release in execute, rename and background handlers. Eliminate direct independent writes to state/ref pairs. Dialog state remains a separate migration unit.
- [x] Run `npm run check` and `npm test`; inspect cancellation, background, review, rename and focus regressions. Parent independently verified 151 frontend tests and one PDF test; specification review passed.
- [x] Commit only this unit with `refactor: centralize operation ownership` (`3e3e212`).

## Unit 3: Workspace, selection and history

Files: `App.tsx`, `hooks/useWorkspace.ts`, `hooks/useAssetSelection.ts`, `hooks/useHistory.ts`, existing workflow tests plus focused hook tests.

- [x] Retain existing open/refresh/ignore/rename regression tests; add delayed old history response and workspace switch tests before extraction.
- [x] Move project acceptance, settings/recents restoration and snapshot identity into `useWorkspace`; expose semantic actions rather than the entire setter set.
- [x] Move selection/search/filter and ID migration into `useAssetSelection`; preserve surviving selections, keep ignore behavior and reset only on actual project change.
- [x] Move guarded history loading and Undo into `useHistory`; retain rename identity restoration and partial failure refresh. Guard stale successful and failed refreshes, Undo and nested recovery across A→B→A sessions.
- [x] Run frontend static and workflow checks, inspect all native invoke arguments for unchanged safety contracts. Independent specification and code-quality reviews passed; parent verified TypeScript, 165 frontend tests and one PDF test.
- [x] Commit the coherent workspace/selection/history extraction (`4da7b26`).

## Unit 4: Conversion, review and native adapters

Files: `App.tsx`, `hooks/useConversion.ts`, `hooks/useReviewFlow.ts`, `hooks/useDesktopEvents.ts`, `hooks/useBackgroundAutomation.ts`, `hooks/useAppShortcuts.ts`.

- [x] Preserve existing conversion tests for pending/selected/reconvert/cancel/retry, same-path output and partial review.
- [x] Add dialog shortcut and late native subscription cleanup tests; demonstrate failures for any new corrected behavior before its implementation. Additional regressions cover review selection retention, stale background completion/errors, unmounted conversion, cross-project notification targets, transient overlays, A→B→A and StrictMode lifetimes.
- [x] Extract conversion ownership, event subscription lifetime, cancellation and result recovery without changing engine options.
- [x] Extract review/repair state as a discriminated union retaining the complete reviewed snapshot. Applying or undoing transitions only from permitted business states.
- [x] Extract desktop listeners and shortcut dispatch, sharing a single overlay/operation eligibility policy. Queue background snapshots while foreground decisions are active.
- [x] Keep App limited to page/layout/dialog composition and hook connection; do not replace it with another monolithic hook. App is 328 lines; each new workflow hook is under 200 lines.
- [x] Run all frontend/PDF/Rust checks, update `docs/background-workflow.md`, inspect conditional native behavior. Parent verified TypeScript, 182 frontend tests, one PDF test, production frontend build, 197 desktop Rust tests and 209 headless Rust tests. No Rust/platform conditional code changed in this phase. Specification and quality reviews passed after fixing delayed background errors and overlay focus.
- [x] Commit remaining workflow/event/decision extraction (`acd29cc`).

## Phase completion evidence

Do not mark Phase 1 or 2 complete until their unchecked items above have actual verification. Record unavailable native platform checks separately. Start watcher implementation only after frontend ownership and regression checks pass.
