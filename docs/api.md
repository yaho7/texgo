# Headless Developer API

`texgo-engine` is the standalone, local Rust engine. It does not launch the
desktop UI. Integrate it as a process in VS Code, another editor, a script, or
an agent. The API is newline-delimited JSON-RPC 2.0 over stdin/stdout, not HTTP.
No listener, account, token, or cloud service is involved.

Installing Texgo Desktop also installs this engine. See the
[bundled executable paths](desktop-release.md#one-install-gui-and-cli) and use
that absolute path as the editor's process command. No second engine archive
or installation is required.
Compilation requires an existing TeX distribution providing `latexmk` and the
chosen engine. Texgo never downloads or installs TeX. Run only trusted TeX
projects: latexmk, TeX, project latexmkrc files, packages, and external tools
execute with the current user's permissions. Output-directory checks are not
a sandbox for arbitrary TeX code.

For source builds in CI, the headless target is:

```sh
cargo build --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --features automation --bin texgo-engine
cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --features automation
```

## Commands

```sh
texgo-engine scan --main /project/main.tex --json
texgo-engine build --config /project/.texgo/project.json --json
texgo-engine run --config /project/.texgo/project.json --json
texgo-engine watch --config /project/.texgo/project.json
texgo-engine rpc
```

`--json` is optional for `scan`, `build`, `run`, and `watch`. JSON commands never
print prose or compiler output to stdout. One-shot commands emit one JSON value
and exit 0 on success, 1 on failure. `scan` succeeds when scanning completes;
inspect asset statuses and warnings before deciding whether to proceed.

| Command | Behavior |
| --- | --- |
| `scan --main PATH` | Scan reachable TeX sources and image references without editing them. |
| `build --config PATH` | Compile only; never convert images or replace TeX references. |
| `run --config PATH` | Scan, validate, optionally convert/replace, then compile. |
| `watch --config PATH` | Run the pipeline immediately, then repeat after relevant edits. |
| `rpc` | Keep a Workspace session alive and accept one JSON-RPC object per line. |

Command-line paths are relative to the process working directory. Paths in the
configuration follow the separate rules below. A one-shot configuration or
pipeline preflight error has this shape and a nonzero process exit:

```json
{"error":{"message":"Pipeline cannot resolve all image references: missing.png (missing)"}}
```

A failed compile is **not** replaced by this generic envelope: `build` retains
the entire `BuildResult`, and `run` retains its `PipelineResult` with
`build.success:false`, while still exiting nonzero.

## Version 1 Configuration

For `/project/.texgo/project.json`:

```json
{
  "version": 1,
  "mainFile": "../main.tex",
  "images": {
    "enabled": true,
    "quality": "custom",
    "dpi": 300,
    "jpegQuality": 100,
    "outputDir": "texgo-pdf",
    "replace": true
  },
  "build": {
    "engine": "xelatex",
    "outputDir": "build",
    "synctex": true
  }
}
```

`version` and `mainFile` are required. Unknown properties, wrong JSON types,
unsupported versions, and invalid option ranges are rejected, including in
nested objects. Optional `$schema` is an editor hint, not a schema URL fetched
by the engine. The schema is maintained at `docs/project.schema.json` in the
repository and tagged release source.

| Property | Default | Contract |
| --- | --- | --- |
| `version` | Required | Exactly `1`. |
| `mainFile` | Required | Existing UTF-8 `.tex` file; relative to the **config's parent directory**, or absolute. |
| `images.enabled` | `true` | Convert every ready image when running the pipeline. |
| `images.quality` | `"custom"` | `original`, `high`, `compact`, or `custom`. |
| `images.dpi` | `300` | Integer 72 through 1200. |
| `images.maxWidthMm` | Ignored | Deprecated numeric compatibility field for version 1 only; never affects sampling. |
| `images.jpegQuality` | `90` | Integer 1 through 100; 100 uses lossless image encoding. |
| `images.outputDir` | `"texgo-pdf"` | Workspace-root-relative strict subdirectory, no traversal, symlinks or reserved state directories. |
| `images.replace` | `false` | Only explicit JSON `true` authorizes automated reference edits. |
| `build.engine` | `"xelatex"` | `xelatex`, `lualatex`, or `pdflatex`. |
| `build.outputDir` | `"build"` | Dedicated strict subdirectory of the main file's canonical parent. |
| `build.synctex` | `true` | Enable or disable SyncTeX. |

Thus `mainFile:"../main.tex"` and `outputDir:"build"` above compile
`/project/main.tex` into `/project/build`, not `/project/.texgo/build`.
The output directory may be absolute only if it remains inside the project.
It cannot be the project root, use `..`, contain symlinks, use reserved
`.git`/`.texgo`/`node_modules`/`texgo-pdf` directories, or contain referenced
project sources or other TeX/raster/vector source material.

`original` preserves original image quality and natural physical dimensions.
`custom` downsamples to the target DPI relative to the intrinsic density
(72 DPI fallback), never upscales, and preserves physical page dimensions.
`high` and `compact` optionally preset DPI/JPEG quality to 300/92 and 150/75.
Transparent images retain a lossless alpha channel. SVG stays vector with
bounded workspace-local dependencies. PDF
images already usable by TeX are not rasterized or reconverted.

### Pipeline Safety

`run`, `watch`, and RPC `pipeline.run` share the same pipeline:

1. When image conversion is enabled, open the project and reject scan warnings
   and missing, ambiguous, unsupported, or otherwise unresolved references.
   With `images.enabled:false`, skip image processing and reference mutations;
   let the compiler resolve dynamic TeX references. Image journal corruption
   does not block this compile-only mode or `build`.
2. If enabled, convert **all** ready images. Any conversion error or cancellation
   stops the pipeline before any reference edits or compilation.
3. Only if `images.replace` is explicitly `true`, preview the replacement plan
   and apply it when `referenceCount > 0`. No UI prompt is needed: the config is
   the authorization. With omitted/false `replace`, conversion can populate the
   cache, but compilation still uses the unchanged original TeX references.
4. Invoke latexmk. A compiler failure does not automatically undo a successful
   reference replacement; its persisted undo record remains available.
   When a generated image, reference, or bibliography changes, pass `-g` so
   same-second, same-size path edits cannot leave a stale document PDF. Unchanged cache-hit
   runs retain latexmk's normal incremental behavior; auxiliary files are not
   deleted.

Source images are preserved. Conversion writes same-stem PDFs into `texgo-pdf`
at the workspace root by default. For `images.outputDir:"output"`,
`figures/实验 图.png` becomes `output/figures/实验 图.pdf`. Names preserve Unicode
and spaces; hashes are internal identities only. Managed provenance, backups,
conversion history, added image directories, and reference undo records live
under `.texgo`. On later scans the core resolves managed PDFs back to their
original images, so changed originals can regenerate PDFs. Cache hits with no
path changes skip `apply`, preserving the existing undo journal. A project
containing only existing PDF references can compile without any replacement.

The engine uses the core project's write lock around reference mutations and
around actual compilation/log persistence, so another managed writer cannot
modify that project during a compile. Concurrent lock contention is an error,
not an indefinite wait. This is not a lock against external editor processes;
core preflight and undo checks refuse to overwrite changed source files.
Reference undo is a one-level persisted transaction and does not restore PDFs.
Conversion undo independently restores previous managed PDFs or removes PDFs
created by the latest meaningful batch. It never changes source images or build
artifacts. Outstanding reference undo blocks conversion undo until resolved.
New reference replacements cannot overwrite an outstanding reference undo record.

## JSON Result Contracts

All object field names use camelCase. Paths returned by the engine are absolute
unless a field explicitly describes a source-relative string. Nullable fields
are present as JSON `null`, not omitted.

### BuildResult

```json
{
  "success": false,
  "exitCode": 1,
  "pdfPath": null,
  "logPath": "/project/build/main.texgo-output.log",
  "diagnostics": [
    {"file":"/project/main.tex","line":12,"message":"Undefined control sequence.","severity":"error"}
  ]
}
```

`exitCode` is the native compiler status, or `null` if spawning failed or the
process had no numeric exit code. `pdfPath` is non-null only on a successful
compiler exit with an existing PDF. Never use an old PDF as evidence of success
after a failed compile. Each diagnostic has `file:string|null`,
`line:integer|null`, `message:string`, and `severity:"error"|"warning"`.

The full captured stdout and stderr are always persisted for an attempted
compiler invocation, even when latexmk is missing or exits unsuccessfully.
`<stem>.texgo-output.log` is separate from latexmk/TeX's native `<stem>.log`.
The capture appends stderr after stdout; byte content is retained, but stream
interleaving is not preserved. The latest run replaces the captured log.
Failure to persist that log is itself a reported operation error.

Diagnostic parsing recognizes `file.tex:N:`, `.sty`/`.cls`/`.bib` locations,
TeX `!` errors followed by `l.N`, warnings, overfull/underfull boxes, and latexmk
failures. Diagnostics are best effort; consult `logPath` for the full output.

The actual process invocation uses argv, not a shell:

```text
latexmk <engine-flag> -synctex=1 -file-line-error -interaction=nonstopmode -halt-on-error -outdir=<absolute-output-dir> main.tex
```

Engine flags are `-xelatex`, `-lualatex`, and `-pdf` respectively. SyncTeX off
uses `-synctex=0`. The working directory is the main file's parent and the final
argument is its basename. No untrusted string is interpolated into a shell
command. User/system latexmk configuration still applies.

### Project And Images

`scan`, `project.open`, and `project.scan` return:

```text
Project {
  status: WorkspaceStatus, convertedImages: ConvertedImage[],
  mainFile: string, root: string, texFiles: string[],
  images: ImageAsset[], warnings: string[], undoAvailable: boolean
}
ImageAsset {
  id: string, path: string|null, relativePath: string, format: string,
  width: integer|null, height: integer|null, bytes: integer|null,
  status: string, updateAvailable: boolean, message: string|null, references: Reference[]
}
Reference { file: string, line: integer, original: string, start: integer, end: integer }
```

Use opaque image IDs from the current scan. Status `ready` means convertible,
`pdf` means already usable, and other statuses such as `missing`, `ambiguous`,
and `unsupported` require attention. `line` is one-based; `start` and `end` are
UTF-8 byte offsets within the scanned source. `original` is the current path
text in TeX, which can already be a managed PDF path.
All workspaces require a LaTeX main file. Independent directory commands and RPC methods have been removed. The internal recursive image scanner remains available for safety checks and project resolution. `convertedImages` includes only outputs whose PDF, source and dependency hashes remain valid.

```text
WorkspaceStatus {
  pendingImages, pendingReferences, problemCount, ignoredCount,
  completedImages, totalImages: integer,
  pendingImageIds, problemIds, ignoredImageIds, completedImageIds: string[],
  nextAction: "reviewReferences"|"convertImages"|"resolveProblems"|"upToDate",
  blockingReason: string|null
}
```

Workspace refresh owns these counts and IDs. Reference review has priority over image updates, then problems, then completion. Ignored assets remain visible in All but are excluded from tasks and reference plans. `blockingReason` represents a safety blocker, including externally modified outputs or inconsistent recovery state. Clients must not infer the project action from format/status flags alone.

`updateAvailable` is true when a convertible source or its SVG dependencies have
changed since a managed, intact PDF was generated. It is recomputed when opening,
refreshing, converting or undoing a workspace. The desktop app checks metadata
in the background every 2.5 seconds while visible and idle, and on window focus;
it rescans only after a change. Review dialogs and file mutations pause polling.
Search, filters, valid selections and comparison mode survive automatic refresh.
The headless engine does not start background work merely by opening a project.
Content hashes are compared, so rewriting identical bytes does not trigger an
update. Missing or externally edited PDFs are not offered as safe updates. If a
valid current output exists, it takes precedence over older stale conversions.
The asset retains `status:"ready"` so existing automation clients can still
convert it. Stale PDFs are excluded from `convertedImages` and reference plans.

### Conversion, References, And Pipeline

```text
ConversionResult { images: ConvertedImage[], cancelled: boolean }
ConversionOptions {
  imageIds: string[], quality?: string, dpi: integer, jpegQuality: integer,
  outputDir?: string
}
ConversionHistoryEntry {
  id: string, createdAt: integer, outputDir: string, dpi: integer,
  jpegQuality: integer, files: ConversionHistoryFile[], undone: boolean, canUndo: boolean,
  cancelled: boolean, undoReason: string|null
}
ConversionHistoryFile { source: string, output: string, cached: boolean, error: string|null }
ConvertedImage {
  id: string, pdfPath: string|null, bytes: integer|null,
  cached: boolean, error: string|null
}
ReplacementPlan { files: FileChanges[], referenceCount: integer }
FileChanges { path: string, changes: ReferenceChange[] }
ReferenceChange { line: integer, before: string, after: string }
MutationResult { filesChanged: integer, referencesChanged: integer }
PipelineResult {
  project: Project, conversion: ConversionResult|null,
  replacement: MutationResult|null, build: BuildResult
}
```

`images.convert` may return individual conversion errors in a successful RPC
result. Inspect every `error` before applying. In contrast, the automated
pipeline treats any such error as failure and never compiles or applies a
partial batch. `conversion:null` means no conversion was needed/enabled;
`replacement:null` means no reference edits were applied.

Conversion options default `quality` to `custom` and `outputDir` to `texgo-pdf`.
`maxWidthMm` is not a conversion option. The GUI supplies DPI 300 / quality 100;
headless config and CLI retain JPEG quality 90 unless specified. History is
latest first, `createdAt` is epoch milliseconds, and file source/output paths
are workspace-relative. No PDF blobs or backup bytes are sent to clients.

Before any PDF write, same-stem destination collisions are checked against
the entire workspace source tree, including unselected and unreferenced images.
Existing unrelated PDFs or externally modified managed PDFs are never adopted
or overwritten. Source and SVG dependency integrity is rechecked before commit.
Write intents and backups precede PDF replacement; failure and cancellation
retain history and any successful earlier outputs. Undo preflights the entire
latest write batch, refuses edited/missing outputs without changing any file,
validates backups, and journals partial undo for retry after interruption.
Cached-only and failed-without-write batches do not displace meaningful undo.
`canUndo` is true only for the latest compatible meaningful batch, after jointly
checking every PDF/backup and its associated TeX recovery record. History adds
`referencesChanged` (reference occurrences) and `filesChanged` (TeX files), both
defaulting to zero for older journals. A cached-only batch with reference changes
is meaningful. State corruption is an error, not permission to overwrite PDFs.

### Reviewed References And Batch Integration

Reference changes carry a stable `id` formatted as `absolute-file-path:start-byte`.
Desktop review submits selected IDs and the **complete** reviewed `ReplacementPlan`.
An empty selection changes nothing; unknown IDs are rejected. Never recreate a
preview at apply time and treat it as the user's expected plan: retain the preview
that was actually displayed. Any difference in file, ID, line, before/after text,
ordering, or count rejects application and requires review again.

Workspace integration (crate-private Rust interfaces):

1. Acquire `transaction::lock_project(root)` once and retain it through all writes.
2. Apply: `transaction::prepare_reviewed(project, sources, converted, &selection,
   &expected_plan)` compares the complete current plan, then selects edits. Call
   `transaction::apply_linked(project, prepared, Some(batch_id))`; association and
   counts are journaled before any TeX write. The batch must be the newest batch
   and not already associated. `Journal::latest_batch_id()` supplies the candidate;
   retain the intended batch ID across review rather than silently changing it.
3. Undo: call `transaction::undo_batch_locked(project, batch_id)` under the same
   single lock. It validates main-file ownership, jointly preflights all PDF/TeX
   recovery, durably marks the batch undoing, restores TeX, then restores PDFs.
   Refresh the workspace even on error so partial operation state remains visible.

Lower-level orchestration is also available: `Journal::preflight_undo(root, id)`
is read-only; `Journal::begin_undo(root, id)` repeats preflight and persists retry
state; `transaction::undo_locked(project, Some(id))` restores matching TeX only;
then `Journal::undo(root, id)` completes PDFs. None acquires a lock. PDF undo
refuses while that batch's reference record still exists. Interruption after TeX
recovery but before PDF recovery is retryable; already restored files are recognized.

`transaction::prepare_selected(..., Option<&HashSet<String>>)` is the filtering
primitive; `None` and original `prepare(...)` preserve full-selection CLI behavior.
Filtering alone is not proof of review: desktop callers must use
`prepare_reviewed` or compare the complete plan with `verify_review` first.

Recovery records retain version 1 with optional `batch_id`. Missing `batch_id`
means a legacy standalone operation. Only `undo(project)` / `undo_locked(project,
None)` may undo that legacy record; they refuse linked records. Use
`transaction::standalone_undo_available(root) -> Result<bool, String>` for the old
standalone undo menu, not `undo_available` (which includes all archived batches).
Malformed legacy recovery is an error, not an absent record.

Linked records live at `.texgo/reference-undo/<sha256(batch-id)>.json`; each record
also validates its own `batch_id`. Completed A may be followed by B without
discarding A's recovery. Only the latest meaningful batch can be undone: undo B
restores B's TeX before its PDFs, leaving A's record available for the next undo.
Other archived batches do not block preflight or authorize restoring their TeX.
A legacy standalone record still blocks new conversion and joint undo until
explicitly handled through the standalone menu.

Older linked `undo.json` records migrate under the project lock: write and sync
the archived copy first, then unlink and sync the legacy directory. Duplicate
identical copies after a crash are accepted; conflicting copies are never
overwritten. Association/counts and `references_applying` are journaled before
the reference recovery record and before any TeX write. Successful application
clears `references_applying` only after all writes; interrupted application blocks
new conversion until batch undo, including a crash before the first TeX write.
Older conversion-only history remains compatible and needs no TeX recovery.

`ReviewDialog.onApply(selectionIds: string[])` supplies selection only; its parent
retains the reviewed plan and owns confirmation. `ConversionHistory.onUndo(entry)`
likewise delegates confirmation and displays the combined batch counts.

## JSON-RPC 2.0 Stdio

Spawn `texgo-engine rpc`, write UTF-8 JSON objects ending in a newline to stdin,
and read one JSON response per request from stdout. Flush after writing. EOF
ends the session. There are no HTTP endpoints, batch arrays, unsolicited
progress events, or stdout banners.

Each request has `jsonrpc:"2.0"`, `method:string`, optional `params:object`, and
optional `id:string|number|null`. Omitted `params` means `{}`. Omitted `id`
means a notification: the operation is processed, but **no response** is
written, including on method/parameter/runtime failure. Explicit `id:null` is
still a request and receives a response. A malformed envelope is not a valid
notification and receives an error with a null ID where no valid ID exists.

| Method | Params | Result |
| --- | --- | --- |
| `tools.info` | `{}` | Engine version, config version, transport, methods, engines, compiler, request bound. |
| `project.open` | `{"mainFile":"/project/main.tex"}` | `Project`; open a LaTeX main file and rehydrate valid conversions. |
| `project.scan` | `{"mainFile":"/project/main.tex"}` or `{}` | Rescan/select a LaTeX project; omitted main retains the current main file. |
| `images.convert` | `{"options":{"imageIds":["ID"],"quality":"custom","dpi":300,"jpegQuality":100,"outputDir":"texgo-pdf"}}` | `ConversionResult`; quality and outputDir are optional. |
| `images.history` | `{}` | `ConversionHistoryEntry[]`, latest first. |
| `images.undo` | `{"confirm":true,"entryId":"BATCH-ID"}` | `Project`; undo the latest compatible write batch and refresh. |
| `references.preview` | `{}` | `ReplacementPlan` for successful session conversions; no writes. |
| `references.apply` | `{"confirm":true}` | `MutationResult`; apply the current plan and refresh session. |
| `references.undo` | `{"confirm":true}` | `MutationResult`; restore latest persisted transaction and refresh session. |
| `document.build` | `{"configPath":"/project/.texgo/project.json"}` | `BuildResult`; compile only, no reference mutation. |
| `pipeline.run` | `{"configPath":"/project/.texgo/project.json"}` | `PipelineResult`; config's explicit `images.replace:true` authorizes edits. |

Methods needing a Workspace fail until a project is opened. A failed open
preserves the previously open session. Refresh rehydrates valid conversions
but invalidates stale TeX offsets. Build/pipeline configuration paths are independent of the current
session project; a pipeline refreshes a matching session to discard stale
plans. Use `project.open` to inspect another project after a pipeline call.
RPC paths in params are relative to the server process cwd or absolute;
config-contained paths follow the config rules above.

Reference mutation and conversion undo methods reject omitted, false, and non-boolean
confirmation. Conversion writes PDF cache files but does not edit TeX.
`pipeline.run` is also a potentially source-mutating operation: only pass a
trusted configuration with `images.replace:true` when that is intended.

Example request/response exchange (replace `ID` with an ID from the open result):

```json
{"jsonrpc":"2.0","id":1,"method":"project.open","params":{"mainFile":"/project/main.tex"}}
{"jsonrpc":"2.0","id":2,"method":"images.convert","params":{"options":{"imageIds":["ID"],"quality":"custom","dpi":300,"jpegQuality":100}}}
{"jsonrpc":"2.0","id":3,"method":"references.preview"}
{"jsonrpc":"2.0","id":4,"method":"references.apply","params":{"confirm":true}}
{"jsonrpc":"2.0","id":5,"method":"document.build","params":{"configPath":"/project/.texgo/project.json"}}
{"jsonrpc":"2.0","id":6,"method":"references.undo","params":{"confirm":true}}
```

Success responses use `{"jsonrpc":"2.0","id":1,"result":...}`. Compiler
failure remains a result with `success:false`/`build.success:false`; it does not
terminate the RPC process. Operation errors use:

```json
{"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"Reference mutation requires confirm:true"}}
```

| Code | Meaning |
| --- | --- |
| `-32700` | Malformed JSON or invalid UTF-8. |
| `-32600` | Invalid JSON-RPC envelope, batch request, invalid ID, or oversized frame. |
| `-32601` | Unknown method. |
| `-32602` | Invalid/missing params, options, config, or mutation confirmation. |
| `-32000` | Project, conversion, filesystem, lock, or other operation failure. |

Requests and config files are limited to 1 MiB. Oversized input lines are drained
without retaining the full frame. Invalid requests do not kill the session;
subsequent newline-delimited requests are still processed. Broken input/output
pipes and other transport failures terminate the process.

## Watch And VS Code

`watch` runs once immediately, then polls every 250 ms and waits until changes
have been quiet for 500 ms before rebuilding. It watches additions, deletions,
and timestamp/size changes to `.tex`, `.bib`, `.sty`, `.cls`, raster images,
SVG/EPS/PS, and PDFs below the main file's directory, plus the config itself.
It skips the configured output directory, `.git`, `.texgo`, `node_modules`,
and `texgo-pdf`; the config is an explicit exception to `.texgo` exclusion.
Directory/file symlinks are not traversed. Traversal is bounded to 50,000
entries and 64 directory levels. Initial invalid configuration and fatal watch
filesystem errors exit nonzero; compiler/pipeline failures stay alive. A later
invalid/deleted config is reported and retried when it changes again.

Every build compares content hashes of workspace `.bib` files with the last
successful build. Additions, edits, and deletions force rule evaluation with
`-g`. Failed builds retain the previous state so the next attempt retries it.
The pre-build snapshot is saved under `.texgo`, separately for each main file
and build directory, so edits during compilation remain pending.

Snapshots are taken **before** builds. Edits during compilation trigger the
next debounced build. Reference edits from the pipeline can cause one extra
self-induced build; no-op replacements and output exclusions prevent an
infinite rebuild loop. Stop watch using the editor's terminate-task command
or Ctrl+C. Multiple overlapping watchers for one project are not recommended.

Plain output has `[texgo] build-start` and `[texgo] watch-ready` lines for VS
Code's background matcher, including after failed builds. Diagnostic lines
are `file:line: error|warning: message`.

`watch --json` emits NDJSON events, flushing each line:

```json
{"event":"build-start"}
{"event":"build-result","result":{"project":{},"conversion":null,"replacement":null,"build":{"success":true,"exitCode":0,"pdfPath":"/project/build/main.pdf","logPath":"/project/build/main.texgo-output.log","diagnostics":[]}}}
{"event":"watch-ready"}
```

The `project:{}` above is abbreviated for readability; real events contain a
complete `Project`. A preflight/config failure emits
`{"event":"build-result","error":{"message":"..."}}` instead. Build
failures retain the full pipeline result and log path. `watch-ready` means the
watcher is idle, not that the previous build succeeded.

The complete manual-start example is in `examples/vscode`, including a sample
TeX document, SVG, config, and `.vscode/tasks.json`. Its default build task runs
the pipeline once; its background task runs watch. Neither runs automatically
on folder open. The example deliberately opts into reference replacement;
set `images.replace:false` to keep TeX references untouched.

## Desktop asset-control commands

The native desktop bridge additionally exposes `ignore_asset({imageId, mode})`, where `mode` is `none`, `session`, or `permanent`, and `rename_asset({imageId, newBaseName, expectedFingerprint})`. The rename fingerprint comes from the current `Project.stateFingerprint`. It returns `{project, oldImageId, newImageId}` after a complete backend transaction and rescan; consumers migrate the active ID rather than editing paths locally.

`Project.images[].ignoreMode` is authoritative. `WorkspaceStatus.convertibleImageIds` lists explicit manual candidates independently of `pendingImageIds` and `nextAction`. `convert_images({options, intent})` accepts `pending`, `selected`, or `reconvert`; omitting intent preserves pending behavior. The latter two represent explicit user selection and regenerate selected outputs without cache reuse, including ignored assets without changing ignore rules. Existing conversion options, engine pipeline and Smart Convert retain their meanings.

Rename history entries carry an optional `rename` summary. Recovery data is stored in `.texgo/rename-active.json` during a transaction and `.texgo/rename-undo/` for Undo. External edits cause preflight rejection, and interrupted changes recover before scanning. These desktop commands do not change the independent engine JSON-RPC protocol.
