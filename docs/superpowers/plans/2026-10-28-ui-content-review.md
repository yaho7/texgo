# UI content and navigation review

User priority: remove repeated information on one visible screen; position Texgo around faster
LaTeX compilation rather than PDF conversion; make the top-left brand return to Home without
closing the active project. Keep already-approved thumbnail, metadata and reference safety.

## Findings before edits

- desktop/src/Home.tsx:11 — repeated brand and two overlapping purpose paragraphs; benefit is
  framed as PDF conversion rather than reducing compilation work.
- desktop/src/WorkspaceSidebar.tsx:30 — Home duplicates its open action and recent projects in
  the sidebar; brand is static instead of a Home navigation control.
- desktop/src/App.tsx:273 — toolbar repeats the brand on Home; project counts and initial scan
  notices repeat sidebar/list information. Existing navigation cannot show Home with a live
  project without closing it.
- desktop/src/AssetList.tsx:324 — footer repeats total/ignored counts already visible in sidebar.
- desktop/src/CommandBar.tsx:64 — primary copy emphasizes conversion; status/action copy repeats
  the same next-step count in several places.
- desktop/src/AssetThumbnail.tsx:7 — declare image dimensions as well as the fixed thumbnail frame.

## Design decisions

Keep the macOS palette, system type and existing layout. One Home heading (“加快 LaTeX 编译”),
one open action and one recent-project list. A collapsed “工作原理与权限” explanation is enough;
no mandatory wizard or unsolicited OS permission prompts. Explain that generating reusable PDF files before compilation reduces image handling after
the reviewed reference change. Keep the product copy direct and focused on the benefit.

Home automatically collapses the sidebar, retaining a separate expansion state from the project.
Opening a project restores its prior sidebar state. Brand navigation keeps project, selection,
filter, history and native observation alive. While
Home is visible, do not automatically open reference review or load hidden thumbnails. Current
project recents resume its existing state instead of reopening/resetting it. Native dialogs and
foreground operations keep their existing ownership guards.

Use sidebar counts as the primary project summary and Command Bar for reference review/next
steps. Show a result count only when filtering/searching or when the sidebar is unavailable.
Keep error details, fingerprint checks and the external-editor save reminder intact.

## Product copy

The main benefit is faster LaTeX compilation. PDF conversion explains how that benefit is
achieved and belongs in the optional explanation. No new LaTeX compilation validation is planned.

- [x] Implement and inspect the feature diff.
- [x] TypeScript, 299 frontend tests, production build and the PDF rendering test pass.
- [x] Browser fixture verification: Home has one brand, one open action and one recent list;
  initial Home and brand-return collapse the sidebar; opening/resuming a project restores it.
- [x] Regression tests preserve project selection/filter, avoid a second native open/close,
  retain an unsaved settings draft, and hold queued reference review until leaving Home.

Browser verification uses deterministic native IPC fixtures; it does not claim an installed
native application or a LaTeX compile benchmark. ReviewDialog source safety remains unchanged.
Screenshots: `/private/tmp/texgo-home-review.png`, `/private/tmp/texgo-workspace-review.png`.
