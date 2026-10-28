# macOS-style UI acceptance · 2026-10-28

The latest user direction permits departing from the screenshot. `frontend-design` guided
system typography, cool neutral chrome, blue selection and primary action, compact file
metadata and an independent inspector. The implementation remains Tauri/React/Tailwind;
macOS window buttons are supplied by the operating system. shadcn was removed in `146d918`.

## Completed

- `845e648`: document toolbar search; all/pending/problem/completed/ignored sidebar filters;
  filename, format, size and status columns; selected-file inspector; reference grouping by
  full file path with original line numbers; actual PDF output path. Existing source file
  actions, pagination and business hooks are retained.
- Preferences use labeled rows inside six native-style groups. The single save action stays
  in a sticky header and submits the associated form explicitly. History has a bounded
  reading width while preserving pagination and expanded entries.
- No fake navigation/view controls, generated thumbnails, extra filesystem commands,
  simulated operating-system window buttons or background source-writing behavior.

## Verification

- TypeScript check, all 288 frontend tests, installed PDF engine rendering test and Vite
  production build passed. Native backend code did not change, so native suites were not
  repeated for this UI-only unit. No LaTeX compilation verification was added or run.
- Real browser rendering used deterministic native-command fixtures at 1280×850 and
  960×640. Fixture paths and output content are demonstration data, not real project writes.
- Checked Home, completed workspace, native grouped settings, history, empty pending filter,
  navigation drawer, original preview, expanded references and Pending Review.
- Fixed drawer centering caused by inherited dialog translation. Verified the drawer
  remains inside the viewport and the Settings entry is visible at minimum desktop height.
- Inline rename retained focus and full basename selection; measured row height stayed
  57 px both before and during editing. Escape cancelled editing without saving.
- Fixed focus-driven outer-document scrolling by clipping the fixed desktop root. Keyboard
  navigation to Advanced settings now leaves both document/root scroll offsets at zero;
  the settings page scrolls independently and its save header stays at y=68 px.
- At minimum window size, the review file summary, external-editor save reminder and
  explicit Apply button remained visible. No Apply action was invoked during visual QA.
- Reduced-motion CSS and existing motion tests were reviewed. Browser OS preference
  emulation was unavailable; no claim of visual testing under an emulated OS preference.
- The pre-existing edits to `desktop/src/styles.css` and `desktop/scripts/review-ui.mjs`
  remain user-owned and unstaged. The 24 px editor/preview target behavior is preserved.

## Practical limits

These are browser presentation checks, not installed-app tests on Windows, Linux or macOS.
Native updater/release work and the broader documentation audit remain separate phases.
The existing optimistic concurrency and external-editor dirty-buffer safeguards are unchanged.


## Latest user correction: compact metadata and larger thumbnail rows

The final library displays basename, format, size, status and a separate more-menu column.
The status header and badges align to the right. There are no row subtitles or resolution column. Resolution appears once, in the right
inspector; filename and source format are not repeated there. Rows are fixed at 72 px, with
56×48 px image windows. Rename validation is positioned outside the row flow.

Thumbnails use actual decoded source content. PNG/raster and SVG output is bounded to
120 px; a PDF renders only its first page. Only current-page jobs are queued, with two active
loads and 64 retained PNG results. Project/revision keys prevent stale responses from replacing
current thumbnails. Oversized, changed, missing or unsupported images retain a file icon.

Native tests cover pixel content, size, source-file preservation, PDF read limits, project/ID
ownership, root/source symlinks and SVG external/embedded resource handling. Frontend tests
cover queue cancellation, cache bounds, current-page loading, stale-project responses, metadata
placement and separate status/menu cells. Browser fixture includes an actual PDF document for
PDF thumbnail rendering. Browser fixture images are synthetic test inputs; native pixel tests
independently verify real source decoding.


Final follow-up checks: 296 frontend tests, 280 desktop tests and 289 headless tests passed.
After avoiding whole-workspace copies during thumbnail capture, the five focused native
thumbnail tests passed again. Production build and installed PDF renderer test passed.
Browser rendering confirmed an actual PDF first-page thumbnail, no console errors, right
alignment for both status header and badges, and 72 px height for all 18 fixture rows even
while a rename validation error is visible. Native reads/decoding occur outside the preview
mutex after capturing only a validated source capability; no TeX source text is cloned for
individual thumbnail requests.
