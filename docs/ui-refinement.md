# Finder-style UI refinement — 2026-10-29

Texgo uses a quiet light-mode document workspace, with a solid `#EEECEE` sidebar
and white main panes. Radius values are Texgo design tokens, not fixed Apple specifications.

| Before | After | Why |
| --- | --- | --- |
| Blue library selection and unrelated navigation grays | `--selection-bg: #DCDCDC` with dark text | One selection language across Library, Sidebar and History |
| Flush rows and square selection | 6 px horizontal inset, 3 px row gap, 6 px corners | Separate adjacent selected rows while preserving desktop density |
| Programmatic history highlight only | Mouse/keyboard selection independent of disclosure | Selecting a record does not expand details or invoke Undo |
| Ad hoc component corners | Selection 6 px, controls 8 px, viewer 10 px, floating surfaces 12 px | Distinct roles with consistent concentric corners |
| Rounded image/PDF content on a darker viewer | `#E6E6E6` viewer, 10 px outer corners, square content | Separate the viewing surface from the document itself |

Small inline controls use the 5 px token; compact buttons and active segments use
6 px. Segmented containers use 8 px with 2 px padding. Menu containers use 12 px
with 6 px padding around 6 px entries. Status colors and keyboard focus rings remain
independent of ordinary selection. The current product officially uses light mode.

## Verification

Local example-data screenshots were inspected at 1440×900, 1280×800 and 1100×700.
Checks included adjacent multi-selection, stable selection while hovered, keyboard
focus, History selection without disclosure, original/PDF/compare previews, Settings,
menus and an unconfirmed Undo dialog. Measurements confirmed:

- Library, Sidebar and History selection: `rgb(220, 220, 220)`.
- Library row height 72 px, gap 3 px, horizontal inset 6 px, end corners 6 px.
- Input/Select 8 px; segmented container 8 px and segment 6 px.
- Menu/Dialog 12 px; ordinary dialog buttons 8 px.
- Viewer `rgb(230, 230, 230)` with 10 px corners; image, comparison frame and PDF canvas 0 px.
- Tab focus retains a separate 2 px blue ring while selection stays gray.

97 focused tests passed across presentation, asset actions, history, controls and
preview components. TypeScript, 720 bilingual messages, the production frontend build,
14 release-policy/signature checks and workflow lint also passed. Full native and
LaTeX compilation test suites were not repeated for this presentation-only round.

The README screenshots use example project data. Browser screenshots do not verify
native macOS traffic-light placement, window dragging, or installed-app updates.
Those still require installed-platform acceptance after packaging.

This round does not change scanner, conversion, watcher decisions, reference-write
fingerprints, transaction/journal, Undo or rename semantics. History selection is local UI state.
