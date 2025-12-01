# Bar Plot

## Crystal Structure Analysis

A simple bar plot showing lattice parameters across different crystal systems. Use the controls (gear icon) to toggle orientation, modes, and grid display. This example also demonstrates rounded corners (`border_radius`) and bar borders (`stroke_color`, `stroke_width`):

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const lattice_params = [
    {
      x: [1, 2, 3, 4, 5, 6, 7],
      y: [3.52, 4.05, 5.43, 6.08, 3.89, 4.95, 5.65],
      label: `Lattice Parameter a (Å)`,
      color: `#4c6ef5`,
      labels: [`Diamond`, `NaCl`, `Si`, `GaAs`, `GaN`, `ZnO`, `CdTe`],
    },
  ]
</script>

<BarPlot
  series={lattice_params}
  bar={{ border_radius: 4, stroke_color: `#364fc7`, stroke_width: 1.5 }}
  x_axis={{ label: `Crystal System` }}
  y_axis={{ label: `Lattice Parameter (Å)` }}
  style="height: 400px"
/>
```

## Mode Comparison: Band Gap Measurements

Compare overlay, stacked, and grouped (side-by-side) modes using band gap data from different measurement techniques. Click legend items to toggle series visibility:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const band_gaps = [
    {
      x: [1, 2, 3, 4, 5],
      y: [1.12, 1.43, 2.26, 3.4, 5.47],
      label: `Optical Absorption`,
      color: `#4c6ef5`,
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [0.95, 1.25, 1.85, 2.98, 4.82],
      label: `Photoluminescence`,
      color: `#ff6b6b`,
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [1.28, 1.62, 2.58, 3.75, 6.15],
      label: `DFT Calculation`,
      color: `#51cf66`,
    },
  ]

  let mode = $state(`grouped`)
</script>

<div style="margin-bottom: 1em; display: flex; gap: 1em">
  <label><input type="radio" bind:group={mode} value="overlay" /> Overlay</label>
  <label><input type="radio" bind:group={mode} value="stacked" /> Stacked (Sum)</label>
  <label><input type="radio" bind:group={mode} value="grouped" /> Grouped
    (Side-by-Side)</label>
</div>

<BarPlot
  series={band_gaps}
  {mode}
  x_axis={{ label: `Material (1=Si, 2=GaAs, 3=GaN, 4=ZnO, 5=Diamond)` }}
  y_axis={{ label: `Band Gap (eV)` }}
  style="height: 400px"
/>
```

## Reaction Kinetics with Dual Y-Axes

Combine bars and lines with **dual y-axes** to show product formation alongside temperature. Temperature uses the right y2-axis with independent scaling:

```svelte example
<script>
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
      line_style: {
        stroke_width: 3,
        line_dash: `5,5`,
      },
    },
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [0, 20, 47, 77, 99, 115, 124],
      label: `Total Yield (mol)`,
      color: `#ffd43b`,
      render_mode: `line`,
      line_style: {
        stroke_width: 3,
      },
    },
  ]
</script>

<BarPlot
  series={reaction_data}
  mode="stacked"
  x_axis={{ label: `Time (minutes)` }}
  y_axis={{ label: `Product Amount (mol)` }}
  y2_axis={{ label: `Temperature (°C)`, format: `.0f` }}
  style="height: 450px"
/>
```

## Sales vs Profit Margin (Dual Y-Axes)

A classic business use case: comparing raw sales (bars, left axis) with profit margins (line, right axis) that have different scales and units:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const quarterly_data = [
    {
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [125000, 142000, 158000, 171000, 165000, 189000, 203000, 218000],
      label: `Sales Revenue ($)`,
      color: `#4c6ef5`,
      labels: [
        `Q1-22`,
        `Q2-22`,
        `Q3-22`,
        `Q4-22`,
        `Q1-23`,
        `Q2-23`,
        `Q3-23`,
        `Q4-23`,
      ],
    },
    {
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [12.5, 15.2, 18.3, 14.8, 13.1, 19.5, 21.2, 23.8],
      label: `Profit Margin (%)`,
      color: `#51cf66`,
      render_mode: `line`,
      y_axis: `y2`,
      line_style: {
        stroke_width: 3,
      },
    },
  ]
