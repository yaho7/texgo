# Project maintenance, Smart Convert and preferences

Texgo only opens LaTeX projects. The existing Workspace/Journal/Transaction pipeline remains authoritative for conversion, reference writes and recovery. The independent image-directory mode and its GUI, CLI and RPC entry points have been removed; the recursive scanner still supports project discovery and safety checks.

## One project status

Rust maintains `Project.status: WorkspaceStatus`: pending image/reference counts, problem/ignored/completed/total counts, their image IDs, a `NextAction`, and an optional safety blocker. The window, Smart Convert, tray tooltip and notification destination use this snapshot. React presents it instead of independently deriving the next action from selection or conversion results.

The action priority is reference review → update pending images → resolve problems → up to date. Ignored assets remain visible in All and can be restored; they are excluded from tasks and reference plans. Missing, ambiguous and unsupported assets are ordinary problems. Externally modified PDFs, inconsistent recovery records and unsafe writes are blockers.

## User workflow

Open or drop `main.tex`. The sidebar contains project images, operation records, recent projects and settings. There is no Home navigation for an open project. Only the explicit project-menu action closes the native Workspace; changing pages does not interrupt background work.

The fixed command bar is the only primary action area. It updates every pending image by default. “Select some images” temporarily enables checkboxes and a visible selection count; Escape exits that mode without clearing search/filter. Three parameter presets live in a popover: balanced 300/90, high quality 300/100, small 150/75. Editing values implies custom settings.

The inspector belongs to the selected image. It contains the source/PDF overlay (source left, PDF right), dimensions and size, reference-location popover, status and explicit repair/locate/ignore actions. Clicking a problem row only selects it. A failed image can be marked for a safe retry after its cause is fixed; retry never bypasses output ownership checks.

New PDF paths automatically open selective reference review after the brief completion feedback. Updating an already referenced PDF at the same path does not open review. Applying a reviewed selection always revalidates the complete preview against the current files. Undo jointly validates and restores reference edits and PDFs; user edits stop recovery rather than being overwritten.

Refreshing, applying references, background conversion and switching sidebar pages preserve active image, filter, search, scroll, preview mode/divider and sidebar width/state. Only disappearance of an image chooses a fallback. Background observation is quiet; change notices clear after a few seconds.

## Shared conversion and background state

React's `useOperation` owns a typed idle/running state with a unique lease token and a foreground/background owner. Acquisition is synchronous, so two callbacks in one render cannot start competing operations. Completion releases only the lease it acquired; a background idle event cannot clear a foreground conversion or rename. The operation kind still drives the existing progress labels. Review decisions and workspace reconciliation are separate domains and must retain their original preview and project identity checks.

GUI and Smart Convert call the same pending-image update method. New sources use the requested output folder; existing managed sources update their original preferred output. Groups retain existing conversion safety checks and aggregate progress across destinations. Output writes, hashes, backups, cancellation, source/dependency validation and Undo continue through the original pipeline. No TeX references are applied automatically by background conversion.

React receives `background-start`, per-image conversion progress/results, `background-finished`, error recovery snapshots and `background-idle`. These events reconcile the foreground status even when automatic file observation is disabled. Notifications and the command bar therefore describe the same remaining work. Only notification clicks reveal/focus the window; background conversion does not.

Operation records describe updated images and LaTeX references; technical settings and file-level details are folded away. Reference-only operations do not show zero images or irrelevant DPI values. Internal journal identifiers remain opaque implementation details.

## Preferences and shortcuts

Rust atomically saves `preferences.json` in Tauri's `app_config_dir`. Serde defaults support older partial files and ignore the retired recursive/after-conversion fields. Recent-project migration removes directory workspaces while retaining `.tex` projects and per-project output settings.

Settings groups are general, conversion, background/notifications, shortcuts and advanced. Reference safety bypass belongs to advanced settings with a risk explanation; it never disables file ownership or recovery validation. Saving shows inline progress/success/errors.

The default global shortcut is `CommandOrControl+Alt+Enter`. The recorder displays platform key tokens, accepts a primary modifier plus Alt/Option and a key, and supports Escape cancellation. It awaits a transient native recording guard before accepting keys; the old global shortcut cannot start a conversion during recording. Completion, cancellation, blur and unmount release the guard.

Registration normalizes and validates the shortcut, restores the previous registration on a conflict, and rolls it back if saving preferences fails. The native notification/global-shortcut plugins remain desktop-only. Delivery and hotkey support depend on OS permissions and desktop session; installed Windows notification click support is limited to visible toasts. Closing to background keeps the Workspace and tray alive; explicit Quit terminates normally.

## Motion and validation

CSS defines shared fast/normal/slow/feedback durations and standard/out easing. Page changes use small vertical fades, the command bar crossfades departing/entering states without a second primary button, badges/backgrounds communicate result changes, and preview frames retain the old image until the next is ready. Divider dragging stays immediate; reset uses the shared easing. Reduced motion removes spatial animation, delays and continuous spinners while retaining short opacity feedback.

Local tests and compilation are enabled by the current product-upgrade request. See [local setup and verification](development.md) for generated icon/sidecar prerequisites. GitHub Actions runs frontend/PDF/Rust tests followed by four native package targets. Apple Developer ID signing and notarization stay in the existing shared macOS build step. Passing CI does not establish actual installed-app permissions or delivery on every desktop.

The headless pipeline retains the restricted compatibility path for restoring/updating a valid managed destination under an existing standalone recovery record. It still validates record ownership/version and all TeX after-hashes under the project lock; new destinations and changed TeX are rejected.
