# Tailwind workspace redesign

User direction (2026-10-28): repaint the UI using Tailwind, remove shadcn, and use
`frontend-design` to design a macOS-native software style and layout. The attached image
is optional inspiration; the user's later clarification frees the design from its layout.
This work precedes release/updater work. The approved backend, review and rollback rules remain.

## Visual direction

The product is a local scientific-document workbench: a project-centered toolbar and sidebar,
file-oriented content and an independent inspector. Follow macOS desktop conventions rather
than a web dashboard or a painted operating-system window. Use real controls and retain a
single primary next action. Native macOS chrome remains native; other platforms keep their
native window controls.

- Light cool-gray sidebar/chrome, white content and thin dividers; blue selection and primary
  action, restrained orange/red status dots. System UI typography, left-aligned filenames and
  tabular metadata. No decorative dashboard cards or simulated OS controls.
- Palette: canvas `#f5f6f8`, sidebar `#eceef1`, surface `#ffffff`, text `#20252c`, muted
  `#65707e`, divider `#dfe3e8`, action/selection `#0b6fe8` (white selection text, with `#147bf5` focus rings).
- A project/filter sidebar, compact filename/status/format/size library, substantial inspector,
  and one conversion primary action. Search and navigation reflect real application behavior.
  Preserve all working filters and manual conversion intents, even when absent in the reference.
- The inspector emphasizes filename, image metadata, original/PDF/comparison, references and
  managed output. Loading, missing files, errors, review, history, settings and Home share the
  same design. Native window controls remain native.

```text
project/sidebar | project identity + search / real workspace controls
filters         | file library              | selected image / metadata
history         | compact bounded rows      | preview modes and canvas
recent projects | thumbnails and statuses   | references / managed output
settings        | status + output settings + one next action
```

## Unit 1: Own the Tailwind controls

Replace the generated shadcn component layer with deliberately written application controls
styled by Tailwind; remove its generator configuration and unused dependencies. Native HTML
and unstyled accessibility primitives may support keyboard navigation, focus trapping and
portals. This is a source migration, not a rename or a CSS skin over generated components.
Preserve operation ownership, ARIA behavior, menu/dialog lifetime tracking and loading/failure
recovery. Update component-only test imports without weakening workflow assertions.

## Unit 2: Recompose the workspace

Compose sidebar, search, dense library and inspector using macOS file-manager conventions.
Use honest file-format icons in this composition; the latest macOS direction does not require
replicating the reference image’s thumbnails. If thumbnails are added later, bound their loading
to visible pages. Metadata and statuses remain native-owned. Existing source reveal/copy actions
remain available in file menus. Show the managed PDF output as text; do not introduce output
reveal/copy controls without validated backend-owned paths. Keep row identity, pagination, rename input
height/focus, ignored-image manual conversion, three preview modes and comparison geometry.
Preserve a single primary next action and all explicit reference review safeguards.

## Unit 3: Complete and visually verify

Bring Home, settings, history, menus, errors and review dialogs into the same Tailwind design.
Check actual browser fixture screenshots at wide and minimum window sizes, keyboard/focus,
reduced motion, loading/failure states and long paths. Run frontend/PDF/native checks appropriate
to each unit, independent spec/quality review and a scoped commit before proceeding.

The pre-existing `desktop/src/styles.css` and `desktop/scripts/review-ui.mjs` edits remain
user-owned and unstaged. If the old stylesheet becomes inactive, carry its 24-pixel rename/
preview target behavior into the new controls rather than discarding the behavior. Never
overwrite/delete those files to simplify the migration. Do not add fake back/forward controls,
nonfunctional view toggles, duplicate primary actions, or real-time `.tex` writes.

- [x] Tailwind controls replace shadcn: 23 generated files and generator configuration removed;
  20 focused native/Radix accessibility adapters are authored with application-owned Tailwind
  styling. Removed cva/cn package dependencies and migrated product/test imports. Both reviews
  approved; TypeScript, 285 frontend tests, PDF test and production build passed. Main chunk
  484.14 kB, CSS 61.13 kB. Accessible action blue is `#0b6fe8` (4.72:1 on white) rather than
  the lighter reference accent; focus ring retains `#147bf5`. Protected user files unchanged.
- [x] macOS workspace composition: project toolbar search, sidebar filters (including completed
  and ignored), filename/format/size/status library, blue selection, inspector filename,
  grouped reference lines and actual PDF output. Existing file menus, 40-row pagination,
  inline rename and preview modes are retained. Kept native titlebar controls. No new native
  filesystem commands or automatic source writes. 288 frontend tests, TypeScript, PDF renderer
  test and production build passed. Browser fixture checked at 1280×850 and 960×640; fixed
  the navigation drawer’s inherited centering offset. Protected user files remain untouched.
- [ ] Remaining screens and visual acceptance; verified, reviewed and committed.


## Design critique and guidance

Applied `frontend-design`: system UI type (13px body, 11px metadata, 17px inspector filename),
left alignment, cool neutral surfaces and one blue primary/selection treatment. The first
composition duplicated image metadata and wrapped row actions; removed the duplicate metadata
and kept status/menu on one row. No simulated traffic lights, dead navigation or decorative
cards. This is a macOS-style Tauri interface, not an AppKit rewrite or a claim of native
Liquid Glass behavior.

Apple guidance consulted: [macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos),
[toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) and
[sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars). The design
uses a useful document title, restrained toolbar items, familiar search placement and persistent
navigation. The user’s no-shadcn direction takes precedence over the initial screenshot.