</script>

<BarPlot
  series={quarterly_data}
  x_axis={{ label: `Quarter` }}
  y_axis={{ label: `Revenue ($)`, format: `$,.0f` }}
  y2_axis={{ label: `Margin (%)`, format: `.1f` }}
  style="height: 400px"
/>
```

## Element Abundance in Earth's Crust

Horizontal bar charts work well for categorical data with long labels. This example demonstrates `tick.label.inside` which positions tick labels inside the plot area for a more compact design:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const abundances = [
    {
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [461000, 277200, 82300, 50000, 41500, 26000, 23600, 20900],
      label: `Abundance (ppm)`,
      color: `#845ef7`,
      labels: [
        `Oxygen`,
        `Silicon`,
        `Aluminum`,
        `Iron`,
        `Calcium`,
        `Sodium`,
        `Magnesium`,
        `Potassium`,
      ],
    },
  ]

  let orientation = $state(`horizontal`)
  let inside = $state(false)
</script>

<label style="margin-bottom: 1em; display: inline-block">
  <input
    type="checkbox"
    checked={orientation === `horizontal`}
    onchange={(evt) => (orientation = evt.target.checked ? `horizontal` : `vertical`)}
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
  x_axis={{ label: `Abundance (ppm)`, format: `~s`, tick: { label: { inside } } }}
  y_axis={{ label: `Element`, format: `~s`, tick: { label: { inside } } }}
  style="height: 400px"
/>
```

## Phase Stability with Interactive Tooltips

Add rich interactivity with custom tooltips, hover effects, and click handlers:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const phase_stability = [
    {
      x: [1, 2, 3, 4, 5],
      y: [85, 92, 78, 95, 88],
      label: `α-phase`,
      color: `#5c7cfa`,
      metadata: [
        { phase: `α-phase`, temp: `300K`, structure: `FCC`, stability: `High` },
        { phase: `α-phase`, temp: `500K`, structure: `FCC`, stability: `Very High` },
        { phase: `α-phase`, temp: `700K`, structure: `FCC`, stability: `Medium` },
        { phase: `α-phase`, temp: `900K`, structure: `FCC`, stability: `Very High` },
        { phase: `α-phase`, temp: `1100K`, structure: `FCC`, stability: `High` },
      ],
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [70, 75, 88, 82, 90],
      label: `β-phase`,
      color: `#ff6b6b`,
      metadata: [
        { phase: `β-phase`, temp: `300K`, structure: `BCC`, stability: `Medium` },
        { phase: `β-phase`, temp: `500K`, structure: `BCC`, stability: `Medium` },
        { phase: `β-phase`, temp: `700K`, structure: `BCC`, stability: `High` },
        { phase: `β-phase`, temp: `900K`, structure: `BCC`, stability: `High` },
        { phase: `β-phase`, temp: `1100K`, structure: `BCC`, stability: `Very High` },
      ],
    },
  ]

  let clicked_info = $state(`Click a bar to see phase details`)
  let hovered_info = $state(`Hover over a bar`)

  function handle_click(data) {
    const { metadata, y } = data
    clicked_info =
      `${metadata.phase} at ${metadata.temp}: ${metadata.structure} structure, ${y}% stable (${metadata.stability})`
  }

  function handle_hover(data) {
    if (data) {
      const { metadata, y } = data
      hovered_info = `${metadata.phase} at ${metadata.temp}: ${y}% stability`
    } else hovered_info = `Hover over a bar`
  }

  const info_style =
    `margin: 1em 0; padding: 4pt 8pt; background: rgba(255,255,255,0.1); border-radius: var(--border-radius); font-size: 0.9em`
</script>

<BarPlot
  series={phase_stability}
  mode="grouped"
  x_axis={{ label: `Temperature Point` }}
  y_axis={{ label: `Stability (%)` }}
  on_bar_click={handle_click}
  on_bar_hover={handle_hover}
  style="height: 400px"
