# Bar Plot

## Crystal Structure Analysis

Lattice parameters across materials. Gear controls cover orientation, modes, and grid; the plot also uses rounded corners (`border_radius`) and bar borders (`stroke_color`, `stroke_width`):

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const lattice_params = [
    {
      x: [`Diamond`, `NaCl`, `Si`, `GaAs`, `GaN`, `ZnO`, `CdTe`],
      y: [3.52, 4.05, 5.43, 6.08, 3.89, 4.95, 5.65],
      label: `Lattice Parameter a (Å)`,
      color: `#4c6ef5`,
    },
  ]
</script>

<BarPlot
  series={lattice_params}
  bar={{ border_radius: 4, stroke_color: `#364fc7`, stroke_width: 1.5 }}
  x_axis={{ label: `Material` }}
  y_axis={{ label: `Lattice Parameter (Å)` }}
  style="height: 400px"
/>
```

## Categorical Bar Charts

Pass string categories directly as `x` values instead of numeric indices. Categories are automatically detected, positioned, and labeled on the axis. Multiple series with different categories are aligned correctly for stacking and grouping. Use `x_axis.categories` to control category order:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  let mode = $state(`grouped`)
  let orientation = $state(`vertical`)
  let custom_order = $state(false)

  const band_gaps = [
    {
      x: [`Si`, `GaAs`, `GaN`, `ZnO`, `Diamond`],
      y: [1.12, 1.43, 3.4, 3.37, 5.47],
      label: `Experimental`,
      color: `#4c6ef5`,
    },
    {
      x: [`Si`, `GaAs`, `GaN`, `ZnO`, `Diamond`, `CdTe`],
      y: [0.56, 0.55, 1.87, 0.73, 4.14, 0.58],
      label: `DFT (PBE)`,
      color: `#ff6b6b`,
    },
    {
      x: [`Si`, `GaAs`, `Diamond`],
      y: [1.17, 1.52, 5.48],
      label: `GW Calculation`,
      color: `#51cf66`,
    },
  ]

  let x_axis = $derived({
    label: orientation === `horizontal` ? `Band Gap (eV)` : `Semiconductor`,
    categories: custom_order ? [`Diamond`, `GaN`, `ZnO`, `GaAs`, `CdTe`, `Si`] : undefined,
  })
  let y_axis = $derived({
    label: orientation === `horizontal` ? `Semiconductor` : `Band Gap (eV)`,
  })
</script>

<div
  style="display: flex; gap: 1.5em; margin-bottom: 1em; flex-wrap: wrap; align-items: center"
>
  {#each [`grouped`, `stacked`, `overlay`] as m (m)}
    <label><input type="radio" bind:group={mode} value={m} /> {m}</label>
  {/each}
  <label style="margin-left: 1em">
    <input type="checkbox" bind:checked={custom_order} /> Sort by band gap
  </label>
  <label>
    <input
      type="checkbox"
      checked={orientation === `horizontal`}
      onchange={(evt) => (orientation = evt.currentTarget.checked ? `horizontal` : `vertical`)}
    /> Horizontal
  </label>
</div>

<BarPlot series={band_gaps} {mode} {orientation} {x_axis} {y_axis} style="height: 400px" />
```

Series can have **different categories**: DFT (PBE) includes CdTe while GW only covers three materials. Missing categories are zero-height bars in stacked mode, and absent in grouped mode.

## Automatic Tick Label Layout

Long category names no longer collide or waste most of the chart on a deep rotated-label gutter. `x`/`x2` tick labels default to `rotation: 'auto'`, which balances lines at semantic boundaries (spaces, separators, and camel case), tilts them only when needed (30°, 45°, 60°, then 90°), and prefers wrapping when it avoids a steeper tilt or substantially reduces the label band. Padding follows the chosen layout as the plot resizes.

Automatic wrapping uses at most three lines by default; set `tick.label.max_lines` to another limit or to `1` to disable wrapping. Labels that still need rotation trail up-and-to-the-**left** of their tick, so the last one can't run off the right edge. Which sign achieves that depends on the side of the baseline the labels sit on: tick **Labels inside** to move them above it and watch the tilt mirror. Set `rotation: 0` to force labels upright and unwrapped, or pass an explicit angle to override the automatic layout entirely:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const routes = [
    `Solid-State Sintering`,
    `Sol-Gel`,
    `Hydrothermal`,
    `Chemical Vapor Deposition`,
    `Molecular Beam Epitaxy`,
    `Spark Plasma Sintering`,
    `Mechanochemical Milling`,
    `Flux Growth`,
    `Czochralski Pulling`,
    `Electrodeposition`,
    `Atomic Layer Deposition`,
    `Pulsed Laser Deposition`,
    `Magnetron Sputtering`,
    `Solvothermal`,
    `Arc Melting`,
    `Combustion Synthesis`,
  ]
  const sample_counts = routes.map((_route, idx) => Math.round(420 * 0.9 ** idx) + 20)

  let n_categories = $state(5)
  let rotation = $state(`auto`)
  let inside = $state(false)

  let series = $derived([
    {
      x: routes.slice(0, n_categories),
      y: sample_counts.slice(0, n_categories),
      color: `#4c6ef5`,
    },
  ])
  let x_axis = $derived({
    label: `Synthesis Route`,
    tick: { label: { rotation, inside } },
  })
</script>

<div
  style="display: flex; gap: 1.5em; margin-bottom: 1em; flex-wrap: wrap; align-items: center"
