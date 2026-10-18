# Workspace UI Static Review

Rules fetched from [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) during implementation and final review. Scope is the desktop workspace, not the legacy Go CLI.

## Resolved

- `desktop/src/Home.tsx:29` - primary action now explicitly opens a .tex main file; directory conversion and bounded recent entries are separate actions.
- `desktop/src/ConversionPanel.tsx:34` - conversion works from either inspector tab; invalid submission switches to settings and focuses the first invalid field.
- `desktop/src/ConversionPanel.tsx:53` - labelled numeric fields have names, autocomplete, range constraints and associated inline errors; no reference-width control remains.
- `desktop/src/App.tsx:249` - keyboard skip link and focusable main content added; modal dismissal restores focus.
- `desktop/src/App.tsx:282` - conversion undo has a titled confirmation dialog, explicit consequences, busy locking and inline failure feedback.
- `desktop/src/AssetList.tsx:39` - image table is paginated at 40 rows; search resets pagination, checkboxes have expanded label targets.
- `desktop/src/AssetPreview.tsx:51` - image dimensions and useful alt text are explicit; loading/error states are retained.
- `desktop/src/ConversionHistory.tsx:8` - dates use Intl; invalid timestamps do not crash the view; records and expanded file lists load incrementally.
- `desktop/src/styles.css:115` - expanded history files use content visibility; long paths wrap and fixed inspector surfaces remain scrollable.
- `desktop/src/styles.css:183` - reduced-motion behavior retained; modal overscroll and visible focus states added.
- `desktop/src/components/ui/button.tsx:7` - unbounded transitions replaced with explicit properties; progress animates transform only.
- `desktop/src/utils.ts:11` - file sizes use locale-aware number formatting.
- `desktop/src-tauri/src/commands.rs:17` - overlapping preview/history reads queue on the blocking worker instead of surfacing transient workspace-lock errors.

## Verification Boundary

- `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/texgo-npm-cache`: installed only after explicit user approval; no install scripts executed.
- `npm run check`: TypeScript no-emit check passed.
- `node --check desktop/scripts/browser-qa.mjs`: script syntax passed; browser fixture was updated but not executed.
- JSON configuration/schema syntax and `git diff --check` passed.
- PostCSS syntax parsing passed for `styles.css` and `theme.css`; no CSS output was generated.
- No local build, packaging, app launch, screenshot verification or runtime tests were run, following the user's local static-only policy.
- Rust syntax/type/build/test verification was not run: `rustup toolchain list` reports no installed toolchains. No Rust toolchain was installed.
- Native desktop navigation uses workspace state and persistent recent entries, not browser URL routing. CI workflow and release triggers are unchanged.
