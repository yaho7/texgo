# Workspace UX implementation plan

Approved scope: Phase 4 of the product upgrade design. Keep existing neutral tokens,
pagination, Rust-owned eligibility and transaction boundaries. Phases 5 and 8 are cancelled.
Each unit receives specification and quality review, focused verification and a scoped
commit before the next implementation starts. Preserve pre-existing styles/review-script edits.

1. Command Bar: one recommended primary action, one settings Popover, a shared four-choice
   conversion dropdown (pending split button permitted), guarded manual entry, progress and
   completion in the status area. Verify typecheck, workflow/Command Bar tests, PDF and build.
2. Preview: original/PDF/comparison modes and Space cycle; keep divider arrows, Shift, 0,
   double-click reset and focus guards. Add fit/100% controls with no default source upscale,
   shared comparison geometry, and loading/error retention. Verify preview/PDF regressions.
3. Asset actions: shared list/context-menu actions, platform reveal and copy-path commands;
   resolve owned image IDs in Rust and retain path safety. Preserve rename/ignore semantics.
   Verify menu routing, invalid paths and native feature builds.
4. Home and project overview: concise purpose/open/drop copy, recent project names, directories
   and relative times, four authoritative health counts, keyboard/ARIA/reduced-motion review.
   Verify presentation, pagination and full frontend/native suites before completing Phase 4.

## Progress

- [x] Command Bar reviewed and verified: TypeScript, 201 frontend tests, PDF test and
  production build passed. Specification and quality reviews approved after adding menu
  lifecycle regressions for busy/conversion/completion/selection transitions. Scoped commit
  includes this plan and the Phase 3 commit record.
- [ ] Three-mode preview reviewed, verified and committed.
- [ ] Asset actions reviewed, verified and committed.
- [ ] Home/health/accessibility reviewed, verified and committed.
