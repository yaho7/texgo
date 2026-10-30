# README visuals

The English README uses `*-en.svg`; the Chinese README uses `*-zh.svg`.
Both sets embed the unmodified 1440 × 900 browser captures in self-contained SVGs.
The outer area is transparent, with no colored backdrop. A 14 px clipping radius
and a soft drop shadow decorate the screenshot itself. The two benchmark SVGs
use the same transparent treatment. These presentation effects do not change the
installed app's interface.

The project contains figures extracted from the **official PGF/TikZ manual**:

- `pgfmanual-en-tutorial.tex`: trigonometry tutorial.
- `pgfmanual-en-tutorial-nodes.tex`: Petri-net tutorial.
- `pgfmanual-en-library-automata.tex`: finite-state machine.
- `pgfmanual-en-library-mindmaps.tex`: mind map.
- `pgfmanual-en-tikz-plots.tex`: function plots.
- `pgfmanual-en-library-matrices.tex`: matrix layout.

Source: [PGF/TikZ official repository, pinned commit](https://github.com/pgf-tikz/pgf/tree/f8665b683f0a9448d7a1f1198d5caf56fa4707dc/doc/generic/pgf).
The source headers credit Till Tantau and permit distribution/modification under
the LaTeX Project Public License and/or the GNU Free Documentation License.
See the project's [license files](https://github.com/pgf-tikz/pgf/tree/f8665b683f0a9448d7a1f1198d5caf56fa4707dc/doc/generic/pgf/licenses).
These figures are separate examples assembled into `pgf-examples.tex`, not an
unmodified copy of the complete manual.

The example source was compiled with TeX Live 2026, rendered at 300 DPI, then
converted by Texgo's real engine. Project snapshots, conversion outputs and
reference plans are real; native UI services are simulated for repeatable,
read-only browser capture. These screenshots are UI illustrations, not installed
platform acceptance tests. Full local capture inputs remain under ignored
`benchmarks/showcase/` and `benchmarks/screenshots/`.

The bilingual SVG charts are generated with Matplotlib from the published
[benchmark records](../benchmarks/results-2026-10-30.json). They specifically show
XeLaTeX results; the [complete report](../benchmarks/README.md) retains all engines,
one-time conversion costs and output sizes.
