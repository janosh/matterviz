# PropertyFilter

A numeric range filter with histogram visualization for filtering materials by quantitative properties.

## Interactive Demo

Filter with histogram, logarithmic scale toggle, and callbacks:

```svelte example
<script lang="ts">
  import { PropertyFilter } from 'matterviz'

  // Generate sample data
  const bandgaps = Array.from(
    { length: 400 },
    () => Math.abs(Math.random() * 5 + Math.random() * 2 - 0.5),
  )

  let min = $state<number>()
  let max = $state<number>()
  let log_scale = $state(false)
  let events = $state<string[]>([])

  function log_event(type: string) {
    events = [
      ...events.slice(-2),
      `${type}: [${min?.toFixed(1) ?? `-∞`}, ${max?.toFixed(1) ?? `+∞`}]`,
    ]
  }

  const filtered_count = $derived(
    bandgaps.filter((v) =>
      (min === undefined || v >= min) && (max === undefined || v <= max)
    ).length,
  )
</script>

<label style="display: flex; gap: 0.5em; margin-bottom: 1em; font-size: 0.9em">
  <input type="checkbox" bind:checked={log_scale} /> Logarithmic histogram
</label>

<PropertyFilter
  label="Band Gap"
  bind:min_value={min}
  bind:max_value={max}
  histogram_data={bandgaps}
  histogram_height={50}
  log={log_scale}
  unit="eV"
  onchange={() => log_event(`change`)}
  onclear={() => log_event(`clear`)}
/>

<div
  style="display: flex; justify-content: space-between; margin-top: 8pt; font-size: 0.85em"
>
  <span><strong>{filtered_count}</strong> of {bandgaps.length} materials in range</span>
  <span style="opacity: 0.6; font-family: monospace">{
    events[events.length - 1] || `No events yet`
  }</span>
</div>
```

## Histogram Positions & Configuration

Control histogram placement, custom placeholders, and without histogram:

```svelte example
<script lang="ts">
  import { PropertyFilter } from 'matterviz'

  const data = Array.from({ length: 300 }, () => Math.random() * 10 - 2)

  let min1 = $state()
  let max1 = $state()
  let min2 = $state()
  let max2 = $state()
  let min3 = $state()
  let max3 = $state()
  let disabled = $state(false)
</script>

<label style="display: flex; gap: 0.5em; margin-bottom: 1em; font-size: 0.9em">
  <input type="checkbox" bind:checked={disabled} /> Disable all
</label>

<div style="display: flex; flex-direction: column; gap: 1.5em">
  <PropertyFilter
    label="ΔH<sub>f</sub>"
    bind:min_value={min1}
    bind:max_value={max1}
    histogram_data={data}
    histogram_position="top"
    histogram_height={40}
    unit="eV/atom"
    {disabled}
  />

  <PropertyFilter
    label="V<sub>cell</sub>"
    bind:min_value={min2}
    bind:max_value={max2}
    histogram_data={data}
    histogram_position="bottom"
    histogram_height={40}
    placeholders={{ min: `50`, max: `500` }}
    unit="Å³"
    {disabled}
  />

  <PropertyFilter
    label="Temperature"
    bind:min_value={min3}
    bind:max_value={max3}
    histogram_position="none"
    placeholders={{ min: `273`, max: `1000` }}
    unit="K"
    {disabled}
  />
</div>
```

## Multi-Property Filter Panel

Filter materials by multiple properties simultaneously:

