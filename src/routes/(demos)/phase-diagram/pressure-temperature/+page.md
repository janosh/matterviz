# Pressure–Temperature Phase Diagram

`PressureTemperaturePhaseDiagram` shows which phase is stable at each pressure and temperature: filled stability fields, the coexistence lines between them, triple and critical points, and per-point standard errors on the boundaries drawn as bands or error bars. It is the fixed-composition counterpart of the composition-based [binary](/phase-diagram) and [ternary](/phase-diagram/ternary) diagrams, and sits on the same Cartesian frame as the other [plots](/plot), so axes, log scales, pan/zoom, legend placement, export and fullscreen all behave the same way.

Hover anywhere for the phase, P and T. Within a few pixels of a coexistence line the tooltip adds the line's standard errors at that point. Click to pin a point (click the same field, line or marker again or press Escape to release). Scroll or drag to zoom, double-click to reset. The gear icon opens the controls: units, a log pressure axis (the scale select of whichever axis carries pressure), swapped axes, the uncertainty style and its width in standard errors.

## Single-Component System with Uncertainty

An iron-like system with four solids, the liquid and three triple points. No regions are passed: the component traces them from the coexistence lines. Every boundary carries propagated standard errors, as a free-energy pipeline produces them: `sigma_t` (temperature at fixed pressure) on the shallow lines and `sigma_p` (pressure at fixed temperature) on the near-vertical α–ε line. Along the line's normal the band spans the larger of the two errors' projections, so each kind widens the band where it matters. Where a line has both, they are two views of one free-energy error (σ_T / σ_P = |dT/dP|), so they aren't added. Here bands span 2σ; the controls switch to error bars or another width.

```svelte example
<script lang="ts">
  import { format_num, PressureTemperaturePhaseDiagram } from 'matterviz'
  import { iron_pt_diagram } from '#site/phase-diagrams/pressure-temperature.js'

  let pinned = $state(``)
</script>

<p>{pinned}</p>
<PressureTemperaturePhaseDiagram
  data={iron_pt_diagram}
  n_sigma={2}
  on_pin={(info) =>
    (pinned = info
      ? `Pinned ${info.phase?.name ?? `point`} at ${format_num(info.point[0], `.1f`)} GPa, ${Math.round(info.point[1])} K`
      : ``)}
  style="height: 500px"
/>
```

