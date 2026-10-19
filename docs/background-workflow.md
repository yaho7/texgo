# Smart Convert and application preferences

The existing Workspace/Journal/Transaction pipeline remains the authority for conversion and recovery. No conversion algorithm or journal version has changed.

## User workflow

- Problem rows offer a more menu for repair/details, locate (missing/ambiguous), and ignore for this session. Ignored rows remain in All, have an explicit badge and count, and can be filtered or restored. Ignore never writes TeX or project metadata. Workspace keeps the session ID set so native Smart Convert respects the same exclusions.
- Comparison clips a PDF layer over the original. Both layers fill one source-aspect frame at the same center. PDF page one has no independent fit controls in comparison mode. Space toggles comparison within the preview, arrows move the divider by 1%, Shift arrows by 10%, 0/double click resets 50%, and Escape exits comparison.
- Settings is a separate page at the bottom of the sidebar. Inspector output settings remain per workspace, compact and collapsed. Default presets are balanced (300/90), high quality (300/100), small (150/75), and custom.
- By default a conversion with pending reference edits must be reviewed before another UI or Smart Convert batch can begin. Rust rechecks after refreshing. TeX edits still require a complete freshly verified preview and an explicit selection.
- Advanced users can allow unreviewed conversions. If reviewed edits do not all belong to the latest conversion batch, a separate reference-only batch owns those edits. This retains unambiguous undo ordering instead of attaching mixed edits to the newest conversion.

## Native data

- `preferences::Preferences`: general, conversion defaults, notification switches, shortcut and close behavior. Serde defaults allow old/partial preference files to acquire new defaults. Invalid values fail validation before replacing the saved file.
- `Workspace.ignored`: in-memory IDs, copied through refresh, reset when opening another workspace. Not serialized to `.tex` or `.texgo`.
- `SmartReport`: refreshed Project, ordinary ConversionResult, created batch IDs, problem IDs and pending reference count. This carries existing state back to React instead of maintaining a parallel conversion store.
- `background::NotificationTarget`: workspace mode/path, recursion, destination view, exact batch ID and optional image ID. Stored in each notification's extra payload so clicks on older notifications keep their original destination.
- `Notice`: shared title/body outcome policy for UI and Smart Convert.

## Shortcut lifecycle

The desktop-only `tauri-plugin-global-shortcut` plugin registers after native preferences are loaded. The default is `CommandOrControl+Alt+Enter` (Cmd Option Enter on macOS, Ctrl Alt Enter elsewhere).

A shortcut must parse and include the primary modifier and Alt/Option to reserve a different namespace from application commands. On a settings change the registrar:

1. Normalizes the shortcut; an unchanged registration is a no-op.
2. Unregisters the previous shortcut.
3. Attempts the new registration. An OS registration error is shown, and the old registration is restored.
4. Atomically saves preferences. A persistence error rolls the registration back.
5. Disabling unregisters; application exit releases all registrations.

A single pressed event spawns the Rust Smart Convert task. Released events do nothing. Availability is established by actual OS registration, which reports conflicts where the OS exposes them; the plugin's own is_registered list cannot detect other applications. On Linux availability also depends on the desktop session/compositor.

## Smart Convert

The native entry point acquires the same conversion gate and uses the same worker-side Workspace lock as ordinary conversion. It refreshes sources and dependencies before examining updateAvailable. It excludes ignored and non-ready images and converts only changed managed sources, leaving new/unmanaged images for explicit UI selection. Managed output modifications, missing/ambiguous/unsupported sources and pending reference edits are reported without guessing.

Each selected source is mapped back to its preferred valid managed PDF. Images are grouped by the original output directory; each group goes through the existing convert_with_results pipeline with default DPI/quality. This preserves output-conflict checks, source hashes, per-file progress/results, the journal, backups and unified undo. Different output directories create separate journal entries; notifications identify the failing batch if a group failed. No references are applied automatically.

React receives background-start, existing conversion-progress/result events, background-finished and background-idle. Existing read snapshots/completed previews permit browsing and comparison while the worker owns the mutation lock. The native task never shows or focuses the window.

## Notifications and background lifecycle

The desktop-only `tauri-plugin-notification` 2.7 adapter is shared by UI and Smart Convert. Success defaults on, failure on, unchanged off. Cancelled operations do not produce success notices. Problem notices point to repair/review, result notices to the corresponding conversion record. The notification action handler is installed once before any notification is emitted. Only a click shows, unminimizes and focuses the window, refreshes the target workspace and emits notification-navigate.

The plugin uses native notifications on macOS, Windows and Linux. Platform delivery and focus behavior still depend on OS permissions and notification preferences. Windows supports installed applications; click callbacks are reported while the toast is visible, not after it moves to Action Center. macOS and Linux use the action support supplied by the system notification server. See the [official notification API](https://v2.tauri.app/plugin/notification/) and [Rust desktop behavior](https://docs.rs/tauri-plugin-notification/latest/tauri_plugin_notification/struct.Notification.html).

Close-to-background prevents window destruction and hides it. A minimal tray provides Smart Convert, Open Texgo and Exit. Quit from the native menu/tray and the explicit completely-exit setting terminate normally. The macOS Dock reopen action shows the existing window.

## Persistence

Rust writes `preferences.json` under Tauri app_config_dir, using the existing atomic save helper. This is app configuration, not project configuration. Recent workspaces and per-workspace inspector choices retain their existing bounded localStorage format. Startup restoration reads the most recent workspace through the same open command; default global conversion values apply to workspaces without inspector overrides.

## Verification

Added coverage includes session ignore/restore/filter/no-TeX-write, reference priority and advanced-bypass independent undo, overlay pointer/reset/contextual keys, settings save/failure and Rust persistence/migration/validation, shortcut register/change/disable/no-op/rollback, Smart Convert changed/unchanged/ignored/partial failure/conflict protection, shared success/failure notifications and notification batch/problem routing. Existing tests continue to cover conversion-time browsing, manual edit protection, output conflicts and batch recovery.

Per user instruction, local tests and builds are disabled. Local no-emit TypeScript checking and diff inspection are permitted. The Desktop GitHub workflow now runs frontend checks/tests/PDF tests, Rust engine tests, then native desktop tests and installer compilation for Windows, Linux and macOS (arm64 and x64). Cargo.lock was resolved on CI and committed; CI validates it with --locked and passes the same lock to each platform runner. Feature branches upload artifacts but do not publish a Release. Cross-platform checks and live native notification/hotkey behavior must be confirmed after CI and installed-app testing; static checks alone do not establish those results.


CLI compatibility: the automated pipeline may refresh a valid managed PDF already referenced at exactly the same destination while retaining a standalone TeX recovery record. A separate restricted entry point validates record ownership/version and every recorded TeX after-hash under the project lock. New destinations, unreviewed reference targets, edited or partially restored TeX are rejected. The ordinary GUI/Workspace conversion entry point and Journal.begin retain the strict legacy-record guard. The existing CLI idempotency regression and a new rejection regression cover this compatibility path.