```svelte example
<script lang="ts">
  import { PropertyFilter } from 'matterviz'

  const n_mats = 500
  const bandgaps = Array.from({ length: n_mats }, () => Math.random() * 6)
  const energies = Array.from({ length: n_mats }, () => Math.random() * 4 - 2)
  const volumes = Array.from({ length: n_mats }, () => 50 + Math.random() * 400)

  let bg_min = $state()
  let bg_max = $state()
  let e_min = $state()
  let e_max = $state()
  let v_min = $state()
  let v_max = $state()

  function in_range(val: number, min: number | undefined, max: number | undefined) {
    return (min === undefined || val >= min) && (max === undefined || val <= max)
  }

  const total = $derived(
    Array.from(
      { length: n_mats },
      (_, idx) =>
        in_range(bandgaps[idx], bg_min, bg_max) &&
        in_range(energies[idx], e_min, e_max) &&
        in_range(volumes[idx], v_min, v_max),
    ).filter(Boolean).length,
  )

  function clear_all() {
    bg_min =
      bg_max =
      e_min =
      e_max =
      v_min =
      v_max =
        undefined
  }
</script>

<div
  style="display: grid; gap: 1em; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr))"
>
  <PropertyFilter
    label="Band Gap"
    bind:min_value={bg_min}
    bind:max_value={bg_max}
    histogram_data={bandgaps}
    histogram_height={35}
    unit="eV"
  />
  <PropertyFilter
    label="ΔH<sub>f</sub>"
    bind:min_value={e_min}
    bind:max_value={e_max}
    histogram_data={energies}
    histogram_height={35}
    unit="eV/atom"
  />
  <PropertyFilter
    label="V<sub>cell</sub>"
    bind:min_value={v_min}
    bind:max_value={v_max}
    histogram_data={volumes}
    histogram_height={35}
    unit="Å³"
  />
</div>

<div
  style="display: flex; justify-content: space-between; align-items: center; margin-top: 1em; padding-top: 1em; border-top: 1px solid rgba(128, 128, 128, 0.2)"
>
  <span><strong>~{total}</strong> of {n_mats} materials match all filters</span>
  <button onclick={clear_all} style="font-size: 0.85em; padding: 6pt 12pt">
    Clear all
  </button>
</div>
```

## Data Table Integration

Filter and display a materials table:

```svelte example
<script lang="ts">
  import { PropertyFilter } from 'matterviz'

  const materials = [
    { name: `LiFePO4`, bandgap: 3.8, energy: -5.23, volume: 291 },
    { name: `LiCoO2`, bandgap: 2.7, energy: -4.89, volume: 97 },
    { name: `TiO2`, bandgap: 3.2, energy: -9.73, volume: 62 },
    { name: `Fe2O3`, bandgap: 2.1, energy: -8.29, volume: 302 },
    { name: `Al2O3`, bandgap: 8.8, energy: -15.87, volume: 255 },
    { name: `SiO2`, bandgap: 8.9, energy: -18.54, volume: 113 },
    { name: `ZnO`, bandgap: 3.4, energy: -5.62, volume: 48 },
    { name: `MgO`, bandgap: 7.8, energy: -11.53, volume: 75 },
  ]

  let bg_min = $state()
  let bg_max = $state()

  const filtered = $derived(
    materials.filter((mat) =>
      (bg_min === undefined || mat.bandgap >= bg_min) &&
      (bg_max === undefined || mat.bandgap <= bg_max)
    ),
  )
</script>

<PropertyFilter
  label="Band Gap"
  bind:min_value={bg_min}
  bind:max_value={bg_max}
  histogram_data={materials.map((mat) => mat.bandgap)}
  histogram_height={40}
  unit="eV"
  style="margin-bottom: 1em"
/>

<table style="width: 100%; border-collapse: collapse; font-size: 0.9em">
  <thead>
    <tr style="border-bottom: 2px solid rgba(128, 128, 128, 0.25)">
      <th style="text-align: left; padding: 8pt">Formula</th>
      <th style="text-align: right; padding: 8pt">E<sub>g</sub> (eV)</th>
      <th style="text-align: right; padding: 8pt">ΔH (eV)</th>
      <th style="text-align: right; padding: 8pt">V (Å³)</th>
    </tr>
  </thead>
  <tbody>
    {#each filtered as mat (mat.name)}
      <tr style="border-bottom: 1px solid rgba(128, 128, 128, 0.1)">
        <td style="padding: 8pt; font-family: monospace">{mat.name}</td>
        <td style="padding: 8pt; text-align: right">{mat.bandgap}</td>
        <td style="padding: 8pt; text-align: right">{mat.energy}</td>
        <td style="padding: 8pt; text-align: right">{mat.volume}</td>
      </tr>
    {:else}
      <tr>
        <td colspan="4" style="padding: 16pt; text-align: center; opacity: 0.5">
          No materials match
        </td>
      </tr>
    {/each}
  </tbody>
</table>
<div style="margin-top: 6pt; font-size: 0.8em; opacity: 0.6">
  {filtered.length} of {materials.length} materials
</div>
```