>
  <label>
    Categories: {n_categories}
    <input
      type="range"
      bind:value={n_categories}
      min="2"
      max={routes.length}
      style="width: 120px"
    />
  </label>
  <label>
    Rotation:
    <select bind:value={rotation}>
      {#each [`auto`, 0, -45, 45, 90] as angle (angle)}
        <option value={angle}>{angle === `auto` ? `auto` : `${angle}°`}</option>
      {/each}
    </select>
  </label>
  <label><input type="checkbox" bind:checked={inside} /> Labels inside</label>
</div>

<BarPlot {series} {x_axis} y_axis={{ label: `Samples` }} style="height: 400px" />
```

## Mode Comparison: Band Gap Measurements

Compare overlay, stacked, and grouped (side-by-side) modes using band gap data from different measurement techniques. Click legend items to toggle series visibility:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const materials = [`Si`, `GaAs`, `GaN`, `ZnO`, `Diamond`]
  const band_gaps = [
    {
      x: materials,
      y: [1.12, 1.43, 2.26, 3.4, 5.47],
      label: `Optical Absorption`,
      color: `#4c6ef5`,
    },
    {
      x: materials,
      y: [0.95, 1.25, 1.85, 2.98, 4.82],
      label: `Photoluminescence`,
      color: `#ff6b6b`,
    },
    {
      x: materials,
      y: [1.28, 1.62, 2.58, 3.75, 6.15],
      label: `DFT Calculation`,
      color: `#51cf66`,
    },
  ]

  let mode = $state(`grouped`)
</script>

<div style="margin-bottom: 1em; display: flex; gap: 1em; align-items: center">
  <label style="display: flex; align-items: center; gap: 4px"
    ><input type="radio" bind:group={mode} value="overlay" /> Overlay</label
  >
  <label style="display: flex; align-items: center; gap: 4px"
    ><input type="radio" bind:group={mode} value="stacked" /> Stacked (Sum)</label
  >
  <label style="display: flex; align-items: center; gap: 4px"
    ><input type="radio" bind:group={mode} value="grouped" /> Grouped (Side-by-Side)</label
  >
</div>

<BarPlot
  series={band_gaps}
  {mode}
  x_axis={{ label: `Material` }}
  y_axis={{ label: `Band Gap (eV)` }}
  style="height: 400px"
/>
```

## Reaction Kinetics with Dual Y-Axes

Combine bars and lines with **dual y-axes** to show product formation alongside temperature. Temperature uses the right y2-axis with independent scaling. Line series support **marker symbols** using the `markers` prop (`line`, `points`, or `line+points`):

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const reaction_data = [
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [0, 12, 28, 45, 58, 67, 72],
      label: `Product A (mol)`,
      color: `#4c6ef5`,
    },
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [0, 8, 19, 32, 41, 48, 52],
      label: `Product B (mol)`,
      color: `#51cf66`,
    },
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [25, 80, 120, 140, 145, 142, 138],
      label: `Temperature (°C)`,
      color: `#ff6b6b`,
      render_mode: `line`,
      y_axis: `y2`,
      markers: `line+points`, // Show both line and marker points
      line_style: { stroke_width: 2, line_dash: `5,5` },
      point_style: { radius: 5, stroke: `white`, stroke_width: 2 },
    },
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [0, 20, 47, 77, 99, 115, 124],
      label: `Total Yield (mol)`,
      color: `#ffd43b`,
      render_mode: `line`,
      markers: `line+points`, // Show both line and marker points
      line_style: { stroke_width: 2 },
      point_style: { radius: 6, symbol_type: `Diamond` },
    },
  ]
</script>

<BarPlot
  series={reaction_data}
  mode="stacked"
  x_axis={{ label: `Time (minutes)` }}
  y_axis={{ label: `Product Amount (mol)` }}
  y2_axis={{ label: `Temperature (°C)`, format: `.0r` }}
  style="height: 450px"
/>
```

## Sales vs Profit Margin (Dual Y-Axes)

A classic business use case: comparing raw sales (bars, left axis) with profit margins (line, right axis) that have different scales and units. The line uses `markers: 'line+points'` with custom `point_style` for triangle markers:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const quarters = [`Q1-22`, `Q2-22`, `Q3-22`, `Q4-22`, `Q1-23`, `Q2-23`, `Q3-23`, `Q4-23`]
  const quarterly_data = [
    {
      x: quarters,
      y: [125000, 142000, 158000, 171000, 165000, 189000, 203000, 218000],
      label: `Sales Revenue ($)`,
      color: `#4c6ef5`,
    },
    {
      x: quarters,
      y: [12.5, 15.2, 18.3, 14.8, 13.1, 19.5, 21.2, 23.8],
      label: `Profit Margin (%)`,
      color: `#51cf66`,
      render_mode: `line`,
      y_axis: `y2`,
      markers: `line+points`,
      line_style: { stroke_width: 2 },
      point_style: {
        radius: 6,
        symbol_type: `Triangle`,
        stroke: `#2f9e44`,
        stroke_width: 2,
      },
      point_hover: { scale: 1.8, brightness: 1.3 },
    },
  ]
</script>

<BarPlot
  series={quarterly_data}
  x_axis={{ label: `Quarter` }}
  y_axis={{ label: `Revenue ($)`, format: `$,.0f` }}
  y2_axis={{ label: `Margin (%)`, format: `.1r` }}
  style="height: 400px"