>
  {#snippet tooltip({ metadata, y })}
    <div style="font-weight: 600">{metadata.phase}</div>
    <div>Temp: {metadata.temp}</div>
    <div>Structure: {metadata.structure}</div>
    <div>Stability: {y}% ({metadata.stability})</div>
  {/snippet}
</BarPlot>

<div style={info_style}>
  <strong>Clicked:</strong> {clicked_info}
</div>
<div style={info_style}>
  <strong>Hovered:</strong> {hovered_info}
</div>
```

## Formation Energy Diagram

Bar plots handle negative values automatically and display zero lines for reference:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const formation_energies = [
    {
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [-2.45, 1.28, -1.82, 0.95, -3.12, 2.01, -0.67, -1.93],
      label: `Formation Energy`,
      color: `#4c6ef5`,
      labels: [
        `TiO₂`,
        `CuO`,
        `Al₂O₃`,
        `Fe₂O₃`,
        `MgO`,
        `ZnO`,
        `NiO`,
        `FeO`,
      ],
    },
    {
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [-2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0],
      label: `Stability Threshold`,
      color: `#51cf66`,
      render_mode: `line`,
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
<script>
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
  let y2_axis = $state({ label: `Compute Power (TFLOPS)`, format: `.0f`, ticks: 6 })
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
    <input type="range" bind:value={x_axis.ticks} min="3" max="10" style="width: 100px">
  </label>
</div>

<BarPlot
  series={yearly_data}
  {x_axis}
  {y_axis}
  {y2_axis}
  style="height: 400px"
/>
```

## Spectroscopy Data with Zoom

Interactive zoom and pan for exploring large datasets. Click and drag to zoom, double-click to reset:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const spectroscopy = [
    {
      x: [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800],
      y: [0.05, 0.12, 0.28, 0.65, 1.45, 2.8, 4.2, 3.5, 2.1, 0.95, 0.38, 0.15, 0.06],
      label: `Absorption Spectrum`,
      color: `#4c6ef5`,
    },
    {
      x: [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800],
      y: [0.02, 0.08, 0.22, 0.58, 1.35, 2.65, 4.0, 3.3, 1.95, 0.85, 0.32, 0.12, 0.05],
      label: `Theoretical Fit`,
      color: `#ff6b6b`,
      render_mode: `line`,
      line_style: {
        stroke_width: 2,
      },
    },
  ]
</script>

<div
  style="margin-bottom: 1em; padding: 8pt; background: rgba(255, 255, 255, 0.05); border-radius: 4px"
>
  <strong>Instructions:</strong> Click and drag to zoom into a wavelength region.
  Double-click to reset the view. Use the controls to adjust display.
</div>

<BarPlot
  series={spectroscopy}
  x_axis={{ label: `Wavelength (nm)` }}
  y_axis={{ label: `Absorption Coefficient` }}
  style="height: 450px"
/>
```

## Multiple Plots in 2×2 Grid Layout

Display multiple bar plots in a responsive 2×2 grid:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const make_data = (fn, label_fn) => {
    const x_vals = Array.from({ length: 6 }, (_, idx) => idx + 1)
    return {
      x: x_vals,
      y: x_vals.map(fn),
      labels: x_vals.map(label_fn),
    }
  }

  const plots = [
    {
      title: `Reaction Rates`,
      data: make_data((x) => 2 * x + Math.random() * 3, (x) => `R${x}`),
      x_label: `Reaction`,
      y_label: `Rate (mol/s)`,
      color: `#4c6ef5`,
    },
    {
      title: `Crystal Lattice`,
      data: make_data((x) => 3 + Math.sqrt(x) * 2 + Math.random(), (x) => `L${x}`),
      x_label: `Structure`,
      y_label: `Lattice (Å)`,
      color: `#51cf66`,
    },
    {
      title: `Band Gaps`,
      data: make_data((x) => 1 + x * 0.5 + Math.random() * 0.3, (x) => `M${x}`),
      x_label: `Material`,
      y_label: `Gap (eV)`,
      color: `#ff6b6b`,
    },
    {
      title: `Formation Energy`,
      data: make_data((x) => -2 + x * 0.3 + Math.random() * 0.5, (x) => `C${x}`),
      x_label: `Compound`,
      y_label: `Energy (eV)`,
      color: `#ffd43b`,
    },
  ]
</script>

<div class="grid">
  {#each plots as { title, data, x_label, y_label, color }}
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
