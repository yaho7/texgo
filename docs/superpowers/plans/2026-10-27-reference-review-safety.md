# Reference review concurrency and editor safety

User supplement: real-time detection must never mean real-time reference writes.
Deliver this priority unit before Phase 6 logging and Phase 7 release work.

1. Pin each planned target file to a fingerprint of its complete bytes. Compare it with
   freshly read disk content at confirmation, even if Workspace has since refreshed and
   the visible reference changes remain identical. Missing fingerprint data cannot authorize
   writes. Apply/repair share the same rule, retaining existing per-write validation.
2. Report pre-write review conflicts distinctly from generic or partial-operation failures.
   An outdated plan cannot be retried. Show the affected file and a rescan action; a new plan
   requires fresh explicit confirmation. Preserve workspace generation and decision ownership,
   full-plan validation before selection and transaction/Undo recovery semantics.
3. Keep watcher/poll/Smart Convert read-only for `.tex`, including indirect refresh/recovery
   paths. Managed PDF generation remains allowed. Background results retain Pending Review
   and notifications include waiting reference counts. Interrupted foreground transactions
   remain protected and require an explicit recovery path rather than background writes.
4. Add a persistent Review Dialog footer naming the selected files/counts and reminding users
   to save external editors. State the Desktop dirty-buffer limitation. Use a clear apply
   label; no extra routine warning modal is required.

Verification must cover: edits outside the reference text; refresh between plan and apply;
selected/unselected file drift before the first write; missing fingerprints; repair plans;
watcher and Smart Convert preserving `.tex` bytes; pending counts/notifications; conflict
rescan and re-confirmation; the external-editor reminder; and existing partial-write/Undo
recovery and cross-project race tests. Use focused tests first, then full frontend/PDF and
both Rust feature suites, independent specification/quality review, and a scoped commit.

- [x] Fingerprint and background safety regressions demonstrated red → green.
- [x] Review conflict/rescan and external-editor reminder implemented and verified.
- [x] Both reviews approved. Full checks passed: TypeScript, 273 frontend tests, one PDF
  engine test and production build. Native suites include deleted/symlinked reviewed main
  files and replaced roots rejected before lock creation. Reviewed conflicts preserve the
  disabled plan; later/partial failures retain operation recovery handling. Source changes
  remain excluded from watcher/Smart Convert, including pending rename recovery. Scoped
  commit follows this verification record. Vite's existing chunk-size advisory remains.
