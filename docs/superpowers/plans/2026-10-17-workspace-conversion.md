# Workspace Conversion Implementation Plan

**Goal:** Open a TeX main file or an image directory, retain recent workspaces, produce stable same-name PDFs, and undo recorded conversion batches safely.

**Architecture:** Rust owns directory discovery, output identity, persistent conversion journals and undo. React composes the existing shadcn primitives into home, assets and history views. GUI and headless API share the same filesystem operations.

**Verification boundary:** Local static analysis only. Do not install dependencies, build or package locally. GitHub Actions remains direct packaging on every push; no new CI gates.

## 1. Conversion Engine
- [x] Add regression cases before implementation for directory scanning, exact stems, collisions, changed outputs, cached reopen, cancellation and undo restoration.
- [x] Add directory workspaces and additional project directories; exclude generated/internal directories and symlinks.
- [x] Replace public hash filenames with preserved stems and configurable root-relative output directories.
- [x] Remove width-based resampling. Use intrinsic image density and target DPI without upscaling; quality 100 is lossless.
- [x] Persist conversion journals before output mutation, recover partial operations, and refuse conflicting undo.
- [x] Expose the same directory/history/undo capabilities in IPC and JSON-RPC; update schema and API examples.
- [x] Inspect filesystem safety and commit the engine unit (`802083e`); follow-up session eligibility fix committed as `5c3b5cc`.
- Rustfmt unavailable because no Rust toolchain is installed; no local compiler/tests were run.

## 2. Workspace Interface
- [x] Add frontend regression cases for settings, recents, directory entry, history, confirmation and error recovery before implementation.
- [x] Home primary action is `打开 .tex 主文件`; secondary action opens an image directory. Persist bounded recent entries and per-workspace settings.
- [x] Keep two-pane asset/preview layout. Add assets/history tabs and a return-home action; prevent navigation during operations.
- [x] Show only DPI, quality percentage and output directory; associate field errors and focus invalid inputs on submit.
- [x] Display persistent conversion batches and require confirmation for conversion undo; keep reference undo separate.
- [x] Apply accessibility, focus, long-path, reduced-motion, overscroll and small-screen guidelines.
- [x] Complete final TypeScript, CSS/JSON syntax and diff checks; save the UI unit as an atomic commit.

## 3. Final Review
- [x] Check frontend/backend contracts, documentation, tests and diffs; leave unrelated Go/README modifications untouched.
- [x] Run available no-output static checks and document unavailable checks in the UI review. Frontend dependencies were installed with scripts disabled after explicit approval.
