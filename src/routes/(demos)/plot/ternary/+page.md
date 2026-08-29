# Ternary Plot

Compositions of three components drawn in a barycentric triangle: alloy and glass compositions, mixing paths, phase-field sampling, or any three-way part-of-whole. Each point is a triple of amounts in the order of the corner `labels` and is normalized per point, so raw counts, fractions and percentages all land in the right spot. Points and lines sit on the same triangle as the [convex hull](/convex-hull) and the isothermal [phase diagram](/phase-diagram) sections: the first component at the right corner, the second at the apex, the third at the left.

## Basic ternary

Every series draws one marker per triple. Hover a marker for its fractions, click legend entries to hide series, and use the arrow keys to walk the markers by keyboard.

```svelte example
<script lang="ts">
  import { TernaryPlot, type TernarySeries } from 'matterviz'

  const series: TernarySeries[] = [
    {
      label: `Austenitic`,
      points: [
        [70, 18, 12],
        [68, 20, 12],
        [66, 22, 12],
        [72, 16, 12],
        [64, 24, 12],
      ],
    },
    {
      label: `Ferritic`,
      points: [
        [85, 12, 3],
        [82, 17, 1],
        [88, 11, 1],
        [80, 18, 2],
      ],
    },
    {
      label: `Duplex`,
      points: [
        [70, 22, 8],
        [72, 22, 6],
        [68, 24, 8],
      ],
    },
  ]
</script>

<TernaryPlot {series} labels={[`Fe`, `Cr`, `Ni`]} style="height: 420px" />
```

## Composition path

`markers: 'line+points'` connects a series' points in order, so a mixing path or a synthesis trajectory reads as a route through the triangle. `line_style` takes `color`, `width` and `dash`.

```svelte example
<script lang="ts">
  import { TernaryPlot, type TernarySeries } from 'matterviz'

  // Linear mixing from pure Li2O towards an equal-parts melt, then towards silica
  const path = Array.from({ length: 11 }, (_, idx) => {
    const frac = idx / 10
    return [frac / 3, 1 - frac + frac / 3, frac / 3] as [number, number, number]
  })
  const silica_leg = Array.from({ length: 6 }, (_, idx) => {
    const frac = idx / 5
    return [1 / 3 + (2 / 3) * frac, (1 - frac) / 3, (1 - frac) / 3] as [number, number, number]
  })

  const series: TernarySeries[] = [
    {
      label: `Mixing path`,
      markers: `line+points`,
      points: [...path, ...silica_leg.slice(1)],
      line_style: { width: 2 },
      point_style: { radius: 3 },
    },
    {
      label: `Endmembers`,
      markers: `points`,
      points: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      point_style: { radius: 6, symbol_type: `Diamond` },
      color: `#e15759`,
    },
  ]
</script>

<TernaryPlot
  {series}
  labels={[`SiO2`, `Li2O`, `Al2O3`]}
  grid_step={0.2}
  tick_format=".1f"
  style="height: 420px"
/>
```

## Points colored by a property

`color_values` maps a number per point through `color_scale` (any d3 interpolator name, an interpolator function or a `{ fn }` mapping values straight to colors) and draws a color bar below the triangle. `color_range` fixes the span; it defaults to the min/max of every visible series. Null entries fall back to the series color.

```svelte example
<script lang="ts">
  import { TernaryPlot, type TernarySeries } from 'matterviz'

  // A simulated hull-distance landscape sampled on a composition grid
  const points: [number, number, number][] = []
  const color_values: number[] = []
  const step = 0.1
  for (let idx_a = 0; idx_a <= 10; idx_a++) {
    for (let idx_b = 0; idx_b <= 10 - idx_a; idx_b++) {
      const frac_a = idx_a * step
      const frac_b = idx_b * step
      const frac_c = 1 - frac_a - frac_b
      points.push([frac_a, frac_b, frac_c])
      // lowest near the A2B and BC stoichiometries, rising elsewhere
      const to_a2b = Math.hypot(frac_a - 2 / 3, frac_b - 1 / 3, frac_c)
      const to_bc = Math.hypot(frac_a, frac_b - 0.5, frac_c - 0.5)
      color_values.push(Math.min(to_a2b, to_bc) * 0.8)
    }
  }
  const series: TernarySeries[] = [{ label: `Grid`, points, color_values }]
</script>

