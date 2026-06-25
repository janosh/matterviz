# Box Plot

`BoxPlot` summarizes one or more raw numeric distributions as boxes (interquartile range), median lines, whiskers, and optional outlier points. Each series is one box; quartiles and whiskers are computed internally from the raw `y` array, so you only pass the data.

## Basic Usage

Pass one `BoxPlotSeries` per distribution. Use the controls (gear icon) to switch orientation, whisker mode, and toggle outliers/mean. Opt into `marginals` to pair each box with the full distribution shape on the value axis (a per-series KDE here) — the same `marginals` API shared across all 2D plots ([full reference](/plot/scatter-plot#marginal-distributions)):

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'

  // Simple seeded normal-ish distributions for the demo
  const make_dist = (seed, n = 250, center = 0, spread = 1) => {
    let state = seed
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      const u2 = next()
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    })
  }

  const series = [
    { y: make_dist(1, 250, 0, 1), label: `A`, color: `#4c6ef5` },
    { y: make_dist(2, 250, 0.4, 1.5), label: `B`, color: `#fa5252` },
    { y: make_dist(3, 250, -0.3, 0.7), label: `C`, color: `#40c057` },
  ]
</script>

<BoxPlot
  {series}
  x_axis={{ label: `Model` }}
  y_axis={{ label: `Error` }}
  marginals={{ right: { type: `kde`, size: 90 } }}
  style="height: 400px"
/>
```

## Whisker Modes

Whiskers are configurable via `whisker_mode`:

- `tukey` (default): whiskers extend to the most extreme point within `1.5 * IQR` of the quartiles; points beyond are drawn as outliers.
- `minmax`: whiskers reach the data extremes (no outliers).
- `percentile`: whiskers at `whisker_percentiles` (default `[5, 95]`); points beyond are outliers.
- `std`: whiskers at `mean ± whisker_range * std`.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'

  const make_dist = (seed, n = 300, center = 0, spread = 1) => {
    let state = seed
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      const u2 = next()
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    })
  }

  // Add a few extreme values so the modes look visibly different
  const data = [...make_dist(5, 300, 0, 1), 6, 7, -6, -7]
  const series = [
    { y: data, label: `Tukey`, color: `#4c6ef5`, whisker_mode: `tukey` },
    { y: data, label: `Min/Max`, color: `#fa5252`, whisker_mode: `minmax` },
    { y: data, label: `5/95 pct`, color: `#40c057`, whisker_mode: `percentile` },
    { y: data, label: `Std Dev`, color: `#f59f00`, whisker_mode: `std` },
  ]
</script>

<BoxPlot
  {series}
  show_mean
  x_axis={{ label: `Whisker mode` }}
  y_axis={{ label: `Value` }}
  style="height: 400px"
/>
```

## Median Labels and Colored Category Labels

Set `show_value_labels` to print the median (or mean, via `value_label_stat`) above each box. Category tick labels are automatically colored to match each box, and axis labels accept HTML (e.g. `<sub>` subscripts). This reproduces the style of matbench-discovery's error box plot.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'

  const make_dist = (seed, n = 300, center = 0, spread = 1) => {
    let state = seed
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    return Array.from({ length: n }, () => {
      const u1 = Math.max(next(), 1e-9)
      const u2 = next()
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    })
  }

  const colors = [`#636EFA`, `#EF553B`, `#00CC96`, `#AB63FA`, `#FFA15A`]
  const names = [`eSEN`, `eqV2`, `SevenNet`, `DPA3`, `GRACE`]
  const series = names.map((label, idx) => ({
    y: make_dist(idx + 1, 300, idx * 0.01, 0.04 + idx * 0.01),
    label,
    color: colors[idx],
  }))
</script>

<BoxPlot
  {series}
  show_value_labels
  value_label_format=".2~g"
  show_legend={false}
  x_axis={{ label: `Model` }}
  y_axis={{ label: `Error in E<sub>hull dist</sub> (eV/atom)`, format: `.3` }}
  style="height: 420px"
/>
```

## Precomputed Quantiles (5-percentile bridge)

`BoxPlot` always computes quantiles from raw data, but you rarely need to ship a full distribution to the browser. Because the quantile interpolation is type-7 (linear), passing exactly five values `[p05, p25, p50, p75, p95]` as the `y` array with `whisker_mode: 'minmax'` reproduces a box whose whiskers sit at the 5th/95th percentiles and whose quartiles/median land exactly on the supplied values — the same trick Plotly box plots use, with a tiny payload.

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'

  // [p05, p25, median, p75, p95] per model (precomputed server-side)
  const series = [
    { y: [-0.04, -0.004, 0, 0.005, 0.02], label: `eSEN`, color: `#636EFA` },
    { y: [-0.023, -0.003, 0.001, 0.006, 0.042], label: `eqV2`, color: `#EF553B` },
    { y: [-0.046, -0.009, -0.001, 0.006, 0.029], label: `SevenNet`, color: `#00CC96` },
    { y: [-0.049, -0.01, 0, 0.008, 0.038], label: `GRACE`, color: `#AB63FA` },
  ]
</script>

<BoxPlot
  {series}
  whisker_mode="minmax"
  show_value_labels
  value_label_format=".2~g"
  show_legend={false}
  x_axis={{ label: `Model` }}
  y_axis={{ label: `Error in E<sub>hull dist</sub> (eV/atom)`, format: `.3` }}
  style="height: 420px"
/>
```

## Horizontal Orientation

Set `orientation="horizontal"` to lay boxes out along the value axis (categories on the y-axis). The `marginals` strip transposes with the plot — the per-series KDE flips from the right (vertical) to the top (horizontal) so it always summarizes the value axis:

```svelte example
<script lang="ts">
  import { BoxPlot } from 'matterviz'

  const series = [
    { y: [2, 4, 5, 5, 6, 7, 7, 8, 9, 12], label: `A`, color: `#4c6ef5` },
    { y: [1, 3, 4, 6, 6, 7, 8, 10, 11, 16], label: `B`, color: `#fa5252` },
    { y: [3, 4, 4, 5, 5, 5, 6, 6, 7, 8], label: `C`, color: `#40c057` },
  ]
</script>

<BoxPlot
  {series}
  orientation="horizontal"
  x_axis={{ label: `Error` }}
  y_axis={{ label: `Model` }}
  marginals={{ top: { type: `kde`, size: 90 } }}
  style="height: 360px"
/>
```