/>
```

## Element Abundance in Earth's Crust

Horizontal bars suit long category labels. `tick.label.inside` puts tick labels inside the plot for a tighter layout:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const abundances = [
    {
      x: [
        `Oxygen`,
        `Silicon`,
        `Aluminum`,
        `Iron`,
        `Calcium`,
        `Sodium`,
        `Magnesium`,
        `Potassium`,
      ],
      y: [461000, 277200, 82300, 50000, 41500, 26000, 23600, 20900],
      label: `Abundance (ppm)`,
      color: `#845ef7`,
    },
  ]

  let orientation = $state(`horizontal`)
  let inside = $state(false)

  // Categories sit on y when horizontal, on x when vertical, so the axis titles swap with it
  let cat_axis = $derived({ label: `Element`, tick: { label: { inside } } })
  let val_axis = $derived({
    label: `Abundance (ppm)`,
    format: `~s`,
    tick: { label: { inside } },
  })
</script>

<label style="margin-bottom: 1em; display: inline-block">
  <input
    type="checkbox"
    checked={orientation === `horizontal`}
    onchange={(evt) => (orientation = evt.currentTarget.checked ? `horizontal` : `vertical`)}
  />
  Horizontal Orientation
</label>
<label style="margin-bottom: 1em; display: inline-block; margin-left: 2em">
  <input type="checkbox" bind:checked={inside} />
  Tick Labels Inside
</label>

<BarPlot
  series={abundances}
  {orientation}
  x_axis={orientation === `horizontal` ? val_axis : cat_axis}
  y_axis={orientation === `horizontal` ? cat_axis : val_axis}
  style="height: 400px"
/>
```

## Phase Stability with Interactive Tooltips

Add rich interactivity with custom tooltips, hover effects, and click handlers:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const temps = [`300K`, `500K`, `700K`, `900K`, `1100K`]
  const phase_stability = [
    {
      x: temps,
      y: [85, 92, 78, 95, 88],
      label: `α-phase`,
      color: `#5c7cfa`,
      metadata: [
        { phase: `α-phase`, structure: `FCC`, stability: `High` },
        { phase: `α-phase`, structure: `FCC`, stability: `Very High` },
        { phase: `α-phase`, structure: `FCC`, stability: `Medium` },
        { phase: `α-phase`, structure: `FCC`, stability: `Very High` },
        { phase: `α-phase`, structure: `FCC`, stability: `High` },
      ],
    },
    {
      x: temps,
      y: [70, 75, 88, 82, 90],
      label: `β-phase`,
      color: `#ff6b6b`,
      metadata: [
        { phase: `β-phase`, structure: `BCC`, stability: `Medium` },
        { phase: `β-phase`, structure: `BCC`, stability: `Medium` },
        { phase: `β-phase`, structure: `BCC`, stability: `High` },
        { phase: `β-phase`, structure: `BCC`, stability: `High` },
        { phase: `β-phase`, structure: `BCC`, stability: `Very High` },
      ],
    },
  ]

  let clicked_info = $state(`Click a bar to see phase details`)
  let hovered_info = $state(`Hover over a bar`)

  // Handlers get `category_label` alongside metadata for string-valued x
  function handle_click(data) {
    const { metadata, category_label, y } = data
    clicked_info = `${metadata.phase} at ${category_label}: ${metadata.structure} structure, ${y}% stable (${metadata.stability})`
  }

  function handle_hover(data) {
    if (data) {
      const { metadata, category_label, y } = data
      hovered_info = `${metadata.phase} at ${category_label}: ${y}% stability`
    } else hovered_info = `Hover over a bar`
  }

  const info_style = `margin: 1em 0; padding: 4pt 8pt; background: rgba(255,255,255,0.1); border-radius: var(--border-radius); font-size: 0.9em`
</script>

<BarPlot
  series={phase_stability}
  mode="grouped"
  x_axis={{ label: `Temperature` }}
  y_axis={{ label: `Stability (%)` }}
  on_bar_click={handle_click}
  on_bar_hover={handle_hover}
  style="height: 400px"
