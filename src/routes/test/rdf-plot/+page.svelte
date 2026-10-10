<script lang="ts">
  import { PLOT_COLORS } from '#lib/colors/index.js'
  import type { RdfEntry } from '#lib/rdf/index.js'
  import { RdfPlot } from '#lib/rdf/index.js'
  import type { Crystal } from '#lib/structure/index.js'
  import bi2zr2o8 from '#site/structures/Bi2Zr2O8-Fm3m.json'
  import al2lu from '#site/structures/mp-1234.json'
  import palladium from '#site/structures/mp-2.json'

  // Synthetic RDF patterns: decaying baseline plus Gaussian coordination-shell peaks
  const r_vals = Array.from({ length: 50 }, (_, idx) => (idx + 1) * 0.2)
  const gauss = (r_val: number, center: number, width: number) =>
    Math.exp(-((r_val - center) ** 2) / width)

  const synthetic_pattern: RdfEntry = {
    label: `Synthetic Li-O`,
    pattern: {
      r: r_vals,
      g_r: r_vals.map(
        (r_val) =>
          1 - Math.exp(-r_val / 2) + 2.5 * gauss(r_val, 2, 0.3) + 1.8 * gauss(r_val, 4, 0.3),
      ),
      element_pair: [`Li`, `O`],
    },
    color: PLOT_COLORS[0],
  }

  const synthetic_patterns: RdfEntry[] = [
    synthetic_pattern,
    {
      label: `Synthetic O-O`,
      pattern: {
        r: r_vals,
        g_r: r_vals.map(
          (r_val) =>
            1 - Math.exp(-r_val / 3) + 1.5 * gauss(r_val, 3, 0.4) + 1.2 * gauss(r_val, 6, 0.4),
        ),
        element_pair: [`O`, `O`],
      },
      color: PLOT_COLORS[1],
    },
  ]

  const structures = {
    'Al₂Lu': al2lu,
    Pd: palladium,
    'Bi₂Zr₂O₈': bi2zr2o8,
  } as unknown as Record<string, Crystal>
</script>

<svelte:head>
  <title>RdfPlot Test Page</title>
</svelte:head>

<h1 id="rdfplot-component-playwright-tests">RdfPlot Component Playwright Tests</h1>

<h2 id="single-synthetic-pattern">Single Synthetic Pattern</h2>
<RdfPlot
  id="single-pattern"
  patterns={synthetic_pattern}
  x_axis={{ label: `r (Å)` }}
  y_axis={{ label: `g(r)` }}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2 id="multiple-synthetic-patterns-with-legend">Multiple Synthetic Patterns with Legend</h2>
<RdfPlot
  id="multi-pattern"
  patterns={synthetic_patterns}
  x_axis={{ label: `r (Å)` }}
  y_axis={{ label: `g(r)` }}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2 id="single-structure-element-pairs">Single Structure - Element Pairs</h2>
<RdfPlot
  id="single-structure-element-pairs-plot"
  structures={structures[`Al₂Lu`]}
  mode="element_pairs"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2 id="single-structure-full-rdf">Single Structure - Full RDF</h2>
<RdfPlot
  id="single-structure-full"
  structures={structures[`Al₂Lu`]}
  mode="full"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2 id="multiple-structures-comparison">Multiple Structures Comparison</h2>
<RdfPlot
  id="multi-structure"
  {structures}
  mode="full"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2 id="reference-line-at-g-r-1">Reference Line at g(r) = 1</h2>
<RdfPlot
  id="reference-line"
  patterns={synthetic_pattern}
  show_reference_line
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2 id="without-reference-line">Without Reference Line</h2>
<RdfPlot
  id="no-reference-line"
  patterns={synthetic_pattern}
  show_reference_line={false}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2 id="drag-drop-enabled">Drag & Drop Enabled</h2>
<RdfPlot
  id="drag-drop"
  mode="element_pairs"
  allow_file_drop
  cutoff={7}
  style="height: 360px"
/>
