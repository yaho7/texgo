# Phase 9 — public documentation and delivery

Keep the cancelled LaTeX compilation validation and VS Code extension phases cancelled.
The existing CLI/RPC and editor configuration example remain supported.

1. Replace stale root and desktop README copy in English/Chinese with the current faster
   compilation workflow, explicit reference review/fingerprints, concise feature summary,
   native update behavior and exact-tag publication policy.
2. Add Home, workspace and Compare screenshots from the actual production UI with clearly
   disclosed deterministic fixture data. Refresh the CI visual harness to current labels,
   thumbnail IPC and interactions; preserve the user's four uncommitted row-height lines.
3. Add a concise contribution guide, bug/feature templates, troubleshooting and a delivery
   report with test evidence and actual device/CI limits. Check relative document links.
4. Audit issues: #1 still needs Windows/native performance acceptance; #2 already has an
   explicit maintainer answer that Chinese compilation is supported. Add missing platform
   labels and classify the issues; close only the answered support question.
5. Verify documentation/harness syntax, existing regression suite and release policy; inspect
   the scoped diff and commit. Do not push or publish.

- [x] Documentation and screenshots
- [x] Contribution and issue templates
- [x] GitHub issue/label audit
- [x] Final verification and delivery report

Completed 2026-10-28: bilingual README/user guides, three production-frontend fixture
screenshots, contribution guide, issue forms, troubleshooting, corrected release and
development documentation, and the delivery report. Issue states/labels were reread
and confirmed. Existing uncommitted row-height/style changes remain outside this unit.
Hosted CI and installed-platform acceptance remain explicitly listed in the report.

Subsequent authorization: the user requested publishing `v0.3.0` after completion.
Release preparation and CI follow the documentation commit; the earlier no-publish
constraint is superseded for this exact version. Codex attribution is added to both READMEs.
