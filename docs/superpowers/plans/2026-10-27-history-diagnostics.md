# History and diagnostics implementation plan

Approved scope: Phase 6. Preserve transaction/Undo preflight, explicit reference review,
shortcut rollback and headless protocol compatibility. Do not add LaTeX verification.

## Unit 1: Operation timeline and recoverable errors

- Distinguish conversion, applied references and rename with readable summaries and calendar
  time, retaining expanded-file pagination and specific native Undo reasons.
- Use actual rename metadata for PDF counts and permanent-ignore migration. New persisted
  fields have serde defaults; older records must deserialize without invented migration claims.
- Keep ordinary errors inline with useful recovery guidance and expandable original details.
  Safety blocks continue to disable unsafe mutations; routine failures do not become modals.
- Keep App orchestration small. Any lazy presentation boundary must retain existing browsing,
  focus and review ownership behavior, with an accessible loading state.
- Verify timeline/Undo/old-record and error regressions, frontend/PDF/build and both Rust modes.

## Unit 2: Settings and structured logs

- Group settings as General, Conversion, Automation, Notifications, Shortcuts and Advanced.
  Closing behavior belongs in General. Preserve recording guards, registration rollback,
  validation and persisted defaults for existing preference files.
- Add a debug-log preference and a command opening only the trusted application log directory.
  Default production logging is warn/error; debug is explicit and takes effect after save.
- Log structured category/event/level/time and bounded operational counts for workspace,
  scanner, conversion, journal, watcher, automation and notification. Do not log document,
  image or reference contents, RPC payloads, credentials or signing material.
- Bound and rotate log files; logger/service failures must not prevent opening the app or
  overwrite unrelated files. Test filtering, rotation, serialization, old preferences and
  failure behavior using temporary directories and fake OS ports.
- Verify focused and full frontend/native checks, inspect the scoped diff, obtain independent
  specification and quality review, and commit before moving to release work.

## Progress

- [x] Timeline/errors reviewed and verified: TypeScript, 267 frontend tests, PDF test,
  production build and both native feature suites passed. Both independent reviews approved
  after fixing English I/O errors containing Chinese path keywords. Old rename metadata and
  journal Undo compatibility are covered; existing transactions remain intact. Main bundle
  510.01 kB retains Vite's standard size warning. Priority reference-review concurrency and
  external-editor safety follow in their own unit before settings/logging.
- [x] Settings/logging reviewed and verified: TypeScript, 279 frontend tests, PDF test,
  production build and both Rust modes passed. Specification and quality reviews approved
  after fixing nonregular/FIFO log leaves and protecting the current log across clock
  rollback. Logs use typed content-free records with bounded files and optional I/O failure.
  Debug activation follows successful preference persistence and shortcut replacement.
  Secondary views load on demand and retain history state; main bundle fell from 512.32 kB
  to 497.57 kB without raising the warning threshold. Optional native service failures no
  longer abort setup. Native Linux/Windows service behavior still needs platform QA.
