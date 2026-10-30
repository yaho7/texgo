# Texgo performance measurements

[中文](README.zh.md)

Measured on 2026-10-30. XeLaTeX builds were **3.93–6.93× faster** across three projects.

## Image projects

| Project | Engine | Original (s) | Texgo PDF (s) | Original ÷ PDF |
|---|---|---:|---:|---:|
| 12 scientific plots | pdflatex | 0.425 | 0.481 | 0.88× |
| 12 scientific plots | xelatex | 2.659 | 0.589 | 4.51× |
| 4 PNG + 8 JPEG textures | pdflatex | 0.918 | 1.783 | 0.51× |
| 4 PNG + 8 JPEG textures | xelatex | 2.749 | 0.700 | 3.93× |
| 24 mixed images | pdflatex | 0.923 | 1.796 | 0.51× |
| 24 mixed images | xelatex | 4.858 | 0.701 | 6.93× |

A ratio above 1 means faster. pdfLaTeX took about 13–95% longer on these high-quality fixtures; those results are retained.

## One-time conversion and repeated builds

| Project | Conversion (s) | Reference update (s) | XeLaTeX builds to break even |
|---|---:|---:|---:|
| 12 scientific plots | 0.884 | 0.043 | 1 |
| 4 PNG + 8 JPEG textures | 5.376 | 2.494 | 4 |
| 24 mixed images | 6.390 | 2.880 | 3 |

Break-even counts round up (conversion + reference update) divided by time saved per two-pass build. Human confirmation time is excluded.

## Output size and appearance

| Project | XeLaTeX original PDF (MiB) | Texgo PDF (MiB) | Pages |
|---|---:|---:|---:|
| 12 scientific plots | 0.51 | 0.67 | 13 |
| 4 PNG + 8 JPEG textures | 54.66 | 130.35 | 13 |
| 24 mixed images | 55.17 | 131.01 | 25 |

JPEG 100 retains decoded image data, so JPEG sources can produce substantially larger PDFs. Resolution was not reduced to obtain speed gains. Five pages were rendered with identical settings and inspected for missing images, clipping and placement; full-page PSNR ranged from 42.2 to 87.1 dB.

## Official documentation controls

| Document | Engine | Pages | Median two-pass build (s) |
|---|---|---:|---:|
| source2e | lualatex | 1375 | 52.552 |
| grfguide | pdflatex | 18 | 0.480 |
| pgfmanual | lualatex | 1273 | 204.469 |

These measure complete official-document build workloads, not before/after Texgo acceleration. Inline TikZ drawing is not counted as external-image conversion savings. Index tools are excluded from the fixed two-pass timing.

## Methodology

- Mac mini, Apple M6, 16 GB; TeX Live 2026.
- Texgo engine 0.3.3; its engine sources were verified identical between v0.3.3 and v0.3.4.
- Scientific plots and texture images generated with seed 20261030. These are synthetic projects, not real papers.
- Each image is 2400 × 1600 at 300 DPI, displayed at 160 mm width.
- Default high-quality parameters: 300 DPI, JPEG quality 100. Both variants use the same page layout.
- One warm-up sample, then five timed samples per document; report the median. Each sample runs two complete engine passes.
- Alternate original/PDF ordering; do not time latexmk no-op runs that skip compilation.
- Warm filesystem cache, without OS cache purges. Screenshot generation ran after timing.
- Shell escape disabled; the grfguide EPS example was explicitly converted beforehand.
- Downloaded sources, scripts, projects and full logs remain in ignored `benchmarks/`. Only this summary, charts and timing records without local paths are published.

[Raw timing data / 原始计时](results-2026-10-30.json)

## Pinned sources

- [LaTeX documentation](https://www.latex-project.org/help/documentation/)
- [LaTeX2e sources](https://github.com/latex3/latex2e/tree/796a92eecd7bc4baaaf239d9dfa60cfe0ff4072f)
- [PGF/TikZ sources](https://github.com/pgf-tikz/pgf/tree/f8665b683f0a9448d7a1f1198d5caf56fa4707dc)

Official documentation provides reproducible workloads, not an official performance scoring standard. Results apply to the recorded machine, engines, quality settings and fixtures.
