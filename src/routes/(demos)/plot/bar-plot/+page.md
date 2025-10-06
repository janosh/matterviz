# Bar Plot

## Crystal Structure Analysis

A simple bar plot showing lattice parameters across different crystal systems. Use the controls (gear icon) to toggle orientation, modes, and grid display:

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
  x_label="Crystal System"
  y_label="Lattice Parameter (Å)"
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
  x_label="Material (1=Si, 2=GaAs, 3=GaN, 4=ZnO, 5=Diamond)"
  y_label="Band Gap (eV)"
  style="height: 400px"
/>
```

## Reaction Kinetics with Temperature Profile

Combine bars and lines to show product formation alongside process parameters. Lines render as absolute values (perfect for trends/targets):

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
      line_style: {
        stroke_width: 3,
        line_dash: `5,5`,
      },
    },
    {
      x: [0, 10, 20, 30, 40, 50, 60],
      y: [0, 20, 47, 77, 99, 115, 124],
      label: `Total Yield`,
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
  x_label="Time (minutes)"
  y_label="Amount / Temperature"
  style="height: 450px"
/>
```

## Element Abundance in Earth's Crust

Horizontal bar charts work well for categorical data with long labels:

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
</script>

<label style="margin-bottom: 1em; display: block">
  <input
    type="checkbox"
    checked={orientation === `horizontal`}
    onchange={(evt) => (orientation = evt.target.checked ? `horizontal` : `vertical`)}
  />
  Horizontal Orientation
</label>

<BarPlot
  series={abundances}
  {orientation}
  x_label="Abundance (ppm)"
  y_label="Element"
  x_format="~s"
  y_format="~s"
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
    } else {
      hovered_info = `Hover over a bar`
    }
  }

  const info_style =
    `margin: 1em 0; padding: 4pt 8pt; background: rgba(255,255,255,0.1); border-radius: 4px; font-size: 0.9em`
</script>

<BarPlot
  series={phase_stability}
  mode="grouped"
  x_label="Temperature Point"
  y_label="Stability (%)"
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
  x_label="Compound"
  y_label="Formation Energy (eV/atom)"
  style="height: 400px"
/>
```

## Material Properties Over Time

Custom formatting, tick control, and axis configuration for publication-quality plots:

```svelte example
<script>
  import { BarPlot } from 'matterviz'

  const yearly_discoveries = [
    {
      x: [1990, 1995, 2000, 2005, 2010, 2015, 2020],
      y: [120000, 185000, 275000, 420000, 680000, 1050000, 1600000],
      label: `Materials in Database`,
      color: `#4c6ef5`,
    },
    {
      x: [1990, 1995, 2000, 2005, 2010, 2015, 2020],
      y: [80000, 150000, 250000, 400000, 650000, 1000000, 1500000],
      label: `Target Growth`,
      color: `#ff6b6b`,
      render_mode: `line`,
      line_style: {
        stroke_width: 3,
        line_dash: `6,3`,
      },
    },
  ]

  let x_format = $state(`d`)
  let y_format = $state(`.2s`)
  let x_ticks = $state(7)
  let y_ticks = $state(6)
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap">
  <label>
    X Format:
    <select bind:value={x_format}>
      <option value="d">Integer (2020)</option>
      <option value=".0f">Float (2020.0)</option>
    </select>
  </label>
  <label>
    Y Format:
    <select bind:value={y_format}>
      <option value=".2s">Short (1.6M)</option>
      <option value=",.0f">Full (1,600,000)</option>
      <option value=".3s">Precise (1.60M)</option>
    </select>
  </label>
  <label>
    X Ticks: {x_ticks}
    <input type="range" bind:value={x_ticks} min="3" max="10" style="width: 100px">
  </label>
  <label>
    Y Ticks: {y_ticks}
    <input type="range" bind:value={y_ticks} min="3" max="10" style="width: 100px">
  </label>
</div>

<BarPlot
  series={yearly_discoveries}
  {x_format}
  {y_format}
  {x_ticks}
  {y_ticks}
  x_label="Year"
  y_label="Number of Materials"
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
  x_label="Wavelength (nm)"
  y_label="Absorption Coefficient"
  style="height: 450px"
/>
```