>
  {#snippet tooltip({ metadata, category_label, y })}
    <div style="font-weight: 600">{metadata.phase}</div>
    <div>Temp: {category_label}</div>
    <div>Structure: {metadata.structure}</div>
    <div>Stability: {y}% ({metadata.stability})</div>
  {/snippet}
</BarPlot>

<div style={info_style}>
  <strong>Clicked:</strong>
  {clicked_info}
</div>
<div style={info_style}>
  <strong>Hovered:</strong>
  {hovered_info}
</div>
```

## Arcsinh Scale: Large Range with Positive and Negative Values

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const scale_types = [`linear`, `log`, `arcsinh`]
  let y_scale_type = $state(`arcsinh`)
  let arcsinh_threshold = $state(1)

  // Data with wide range: negative to positive, varying magnitudes.
  // String x values make the axis categorical, so ticks are the element symbols.
  const energy_data = [
    {
      x: [`Mg`, `Ca`, `Li`, `Na`, `K`, `Rb`, `Cs`, `Fr`],
      y: [-500, -50, -5, -0.5, 0.5, 5, 50, 500],
      label: `Energy (eV)`,
      color: `#4c6ef5`,
    },
  ]

  let y_axis = $derived({
    label: `Energy (${y_scale_type})`,
    scale_type:
      y_scale_type === `arcsinh`
        ? { type: `arcsinh`, threshold: arcsinh_threshold }
        : y_scale_type,
  })
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap; align-items: center">
  <fieldset>
    <legend>Y-axis Scale</legend>
    {#each scale_types as scale (scale)}
      <label style="margin-right: 0.5em">
        <input type="radio" bind:group={y_scale_type} value={scale} />
        {scale}
      </label>
    {/each}
  </fieldset>

  {#if y_scale_type === `arcsinh`}
    <label>
      Threshold: {arcsinh_threshold}
      <input type="range" bind:value={arcsinh_threshold} min="0.1" max="10" step="0.1" />
    </label>
  {/if}
</div>

<BarPlot series={energy_data} x_axis={{ label: `Element` }} {y_axis} style="height: 400px">
  {#snippet tooltip({ y, category_label })}
    <strong>{category_label}</strong><br />
    Energy: {y.toLocaleString()} eV
  {/snippet}
</BarPlot>
```

## Formation Energy Diagram

Bar plots handle negative values automatically and keep a value-axis zero line for reference. Categorical axes omit their zero line by default (toggle it in the settings pane if needed). The threshold line uses `markers: 'line'` to show only the line without marker points:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const compounds = [`TiO₂`, `CuO`, `Al₂O₃`, `Fe₂O₃`, `MgO`, `ZnO`, `NiO`, `FeO`]
  const formation_energies = [
    {
      x: compounds,
      y: [-2.45, 1.28, -1.82, 0.95, -3.12, 2.01, -0.67, -1.93],
      label: `Formation Energy`,
      color: `#4c6ef5`,
    },
    {
      x: compounds,
      y: [-2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0],
      label: `Stability Threshold`,
      color: `#51cf66`,
      render_mode: `line`,
      markers: `line`, // Line only, no marker points
      line_style: {
        stroke_width: 2,
        line_dash: `8,4`,
      },
    },
  ]
</script>

<BarPlot
  series={formation_energies}
  x_axis={{ label: `Compound` }}
  y_axis={{ label: `Formation Energy (eV/atom)` }}
  style="height: 400px"
/>
```

## Material Properties Over Time with Dual Axes

Custom formatting, tick control, and **dual y-axes** showing both material counts and computational performance metrics:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const yearly_data = [
    {
      x: [1990, 1995, 2000, 2005, 2010, 2015, 2020],
      y: [120000, 185000, 275000, 420000, 680000, 1050000, 1600000],
      label: `Materials in Database`,
      color: `#4c6ef5`,
    },
    {
      x: [1990, 1995, 2000, 2005, 2010, 2015, 2020],
      y: [0.5, 2.3, 8.5, 28, 95, 340, 1200],
      label: `Compute Power (TFLOPS)`,
      color: `#ff6b6b`,
      render_mode: `line`,
      y_axis: `y2`,
      line_style: {
        stroke_width: 3,
        line_dash: `6,3`,
      },
    },
  ]

  let x_axis = $state({ label: `Year`, format: `d`, ticks: 7 })
  let y_axis = $state({ label: `Number of Materials`, format: `.2s`, ticks: 6 })
  let y2_axis = $state({ label: `Compute Power (TFLOPS)`, format: `.2s`, ticks: 6 })
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap">
  <label>
    X Format:
    <select bind:value={x_axis.format}>
      <option value="d">Integer (2020)</option>
      <option value=".0f">Float (2020.0)</option>
    </select>
  </label>
  <label>
    Y1 Format:
    <select bind:value={y_axis.format}>
      <option value=".2s">Short (1.6M)</option>
      <option value=",.0f">Full (1,600,000)</option>
      <option value=".3s">Precise (1.60M)</option>
    </select>
  </label>
  <label>
    Y2 Format:
    <select bind:value={y2_axis.format}>
      <option value=".0f">Integer (1200)</option>
      <option value=".2s">Short (1.2k)</option>
      <option value=".1f">Decimal (1200.0)</option>
    </select>
  </label>
  <label>
    X Ticks: {x_axis.ticks}
    <input type="range" bind:value={x_axis.ticks} min="3" max="10" style="width: 100px" />
  </label>
</div>

<BarPlot series={yearly_data} {x_axis} {y_axis} {y2_axis} style="height: 400px" />
```

## Spectroscopy Data with Zoom

Zoom and pan on a larger dataset (drag to zoom, double-click to reset). Line markers use **color scaling** via `color_values` and `color_scale`:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  // oxfmt-ignore
  const absorption_data = [
    0.05, 0.12, 0.28, 0.65, 1.45, 2.8, 4.2, 3.5, 2.1, 0.95, 0.38, 0.15, 0.06,
  ]
  // oxfmt-ignore
  const theoretical_data = [
    0.02, 0.08, 0.22, 0.58, 1.35, 2.65, 4.0, 3.3, 1.95, 0.85, 0.32, 0.12, 0.05,
  ]

  const spectroscopy = [
    {
      x: [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800],
      y: absorption_data,
      label: `Absorption Spectrum`,
      color: `#4c6ef5`,
    },
    {
      x: [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800],
      y: theoretical_data,
      label: `Theoretical Fit`,
      color: `#ff6b6b`,
      render_mode: `line`,
      markers: `line+points`,
      // Color each point by its y-value using color_values
      color_values: theoretical_data,
      line_style: { stroke_width: 2 },
      point_style: { radius: 5, stroke: `white`, stroke_width: 1 },
    },
  ]
</script>

<div
  style="margin-bottom: 1em; padding: 8pt; background: rgba(255, 255, 255, 0.05); border-radius: 4px"
>
  <strong>Instructions:</strong> Click and drag to zoom into a wavelength region. Double-click to
  reset the view. Marker colors show intensity via color scale.
</div>

<BarPlot
  series={spectroscopy}
  x_axis={{ label: `Wavelength (nm)` }}
  y_axis={{ label: `Absorption Coefficient` }}
  color_scale={{ scheme: `interpolatePlasma` }}
  style="height: 450px"
