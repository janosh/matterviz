# Violin Plot

A violin plot is a [BoxPlot](/plot/box-plot) with `kind="violin"`: it draws a smoothed kernel-density estimate of each raw `y[]` distribution instead of the quartile box and shares the box plot's orientation, axes, controls, and interactions.

<div class="bleed-1400 demo-pairs" style="--pair-rows: 4">
<section>

## Basic Usage

Pass one series per distribution. Bandwidth defaults to Silverman's rule; override per series or
globally via `bandwidth` (`'silverman'`, `'scott'`, or a number). Opt into `marginals` to add a
value-axis distribution strip (a per-series `histogram` here). The same `marginals` API works
across all 2D plots ([full reference](/plot/scatter-plot#marginal-distributions)):

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'
  import { generate_normal, seeded_rng } from '#site/histogram-data'

  const series = [
    { y: generate_normal(200, 0, 1, seeded_rng(1)), label: `A`, color: `#4c6ef5` },
    { y: generate_normal(200, 0.5, 1.6, seeded_rng(2)), label: `B`, color: `#fa5252` },
    { y: generate_normal(200, -0.4, 0.8, seeded_rng(3)), label: `C`, color: `#40c057` },
  ]
</script>

<BoxPlot
  {series}
  kind="violin"
  x_axis={{ label: `Model` }}
  y_axis={{ label: `Error` }}
  marginals={{ right: { type: `histogram`, size: 90 } }}
  style="height: 400px"
/>
```

</section>
<section>

## Violin + Box Overlay

Set `kind="violin+box"` (per series or on the component) to draw the quartile box and whiskers
inside the violin, the way `plotly.express.violin(box=True)` does.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'
  import { generate_normal, seeded_rng } from '#site/histogram-data'

  const series = [
    { y: generate_normal(250, 0, 1, seeded_rng(4)), label: `A`, color: `#4c6ef5` },
    { y: generate_normal(250, 1, 1.4, seeded_rng(5)), label: `B`, color: `#fa5252` },
  ]
</script>

<BoxPlot
  {series}
  kind="violin+box"
  x_axis={{ label: `Group` }}
  y_axis={{ label: `Value` }}
  style="height: 400px"
/>
```

</section>
</div>

<div class="bleed-1400 demo-pairs" style="--pair-rows: 4">
<section>

## One-Sided Violins (RMSD style)

A horizontal, one-sided `violin+box` with the KDE clipped to non-negative values reproduces the
matbench-discovery RMSD figure. `side="positive"` draws only the upper half; `kde_clip={[0, null]}`
keeps the density physical; `show_value_labels` with `value_label_stat="mean"` prints the mean.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'
  import { generate_normal, seeded_rng } from '#site/histogram-data'

  // Half-normal-ish positive samples (RMSD is >= 0)
  const make_rmsd = (seed, count, scale) =>
    generate_normal(count, 0, scale, seeded_rng(seed)).map(Math.abs)

  const colors = [`#636EFA`, `#EF553B`, `#00CC96`, `#AB63FA`]
  const names = [`eqV2`, `MACE`, `CHGNet`, `M3GNet`]
  const series = names.map((label, idx) => ({
    y: make_rmsd(idx + 1, 250, 0.03 + idx * 0.015),
    label,
    color: colors[idx],
  }))
</script>

<BoxPlot
  {series}
  kind="violin+box"
  side="positive"
  orientation="horizontal"
  kde_clip={[0, null]}
  show_value_labels
  value_label_stat="mean"
  value_label_format=".3~g"
  x_axis={{ label: `RMSD (Å)`, range: [0, null] }}
  style="height: 420px"
/>
```

</section>
<section>

## Split Violins

Give two series the same `category` and opposite `side` values to compare two distributions in one
slot. Series in a shared slot are identified by the legend rather than colored axis ticks.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'
  import { generate_normal, seeded_rng } from '#site/histogram-data'

  // Each series is labeled by its element; the legend_group header conveys the dataset
  // (Predicted = left/blue, DFT = right/red), avoiding repeated identical legend entries.
  const series = [
    ...[`Si`, `Ge`, `C`].flatMap((cat, idx) => [
      {
        y: generate_normal(200, idx * 0.5, 1, seeded_rng(idx * 2 + 1)),
        category: cat,
        side: `negative`,
        label: cat,
        color: `#4c6ef5`,
        legend_group: `Predicted`,
      },
      {
        y: generate_normal(200, idx * 0.5 + 0.3, 1.1, seeded_rng(idx * 2 + 2)),
        category: cat,
        side: `positive`,
        label: cat,
        color: `#fa5252`,
        legend_group: `DFT`,
      },
    ]),
  ]
</script>

<BoxPlot
  {series}
  kind="violin"
  show_legend
  legend={{ style: `left: auto; right: 4px; top: 50%; transform: translateY(-50%)` }}
  padding={{ r: 120 }}
  x_axis={{ label: `Element` }}
  y_axis={{ label: `Property` }}
  style="height: 400px"
/>
```

</section>
</div>