<TernaryPlot
  {series}
  labels={[`Mg`, `Si`, `O`]}
  color_scale="interpolateMagma"
  color_bar={{ title: `E above hull (eV/atom)`, tick_format: `.2f` }}
  style="height: 460px"
/>
```

## Custom tooltip and click handling

The `tooltip` snippet and the `on_point_click` / `on_point_hover` callbacks receive the point's `series_label`, `amounts` (as given), `fractions` (normalized), `color`, `color_value` and its `metadata` entry. `metadata` may be one object per series or an array with one entry per point.

```svelte example
<script lang="ts">
  import { format_num, TernaryPlot, type TernarySeries } from 'matterviz'

  type Sample = { id: string; sintered_at: number }
  let selected = $state<string | null>(null)

  const series: TernarySeries<Sample>[] = [
    {
      label: `Sintered pellets`,
      points: [
        [0.5, 0.3, 0.2],
        [0.4, 0.4, 0.2],
        [0.3, 0.5, 0.2],
        [0.45, 0.25, 0.3],
      ],
      metadata: [
        { id: `P-01`, sintered_at: 1150 },
        { id: `P-02`, sintered_at: 1200 },
        { id: `P-03`, sintered_at: 1250 },
        { id: `P-04`, sintered_at: 1100 },
      ],
      point_style: { radius: 6, symbol_type: `Square` },
    },
  ]
</script>

<TernaryPlot
  {series}
  labels={[`BaO`, `TiO2`, `SrO`]}
  tick_format=".2f"
  on_point_click={({ metadata }) => (selected = metadata?.id ?? null)}
  style="height: 400px"
>
  {#snippet tooltip({ metadata, fractions, series_label })}
    <strong>{metadata?.id}</strong> ({series_label})<br />
    sintered at {metadata?.sintered_at} °C<br />
    Ba : Ti : Sr = {fractions.map((frac) => format_num(frac, `.2f`)).join(` : `)}
  {/snippet}
</TernaryPlot>
<p>Selected: {selected ?? `click a marker`}</p>
```

## Props

| Prop             | Type                                  | Default                        | Description                                                                         |
| ---------------- | ------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `series`         | `TernarySeries[]`                     | `[]`                           | Series of composition triples; see the fields below.                                |
| `labels`         | `[string, string, string]`            | `['A', 'B', 'C']`              | Corner labels in triple order: right, top, left.                                    |
| `grid_step`      | `number`                              | `0.1`                          | Fraction between grid lines and ticks; `0` draws neither.                           |
| `show_grid`      | `boolean`                             | `true`                         | Draw the constant-fraction grid lines.                                              |
| `show_ticks`     | `boolean`                             | `true`                         | Draw tick marks and labels along the edges.                                         |
| `tick_format`    | `string`                              | `'.0%'`                        | d3-format spec for tick labels and tooltip fractions (values in `[0, 1]`).          |
| `color_scale`    | `ColorBarScale`                       | `'interpolateViridis'`         | Scale for `color_values`.                                                           |
| `color_range`    | `[number, number]`                    | data min/max                   | Span of the color scale.                                                            |
| `color_bar`      | `ColorBar` props or `null`            | `{}`                           | Color bar settings; `null` hides it.                                                |
| `legend`         | `LegendConfig` or `null`              | `{}`                           | Legend settings; shown automatically with two or more series, `show_legend` forces. |
| `tooltip`        | `Snippet<[TernaryPointProps]>`        |                                | Replaces the default fractions tooltip.                                             |
| `on_point_click` | `(props & { event }) => void`         |                                | Click or Enter/Space on a marker.                                                   |
| `on_point_hover` | `(props & { event } \| null) => void` |                                | Hover or focus enter/leave; `null` on leave.                                        |
| `padding`        | `Sides`                               | `{t: 30, b: 34, l: 50, r: 50}` | Space around the triangle for corner and tick labels.                               |

`TernarySeries` fields: `points` (triples), `label`, `color`, `markers` (`'points'` default, `'line'`, `'line+points'`), `point_style` (one `PointStyle` or one per point), `line_style`, `color_values`, `metadata`, `visible`, `id`.

The geometry helpers are exported too: `ternary_fractions`, `ternary_to_xy`, `xy_to_ternary`, `inside_triangle`, `ternary_grid_lines` and `ternary_layout`.