/>
```

## Line Marker Customization

Line series support full marker customization including symbol types, sizes, colors, and hover effects. Use the `markers` prop to control visibility (`line`, `points`, `line+points`, or `none`), and `point_style` / `point_hover` for styling:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  let markers = $state(`line+points`)
  let symbol_type = $state(`Circle`)
  let radius = $state(6)

  const symbol_types = [`Circle`, `Square`, `Triangle`, `Diamond`, `Star`, `Cross`, `Wye`]

  // Efficiency measurements with size scaled by sample count
  const efficiency_data = [
    {
      x: [1, 2, 3, 4, 5, 6],
      y: [82, 85, 91, 88, 94, 97],
      label: `Device Efficiency (%)`,
      color: `#4c6ef5`,
    },
    {
      x: [1, 2, 3, 4, 5, 6],
      y: [78, 83, 87, 92, 95, 98],
      label: `Model Prediction`,
      color: `#f783ac`,
      render_mode: `line`,
      line_style: { stroke_width: 2 },
      // Size each point by sample count (more samples = larger marker)
      size_values: [10, 25, 50, 75, 100, 150],
      point_hover: { scale: 1.5, brightness: 1.2 },
    },
  ]

  let series = $derived(
    efficiency_data.map((srs) =>
      srs.render_mode === `line`
        ? {
            ...srs,
            markers,
            point_style: {
              symbol_type,
              radius,
              stroke: `white`,
              stroke_width: 2,
            },
          }
        : srs,
    ),
  )
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap; align-items: center">
  <label>
    Markers:
    <select bind:value={markers}>
      <option value="line+points">Line + Points</option>
      <option value="line">Line Only</option>
      <option value="points">Points Only</option>
      <option value="none">None</option>
    </select>
  </label>
  <label>
    Symbol:
    <select bind:value={symbol_type}>
      {#each symbol_types as sym (sym)}
        <option value={sym}>{sym}</option>
      {/each}
    </select>
  </label>
  <label>
    Size: {radius}
    <input type="range" bind:value={radius} min="3" max="12" style="width: 80px" />
  </label>
</div>

<BarPlot
  {series}
  x_axis={{ label: `Sample Batch` }}
  y_axis={{ label: `Efficiency (%)` }}
  size_scale={{ radius_range: [4, 12] }}
  style="height: 400px"
/>
```

## Reference Lines: Thresholds, Means, and Comparisons

Use `ref_lines` to add horizontal, vertical, and diagonal reference lines to bar plots. Toggle between threshold mode (performance tiers) and comparison mode (showing means for grouped bars):

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  let comparison_mode = $state(false)

  // Threshold mode: single series with performance tiers
  const efficiency_data = [
    {
      x: [`Dev A`, `Dev B`, `Dev C`, `Dev D`, `Dev E`, `Dev F`],
      y: [78, 92, 85, 88, 71, 95],
      label: `Device Efficiency (%)`,
      color: `#4c6ef5`,
    },
  ]

  // Comparison mode: measured vs predicted
  const comparison_data = [
    {
      x: [1, 2, 3, 4, 5],
      y: [3.2, 5.1, 4.8, 6.2, 5.5],
      label: `Measured`,
      color: `#3498db`,
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [3.0, 4.8, 4.5, 6.5, 5.8],
      label: `Predicted`,
      color: `#e74c3c`,
    },
  ]
  const measured_mean = 4.96
  const predicted_mean = 4.92

  let series = $derived(comparison_mode ? comparison_data : efficiency_data)

  let ref_lines = $derived(
    comparison_mode
      ? [
          {
            type: `horizontal`,
            y: measured_mean,
            label: `Measured Mean`,
            style: { color: `#3498db`, width: 2, dash: `8 4` },
            annotation: {
              text: `μ = ${measured_mean.toFixed(2)}`,
              position: `start`,
              side: `above`,
            },
          },
          {
            type: `horizontal`,
            y: predicted_mean,
            label: `Predicted Mean`,
            style: { color: `#e74c3c`, width: 2, dash: `8 4` },
            annotation: {
              text: `μ = ${predicted_mean.toFixed(2)}`,
              position: `end`,
              side: `below`,
            },
          },
          {
            type: `diagonal`,
            slope: 1,
            intercept: 0,
            label: `Parity`,
            style: { color: `#7f8c8d`, width: 1, dash: `4 2` },
            z_index: `below-grid`,
          },
        ]
      : [
          {
            type: `horizontal`,
            y: 90,
            label: `Excellent`,
            style: { color: `#2ecc71`, width: 2 },
            annotation: { text: `Excellent (90%)`, position: `end`, side: `above` },
          },
          {
            type: `horizontal`,
            y: 80,
            label: `Good`,
            style: { color: `#f39c12`, width: 2, dash: `6 3` },
            annotation: { text: `Good (80%)`, position: `end`, side: `above` },
          },
          {
            type: `horizontal`,
            y: 70,
            label: `Minimum`,
            style: { color: `#e74c3c`, width: 2, dash: `4 4` },
            annotation: { text: `Minimum (70%)`, position: `end`, side: `below` },
          },
        ],
  )
</script>

<label style="margin-bottom: 1em; display: block">
  <input type="checkbox" bind:checked={comparison_mode} /> Comparison mode (grouped bars with means)
</label>

