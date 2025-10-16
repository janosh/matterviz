<script lang="ts">
  import { plot_colors } from '$lib/colors'
  import type { RdfEntry } from '$lib/rdf'
  import { RdfPlot } from '$lib/rdf'
  import type { PymatgenStructure } from '$lib/structure'
  import bi2zr2o8 from '$site/structures/Bi2Zr2O8-Fm3m.json'
  import nacl from '$site/structures/mp-1234.json'
  import pd from '$site/structures/mp-2.json'

  // Synthetic RDF patterns for testing
  const synthetic_pattern: RdfEntry = {
    label: `Synthetic Li-O`,
    pattern: {
      r: Array.from({ length: 50 }, (_, idx) => (idx + 1) * 0.2),
      g_r: Array.from({ length: 50 }, (_, idx) => {
        const r_val = (idx + 1) * 0.2
        return 1 - Math.exp(-r_val / 2) +
          2.5 * Math.exp(-((r_val - 2) ** 2) / 0.3) +
          1.8 * Math.exp(-((r_val - 4) ** 2) / 0.3)
      }),
      element_pair: [`Li`, `O`],
    },
    color: plot_colors[0],
  }

  const synthetic_patterns: RdfEntry[] = [
    synthetic_pattern,
    {
      label: `Synthetic O-O`,
      pattern: {
        r: Array.from({ length: 50 }, (_, idx) => (idx + 1) * 0.2),
        g_r: Array.from({ length: 50 }, (_, idx) => {
          const r_val = (idx + 1) * 0.2
          return 1 - Math.exp(-r_val / 3) +
            1.5 * Math.exp(-((r_val - 3) ** 2) / 0.4) +
            1.2 * Math.exp(-((r_val - 6) ** 2) / 0.4)
        }),
        element_pair: [`O`, `O`],
      },
      color: plot_colors[1],
    },
  ]

  const structures = {
    NaCl: nacl,
    Pd: pd,
    'Bi₂Zr₂O₈': bi2zr2o8,
  } as unknown as Record<string, PymatgenStructure>
</script>

<svelte:head>
  <title>RdfPlot Test Page</title>
</svelte:head>

<h1>RdfPlot Component Playwright Tests</h1>

<h2>Single Synthetic Pattern</h2>
<RdfPlot
  id="single-pattern"
  patterns={synthetic_pattern}
  x_axis={{ label: `r (Å)` }}
  y_axis={{ label: `g(r)` }}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2>Multiple Synthetic Patterns with Legend</h2>
<RdfPlot
  id="multi-pattern"
  patterns={synthetic_patterns}
  x_axis={{ label: `r (Å)` }}
  y_axis={{ label: `g(r)` }}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2>Single Structure - Element Pairs</h2>
<RdfPlot
  id="single-structure-element-pairs"
  structures={structures.NaCl}
  mode="element_pairs"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2>Single Structure - Full RDF</h2>
<RdfPlot
  id="single-structure-full"
  structures={structures.NaCl}
  mode="full"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2>Multiple Structures Comparison</h2>
<RdfPlot
  id="multi-structure"
  {structures}
  mode="full"
  cutoff={7}
  n_bins={100}
  style="height: 360px"
/>

<h2>Reference Line at g(r) = 1</h2>
<RdfPlot
  id="reference-line"
  patterns={synthetic_pattern}
  show_reference_line
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2>Without Reference Line</h2>
<RdfPlot
  id="no-reference-line"
  patterns={synthetic_pattern}
  show_reference_line={false}
  cutoff={10}
  n_bins={50}
  style="height: 360px"
/>

<h2>Drag & Drop Enabled</h2>
<RdfPlot
  id="drag-drop"
  mode="element_pairs"
  enable_drop
  cutoff={7}
  style="height: 360px"
/>
