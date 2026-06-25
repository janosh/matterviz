# Violin Plot

A violin plot is the same chart as a [box plot](/plot/box-plot) — one raw `y[]` distribution per
series on a categorical axis — but draws a smoothed kernel-density estimate (KDE) of the
distribution instead of (or in addition to) the quartile box. `Violin` is a thin wrapper around
`BoxPlot` with `kind="violin"`; everything (orientation, pan/zoom, legend, dual axes, tooltips,
controls) is shared.

## Basic Usage

Pass one series per distribution. Bandwidth defaults to Silverman's rule; override per series or
globally via `bandwidth` (`'silverman'`, `'scott'`, or a number). Opt into `marginals` to add a
value-axis distribution strip (a per-series `histogram` here) — the same `marginals` API shared
across all 2D plots ([full reference](/plot/scatter-plot#marginal-distributions)):

```svelte example
<script lang="ts">
  import { Violin } from 'matterviz'

  const make_dist = (seed, n = 200, center = 0, spread = 1) => {
    let state = seed
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * next())
    })
  }

  const series = [
    { y: make_dist(1, 200, 0, 1), label: `A`, color: `#4c6ef5` },
    { y: make_dist(2, 200, 0.5, 1.6), label: `B`, color: `#fa5252` },
    { y: make_dist(3, 200, -0.4, 0.8), label: `C`, color: `#40c057` },
  ]
</script>

<Violin
  {series}
  x_axis={{ label: `Model` }}
  y_axis={{ label: `Error` }}
  marginals={{ right: { type: `histogram`, size: 90 } }}
  style="height: 400px"
/>
```

## Violin + Box Overlay

Set `kind="violin+box"` (per series or on the component) to draw the quartile box and whiskers
inside the violin, the way `plotly.express.violin(box=True)` does.

```svelte example
<script lang="ts">
  import { Violin } from 'matterviz'

  const make_dist = (seed, n = 250, center = 0, spread = 1) => {
    let state = seed
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * next())
    })
  }

  const series = [
    { y: make_dist(4, 250, 0, 1), label: `A`, color: `#4c6ef5` },
    { y: make_dist(5, 250, 1, 1.4), label: `B`, color: `#fa5252` },
  ]
</script>

<Violin
  {series}
  kind="violin+box"
  x_axis={{ label: `Group` }}
  y_axis={{ label: `Value` }}
  style="height: 400px"
/>
```

## One-Sided Violins (RMSD style)

A horizontal, one-sided `violin+box` with the KDE clipped to non-negative values reproduces the
matbench-discovery RMSD figure. `side="positive"` draws only the upper half; `kde_clip={[0, null]}`
keeps the density physical; `show_value_labels` with `value_label_stat="mean"` prints the mean.

```svelte example
<script lang="ts">
  import { Violin } from 'matterviz'

  // Half-normal-ish positive samples (RMSD is >= 0)
  const make_rmsd = (seed, n = 250, scale = 0.05) => {
    let state = seed
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      return Math.abs(scale * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * next()))
    })
  }

  const colors = [`#636EFA`, `#EF553B`, `#00CC96`, `#AB63FA`]
  const names = [`eqV2`, `MACE`, `CHGNet`, `M3GNet`]
  const series = names.map((label, idx) => ({
    y: make_rmsd(idx + 1, 250, 0.03 + idx * 0.015),
    label,
    color: colors[idx],
  }))
</script>

<Violin
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

## Split Violins

Give two series the same `category` and opposite `side` values to compare two distributions in one
slot. Series in a shared slot are identified by the legend rather than colored axis ticks.

```svelte example
<script lang="ts">
  import { Violin } from 'matterviz'

  const make_dist = (seed, n = 200, center = 0, spread = 1) => {
    let state = seed
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * next())
    })
  }

  // Each series is labeled by its element; the legend_group header conveys the dataset
  // (Predicted = left/blue, DFT = right/red), avoiding repeated identical legend entries.
  const series = [
    ...[`Si`, `Ge`, `C`].flatMap((cat, idx) => [
      {
        y: make_dist(idx * 2 + 1, 200, idx * 0.5, 1),
        category: cat,
        side: `negative`,
        label: cat,
        color: `#4c6ef5`,
        legend_group: `Predicted`,
      },
      {
        y: make_dist(idx * 2 + 2, 200, idx * 0.5 + 0.3, 1.1),
        category: cat,
        side: `positive`,
        label: cat,
        color: `#fa5252`,
        legend_group: `DFT`,
      },
    ]),
  ]
</script>

<Violin
  {series}
  show_legend
  legend={{ style: `left: auto; right: 4px; top: 50%; transform: translateY(-50%)` }}
  padding={{ t: 20, b: 50, l: 50, r: 120 }}
  x_axis={{ label: `Element` }}
  y_axis={{ label: `Property` }}
  style="height: 400px"
/>
```