<BarPlot
  {series}
  {ref_lines}
  mode={comparison_mode ? `grouped` : `single`}
  x_axis={{ label: comparison_mode ? `Sample` : `Device` }}
  y_axis={{
    label: comparison_mode ? `Value` : `Efficiency (%)`,
    range: comparison_mode ? undefined : [0, 100],
  }}
  style="height: 400px"
/>
```

## Interactive Reference Lines on Bar Plot

Reference lines support hover effects and click handlers for interactivity:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const production_data = [
    {
      x: [`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`],
      y: [42, 38, 45, 52, 48, 55, 61, 58, 63, 67, 71, 75],
      label: `Monthly Production`,
      color: `#4c6ef5`,
    },
  ]

  let selected_target = $state(null)

  // x_span is in category-index units (Jan=0 ... Dec=11), so each quarter spans 3 slots
  const ref_lines = [
    {
      type: `horizontal`,
      y: 50,
      id: `q1_target`,
      label: `Q1 Target`,
      style: { color: `#e74c3c`, width: 2 },
      hover_style: { color: `#c0392b`, width: 4 },
      x_span: [-0.5, 2.5],
      annotation: { text: `Q1: 50`, position: `center`, side: `above` },
      on_click: () => (selected_target = `Q1 Target: 50 units`),
    },
    {
      type: `horizontal`,
      y: 55,
      id: `q2_target`,
      label: `Q2 Target`,
      style: { color: `#f39c12`, width: 2 },
      hover_style: { color: `#d68910`, width: 4 },
      x_span: [2.5, 5.5],
      annotation: { text: `Q2: 55`, position: `center`, side: `above` },
      on_click: () => (selected_target = `Q2 Target: 55 units`),
    },
    {
      type: `horizontal`,
      y: 65,
      id: `q3_target`,
      label: `Q3 Target`,
      style: { color: `#2ecc71`, width: 2 },
      hover_style: { color: `#27ae60`, width: 4 },
      x_span: [5.5, 8.5],
      annotation: { text: `Q3: 65`, position: `center`, side: `above` },
      on_click: () => (selected_target = `Q3 Target: 65 units`),
    },
    {
      type: `horizontal`,
      y: 75,
      id: `q4_target`,
      label: `Q4 Target`,
      style: { color: `#9b59b6`, width: 2 },
      hover_style: { color: `#7d3c98`, width: 4 },
      x_span: [8.5, 11.5],
      annotation: { text: `Q4: 75`, position: `center`, side: `above` },
      on_click: () => (selected_target = `Q4 Target: 75 units`),
    },
  ]
</script>

<BarPlot
  series={production_data}
  {ref_lines}
  x_axis={{ label: `Month` }}
  y_axis={{ label: `Production (units)`, range: [0, 85] }}
  style="height: 400px"
/>

<div style="margin-top: 0.5em; font-size: 0.9em">
  <strong>Selected:</strong>
  {selected_target ?? `Click a target line`}
</div>
```

## Legend Grouping

When comparing results from different computational methods or experimental techniques, you can organize legend items into collapsible groups using the `legend_group` property. Click the group header to toggle visibility of all series in that group, or click the chevron (▶) to collapse/expand the group:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  // Comparing formation energies from different methods
  const cathodes = [`LiCoO₂`, `LiFePO₄`, `Li₂MnO₃`, `LiNiO₂`, `LiMn₂O₄`]
  const grouped_series = [
    // DFT Methods group
    {
      x: cathodes,
      y: [-1.2, -0.8, -2.1, -1.5, -0.9],
      label: `PBE`,
      legend_group: `DFT`,
      color: `#3498db`,
    },
    {
      x: cathodes,
      y: [-1.4, -0.9, -2.3, -1.7, -1.1],
      label: `r2SCAN`,
      legend_group: `DFT`,
      color: `#2980b9`,
    },
    // ML Potentials group
    {
      x: cathodes,
      y: [-1.1, -0.7, -2.0, -1.4, -0.8],
      label: `MACE`,
      legend_group: `ML Potentials`,
      color: `#e74c3c`,
    },
    {
      x: cathodes,
      y: [-1.3, -0.85, -2.15, -1.55, -0.95],
      label: `CHGNet`,
      legend_group: `ML Potentials`,
      color: `#c0392b`,
    },
    // Experiment (ungrouped reference)
    {
      x: cathodes,
      y: [-1.25, -0.82, -2.05, -1.52, -0.88],
      label: `Experiment`,
      color: `#2ecc71`,
    },
  ]
</script>

<BarPlot
  series={grouped_series}
  mode="grouped"
  x_axis={{ label: `Compound` }}
  y_axis={{ label: `Formation Energy (eV/atom)` }}
  legend={{ draggable: true }}
  style="height: 400px"
