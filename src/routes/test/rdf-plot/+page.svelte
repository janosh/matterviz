<script lang="ts">
  import { PLOT_COLORS } from '#lib/colors/index.js'
  import type { RdfEntry } from '#lib/rdf/index.js'
  import { RdfPlot } from '#lib/rdf/index.js'
  import type { Crystal } from '#lib/structure/index.js'
  import bi2zr2o8 from '#site/structures/Bi2Zr2O8-Fm3m.json'
  import al2lu from '#site/structures/mp-1234.json'
  import palladium from '#site/structures/mp-2.json'
  import type { ComponentProps } from 'svelte'
  import TestSection from '../TestSection.svelte'

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

  const pattern_props = {
    x_axis: { label: `r (Å)` },
    y_axis: { label: `g(r)` },
    cutoff: 10,
    n_bins: 50,
  }
  const structure_props = { cutoff: 7, n_bins: 100 }
  const cases: (ComponentProps<typeof RdfPlot> & { id: string; title: string })[] = [
    {
      id: `single-pattern`,
      title: `Single synthetic pattern`,
      patterns: synthetic_pattern,
      ...pattern_props,
    },
    {
      id: `multi-pattern`,
      title: `Multiple synthetic patterns with legend`,
      patterns: synthetic_patterns,
      ...pattern_props,
    },
    {
      id: `single-structure-element-pairs-plot`,
      title: `Single structure, element pairs`,
      structures: structures[`Al₂Lu`],
      mode: `element_pairs`,
      ...structure_props,
    },
    {
      id: `single-structure-full`,
      title: `Single structure, full RDF`,
      structures: structures[`Al₂Lu`],
      mode: `full`,
      ...structure_props,
    },
    {
      id: `multi-structure`,
      title: `Multiple structures comparison`,
      structures,
      mode: `full`,
      ...structure_props,
    },
  ]
</script>

<h1>RdfPlot test page</h1>

{#each cases as { id, title, ...props } (id)}
  <TestSection {title}>
    <RdfPlot {id} {...props} style="height: 360px" />
  </TestSection>
{/each}
