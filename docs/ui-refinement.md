# Finder-style refinement — 2026-10-28

The existing layout now uses a solid `#EEECEE` sidebar and white document surfaces.
The preview has no outer frame, references are always visible as relative `file:lines`,
and output paths use project-relative text with full paths in tooltips. Empty reference
sections and healthy image status labels are hidden. History and Settings use spacing
instead of cards and repeated separators.

Reveal actions produce no success notice. Copying a path uses a 1.5-second transient
message. Errors, pending references and safety conflicts retain their existing explicit UI.
Navigation uses shared 180 ms opacity/6 px motion; hidden retained views are inert.
Reduced Motion uses brief opacity only. No animation package was added.

Visual inspection used local example data at 1440×900, 1280×800 and 1100×700,
including Home, Workspace, History, Settings, and explicit rename review/application.
Measured sidebar/main/list/preview colors match the required palette; the 1100 px
layout keeps the table inside its list pane. Focused presentation, file-action,
preview, navigation, workspace-hook and workflow tests were run, together with
TypeScript, bilingual catalog checks and the production frontend build.

The macOS-specific Tauri configuration enables native Overlay decorations; an empty
28 px top drag region and safe offsets reserve traffic-light space. Windows/Linux retain
the base native decorations. Installed macOS traffic-light placement and window dragging
still need native acceptance after packaging; browser screenshots cannot verify system chrome.

This presentation pass does not change conversion, journal, transaction, watcher decisions,
reference-write guards, rename/ignore semantics or undo behavior.