/>
```

## Interactive Axis Labels with Complex Data

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  // Seeded random for reproducible data
  function seeded_random(seed) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Generate 50 materials with 7 properties each
  const n_materials = 50
  const rng = seeded_random(123)

  const crystal_systems = [`Cubic`, `Tetragonal`, `Orthorhombic`, `Hexagonal`, `Monoclinic`]
  const system_colors = [`#e74c3c`, `#3498db`, `#2ecc71`, `#f39c12`, `#9b59b6`]

  // Generate material data
  const materials = Array.from({ length: n_materials }, (_, idx) => {
    const system_idx = idx % 5
    return {
      id: idx + 1,
      name: `Mat-${String(idx + 1).padStart(3, `0`)}`,
      system: crystal_systems[system_idx],
      system_idx,
      band_gap: rng() * 6,
      formation_energy: -rng() * 4 - 0.5,
      density: 2 + rng() * 10,
      bulk_modulus: 20 + rng() * 400,
      thermal_conductivity: rng() * 500,
      melting_point: 500 + rng() * 3000,
      hardness: rng() * 10,
    }
  })

  // Property definitions
  const properties = {
    band_gap: { label: `Band Gap`, unit: `eV`, color: `#4c6ef5` },
    formation_energy: {
      label: `Formation Energy`,
      unit: `eV/atom`,
      color: `#ff6b6b`,
    },
    density: { label: `Density`, unit: `g/cm³`, color: `#51cf66` },
    bulk_modulus: { label: `Bulk Modulus`, unit: `GPa`, color: `#ffd43b` },
    thermal_conductivity: { label: `Thermal Cond.`, unit: `W/m·K`, color: `#20c997` },
    melting_point: { label: `Melting Point`, unit: `K`, color: `#fa5252` },
    hardness: { label: `Hardness`, unit: `Mohs`, color: `#7950f2` },
  }

  // Build series grouped by crystal system
  function build_series(prop_key) {
    return crystal_systems.map((system, sys_idx) => {
      const system_materials = materials.filter((material) => material.system === system)
      return {
        x: system_materials.map((material) => material.id),
        y: system_materials.map((material) => material[prop_key]),
        label: system,
        color: system_colors[sys_idx],
        labels: system_materials.map((material) => material.name),
      }
    })
  }

  // State
  let y_key = $state(`band_gap`)
  let series = $derived(build_series(y_key))
  let load_times = $state([])
  let switch_count = $state(0)
  let load_start = $state(0)

  async function data_loader(axis, property_key) {
    load_start = performance.now()
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 350))
    const prop = properties[property_key]
    return {
      series: build_series(property_key),
      axis_label: `${prop.label} (${prop.unit})`,
    }
  }

  function on_axis_change(axis, property_key) {
    switch_count++
    y_key = property_key
    load_times = [...load_times.slice(-9), Math.round(performance.now() - load_start)]
  }

  // Y-axis options
  const y_options = Object.entries(properties).map(([key, prop]) => ({
    key,
    label: prop.label,
    unit: prop.unit,
  }))

  // Stats
  let avg_load_time = $derived(
    load_times.length > 0
      ? Math.round(
          load_times.reduce((sum, load_time) => sum + load_time, 0) / load_times.length,
        )
      : 0,
  )
</script>

<div style="margin-bottom: 0.5em; font-size: 0.8em; opacity: 0.7">
  Switches: <strong>{switch_count}</strong> | Avg load: <strong>{avg_load_time}ms</strong>
  | Materials: <strong>{n_materials}</strong>
</div>

<BarPlot
  bind:series
  x_axis={{ label: `Material ID`, tick: { label: { show: false } } }}
  y_axis={{
    label: `${properties[y_key].label} (${properties[y_key].unit})`,
    options: y_options,
    selected_key: y_key,
  }}
  {data_loader}
  {on_axis_change}
  mode="grouped"
  bar={{ border_radius: 1, gap: 0.1, label_rotation: 90 }}
  padding={{ t: 60 }}
  legend={{ layout: `horizontal`, style: `justify-content: center; font-size: 0.8em` }}
  style="height: 400px"
/>

<p style="margin-top: 0.5em; font-size: 0.8em; opacity: 0.7">
  50 materials grouped by crystal system. Click Y-axis to switch properties.
</p>
```

## Multiple Plots in 2×2 Grid Layout

Display multiple bar plots in a responsive 2×2 grid:

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const make_data = (fn, label_fn) => {
    const x_vals = Array.from({ length: 6 }, (_, idx) => idx + 1)
    return { x: x_vals.map(label_fn), y: x_vals.map(fn) }
  }

  const plots = [
    {
      title: `Reaction Rates`,
      data: make_data(
        (x_value) => 2 * x_value + Math.random() * 3,
        (x_value) => `R${x_value}`,
      ),
      x_label: `Reaction`,
      y_label: `Rate (mol/s)`,
      color: `#4c6ef5`,
    },
    {
      title: `Crystal Lattice`,
      data: make_data(
        (x_value) => 3 + Math.sqrt(x_value) * 2 + Math.random(),
        (x_value) => `L${x_value}`,
      ),
      x_label: `Structure`,
      y_label: `Lattice (Å)`,
      color: `#51cf66`,
    },
    {
      title: `Band Gaps`,
      data: make_data(
        (x_value) => 1 + x_value * 0.5 + Math.random() * 0.3,
        (x_value) => `M${x_value}`,
      ),
      x_label: `Material`,
      y_label: `Gap (eV)`,
      color: `#ff6b6b`,
    },
    {
      title: `Formation Energy`,
      data: make_data(
        (x_value) => -2 + x_value * 0.3 + Math.random() * 0.5,
        (x_value) => `C${x_value}`,
      ),
      x_label: `Compound`,
      y_label: `Energy (eV)`,
      color: `#ffd43b`,
    },
  ]
</script>