On a linear axis the low-pressure fields (α, δ) are squeezed against the left edge (the δ label is hidden where it doesn't fit); switch the pressure axis to _Log_ in the controls to spread them out. A log axis starts at the lowest positive pressure (the `pressure_range` minimum if positive, else the smallest positive pressure in the data); points at 0 GPa have no place on it, so lines from them enter at the left edge.

## Critical Point, Explicit Regions and Swapped Axes

A water-like system in pascal, shown with temperature on x (`swap_axes`), pressure on a log y axis in bar and temperatures in °C. Liquid and vapor share one region around the critical point, where their coexistence line just ends, so lines alone can't split them: this diagram passes explicit `regions`, including the supercritical fluid.

```svelte example
<script lang="ts">
  import { PressureTemperaturePhaseDiagram } from 'matterviz'
  import { water_pt_diagram } from '#site/phase-diagrams/pressure-temperature.js'

  let pressure_axis = $state({ scale_type: `log`, format: `.0e` })
</script>

<PressureTemperaturePhaseDiagram
  data={water_pt_diagram}
  swap_axes
  bind:pressure_axis
  display_pressure_unit="bar"
  display_temp_unit="°C"
  style="height: 450px"
/>
```

## Data Format

The `data` prop is plain JSON: strings, numbers and arrays only, so it can come straight from Python. Every coordinate is a `[pressure, temperature]` pair in the data's units (`pressure_unit` defaults to `GPa`, `temperature_unit` to `K`); standard errors use the same units.

```ts
interface PtPhaseDiagramData {
  phases: { id: string; name?: string; color?: string; description?: string }[]
  boundaries: {
    id: string
    phases: [string, string] // the two coexisting phase ids
    points: [number, number][] // [P, T] polyline
    sigma_t?: number[] // per-point standard error of T at fixed P
    sigma_p?: number[] // per-point standard error of P at fixed T
    label?: string
    style?: { color?: string; width?: number; dash?: string }
    metastable?: boolean // dashed, ignored when tracing regions
  }[]
  regions?: {
    phase: string
    vertices: [number, number][]
    label_position?: [number, number]
  }[]
  special_points?: {
    id: string
    type: `triple` | `critical` | `custom`
    position: [number, number]
    phases?: string[] // required for `critical`: the pair of the one line ending there
    sigma_t?: number
    sigma_p?: number
    label?: string
  }[]
  pressure_range?: [number, number]
  temperature_range?: [number, number]
  pressure_unit?: `Pa` | `kPa` | `MPa` | `GPa` | `bar` | `kbar` | `atm`
  temperature_unit?: `K` | `°C` | `°F`
  system?: string // names the diagram in labels and export filenames
  title?: string
}
```

`parse_pt_data(data).errors` lists every problem (unknown keys, unknown phase ids, duplicate ids, sigma arrays that don't match their points, non-finite coordinates, inverted ranges, mistyped fields). The component shows the first one and draws nothing rather than a half-valid diagram.

A minimal two-phase diagram. A single line doesn't say which side is which phase, so it passes `regions` (the polygons share the boundary's points):

```svelte example
<script lang="ts">
  import { PressureTemperaturePhaseDiagram } from 'matterviz'

  const line = [
    [0, 800],
    [5, 950],
    [10, 1150],
  ]
  const data = {
    phases: [
      { id: `low`, name: `α` },
      { id: `high`, name: `β` },
    ],
    boundaries: [
      {
        id: `transition`,
        phases: [`low`, `high`],
        points: line,
        sigma_t: [10, 25, 50],
      },
    ],
    regions: [
      { phase: `low`, vertices: [[0, 300], ...line, [10, 300]] },
      { phase: `high`, vertices: [[0, 1500], ...line, [10, 1500]] },
    ],
    pressure_range: [0, 10],
    temperature_range: [300, 1500],
  }
</script>

<PressureTemperaturePhaseDiagram {data} style="height: 300px" />
```

## How Regions Are Traced

Without `regions`, `derive_regions(data)` joins the coexistence lines and the plotted window into a planar map. Separately computed boundaries rarely meet at exactly the same triple point or reach exactly the window edge, so their ends are joined without any distance tolerance: a line's end at its `critical` special point stays. Any other end is cut back past every crossing with another line on its half of the line (an overshoot, and the tangle where noisy lines cross repeatedly near a triple point); an end not on the window edge then joins the ends of the two other lines of its phase triangle (a|b, a|c and b|c meet at the one a-b-c triple point, all three moving to their mean), else runs on along its last segment to the first line or window edge it hits, so a window wider than the data still splits into fields. None of this depends on the order of the boundaries. When joining moves an end by more than 5% of the plot, the component warns that the boundaries don't meet. Each face takes the phase shared by every boundary around it, or failing that the phase across a boundary from an already named neighbor. On a log pressure axis the tracing runs in log P, so lines run on straight as drawn. Naming needs at least one face whose boundaries share a single phase, as around a triple point: a lone two-phase line leaves both sides unnamed.

Every boundary must then separate exactly its two phases, so a face named against that (when a missing or `metastable` line merges two fields) loses its name. A face that a coexistence line ends inside, or that holds a line or closed loop touching nothing (liquid and vapor joined around a critical point, an island phase), contains two phases and stays unfilled too. The component then shows a notice. Pass explicit regions for diagrams like that, as in the water example.

Axis settings are by quantity: `pressure_axis` and `temperature_axis` (label, ticks, format, `scale_type`, `range` in display units) follow their quantity when `swap_axes` flips the sides, and a pinned range converts along when the display unit changes. `null` values in `data` (Python's `None`) count as omitted.

## Styling

Theme it through CSS variables on the component or an ancestor: `--pt-region-opacity`, `--pt-region-lit-opacity`, `--pt-boundary-color`, `--pt-band-opacity`, `--pt-special-point-color`, `--pt-label-font-size`, `--pt-label-halo` and `--pt-pin-color`, plus the frame's `--pt-phase-diagram-bg`, `--pt-phase-diagram-height` and other shared chart variables.