<div class="grid">
  {#each plots as { title, data, x_label, y_label, color } (title)}
    <div class="cell">
      <h4>{title}</h4>
      <BarPlot
        series={[{ ...data, color }]}
        x_axis={{ label: x_label }}
        y_axis={{ label: y_label }}
      />
    </div>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1em;
    margin: 2em 0;
  }
  .cell {
    border: 1px solid var(--border-color, #ddd);
    border-radius: 8px;
    padding: 3pt;
  }
  .cell h4 {
    margin: 0;
    text-align: center;
    font-size: 1em;
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
```

## Y2 Axis Synchronization

Dual y-axes with `y2_axis.sync` controlling the Y2 axis range. Modes: `'synced'` (same range as Y1), `'align'` (shared anchor point, default 0), or `undefined`/`'none'` (independent).

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const quarters = [`Q1-22`, `Q2-22`, `Q3-22`, `Q4-22`, `Q1-23`, `Q2-23`, `Q3-23`, `Q4-23`]
  const quarterly_data = [
    {
      x: quarters,
      y: [125, 142, 158, 171, 165, 189, 203, 218],
      label: `Sales ($K)`,
      color: `#4c6ef5`,
    },
    {
      x: quarters,
      y: [12.5, 15.2, 18.3, 14.8, 13.1, 19.5, 21.2, 23.8],
      label: `Profit Margin (%)`,
      color: `#51cf66`,
      render_mode: `line`,
      y_axis: `y2`,
      markers: `line+points`,
      line_style: { stroke_width: 2 },
      point_style: {
        radius: 6,
        symbol_type: `Triangle`,
        stroke: `#2f9e44`,
        stroke_width: 2,
      },
    },
  ]

  const sync_labels = {
    none: `Independent`,
    synced: `Synced`,
    align: `Align`,
  }
  let sync_mode = $state(`synced`)
</script>

<div style="margin-bottom: 1em; display: flex; gap: 1.5em; align-items: center">
  <strong>Y2 Sync:</strong>
  {#each Object.entries(sync_labels) as [mode, label] (mode)}
    <label><input type="radio" bind:group={sync_mode} value={mode} /> {label}</label>
  {/each}
</div>

<BarPlot
  series={quarterly_data}
  x_axis={{ label: `Quarter` }}
  y_axis={{ label: `Revenue ($K)`, color: `#4c6ef5` }}
  y2_axis={{
    label: `Margin (%)`,
    color: `#51cf66`,
    sync: sync_mode,
  }}
  style="height: 400px"
/>
```

## Dual X-Axes (X2)

Plot two bar series with independent x-scales on the same chart. The primary x-axis (bottom) shows one unit while the secondary x2-axis (top) shows another. This is useful when comparing measurements in different units that share the same y-axis (e.g. temperature in Celsius vs Fahrenheit).

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const series = [
    {
      x: [10, 20, 30, 40],
      y: [5, 12, 8, 15],
      label: `Celsius`,
      color: `#2563eb`,
      bar_width: 3,
    },
    {
      x: [50, 68, 86, 104],
      y: [3, 9, 6, 11],
      label: `Fahrenheit`,
      color: `#dc2626`,
      bar_width: 5,
      x_axis: `x2`,
    },
  ]
</script>

Two bar series on independent x-scales. Bottom: temperature in °C (blue). Top: temperature in
°F (red). Each series is positioned using its own x-axis scale.

<BarPlot
  {series}
  x_axis={{ label: `Temperature (°C)` }}
  x2_axis={{ label: `Temperature (°F)` }}
  y_axis={{ label: `Count` }}
  show_legend
  style="height: 400px"
/>
```

## Adaptive Tick Strategies Under Pressure

`tick.label.auto_layout` scores upright, wrapped, rotated, staggered, thinned, and ellipsized candidates against the measured container. Resize the plot and move the category axis between x and y to see the same strategy set adapt in both directions.

```svelte example
<script lang="ts">
  import { BarPlot } from 'matterviz'

  const synthesis_routes = [
    `Chemical Vapor Deposition`,
    `Molecular Beam Epitaxy`,
    `Spark Plasma Sintering`,
    `Mechanochemical Ball Milling`,
    `Atomic Layer Deposition`,
    `Pulsed Laser Deposition`,
    `High Pressure Solid State`,
    `Solution Combustion Synthesis`,
  ]
  const observations = [18_400, 14_800, 9_600, 7_900, 6_700, 5_400, 4_100, 3_600]

  let chart_width = $state(360)
  let orientation = $state<`vertical` | `horizontal`>(`vertical`)
  const category_axis = {
    label: `Synthesis route used for the final experimental protocol`,
    tick: {
      label: {
        auto_layout: {
          strategies: [`upright`, `wrap`, `rotate`, `stagger`, `thin`, `ellipsis`] as const,
          max_angle: 60,
          max_band: 76,
          min_visible_ticks: 3,
          edge_gap: 6,
          endpoint_policy: `adaptive` as const,
        },
      },
    },
  }
  const value_axis = {
    label: `Number of structures surviving all validation and quality-control filters`,
    format: `~s`,
  }
  const series = [{ x: synthesis_routes, y: observations, color: `#4c6ef5` }]
</script>

<div
  data-testid="adaptive-tick-demo"
  style="width: min(900px, calc(100vw - 2em)); margin-left: 50%; transform: translateX(-50%)"
>
  <div style="display: flex; flex-wrap: wrap; gap: 1em 2em; align-items: center">
    <label
      >Width: {chart_width}px
      <input type="range" bind:value={chart_width} min="280" max="900" step="20" /></label
    >
    <label
      >Category axis: <select bind:value={orientation}
        ><option value="vertical">x (bottom)</option><option value="horizontal"
          >y (left)</option
        ></select
      ></label
    >
  </div>
  <div style={`width: min(100%, ${chart_width}px); margin: 1em auto`}>
    <BarPlot
      {series}
      {orientation}
      x_axis={orientation === `vertical` ? category_axis : value_axis}
      y_axis={orientation === `vertical` ? value_axis : category_axis}
      show_controls={false}
      style="height: 430px"
    />
  </div>
</div>
```
