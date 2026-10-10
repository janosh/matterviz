<script lang="ts">
  import LazyDemo from '#site/LazyDemo.svelte'
  import { sanitize_html } from '#lib/sanitize.js'
  import CodeBlock from 'svelte-widgets/CodeBlock.svelte'
  import { ScatterPlot } from '#lib'
  import type {
    CleaningConfig,
    InvalidValueMode,
    TruncationMode,
  } from '#lib/plot/core/data-cleaning.js'
  import {
    clean_multi_series,
    clean_series,
    clean_xyz,
    detect_instability,
  } from '#lib/plot/core/data-cleaning.js'
  import type { DataSeries, PointStyle } from '#lib/plot/core/types.js'

  // --- Synthetic Data Generators ---

  // Generate smooth baseline data
  const generate_smooth = (length: number, amplitude = 10, frequency = 0.2): number[] =>
    Array.from({ length }, (_, idx) => amplitude * Math.sin(idx * frequency) + amplitude)

  // Add random noise
  const add_noise = (data: number[], noise_level: number): number[] =>
    data.map((val) => val + (Math.random() - 0.5) * noise_level * 2)

  // Add NaN values at random positions
  const add_nan_values = (data: number[], probability: number): number[] =>
    data.map((val) => (Math.random() < probability ? NaN : val))

  // Add outliers (spike values)
  const add_outliers = (data: number[], probability: number, magnitude: number): number[] =>
    data.map((val) =>
      Math.random() < probability ? val + (Math.random() > 0.5 ? 1 : -1) * magnitude : val,
    )

  // Generate oscillating/unstable data
  const generate_unstable = (
    stable_length: number,
    unstable_length: number,
    growth_rate = 0.15,
  ): { x: number[]; y: number[] } => {
    const total = stable_length + unstable_length
    const x_vals = Array.from({ length: total }, (_, idx) => idx)
    const y_vals = x_vals.map((val, idx) => {
      if (idx < stable_length) return val * 0.5 + 10
      const unstable_idx = idx - stable_length
      return val * 0.5 + 10 + Math.exp(growth_rate * unstable_idx) * Math.sin(unstable_idx * 2)
    })
    return { x: x_vals, y: y_vals }
  }

  // Generate jumpy data (discontinuities)
  const generate_jumpy = (length: number, jump_count: number): number[] => {
    const result: number[] = []
    let baseline = 10
    const segment_length = Math.max(1, Math.floor(length / (jump_count + 1)))
    for (let idx = 0; idx < length; idx++) {
      if (idx > 0 && idx % segment_length === 0) {
        baseline += (Math.random() - 0.5) * 20
      }
      result.push(baseline + Math.sin(idx * 0.3) * 2 + (Math.random() - 0.5) * 2)
    }
    return result
  }

  // --- State Variables ---

  // Data type selection
  type DataType = `unstable` | `noisy` | `outliers` | `nan_values` | `jumpy` | `combined`
  let data_type = $state<DataType>(`unstable`)

  // Filter controls
  let invalid_mode = $state<InvalidValueMode>(`remove`)
  let truncation_mode = $state<TruncationMode>(`hard_cut`)
  let oscillation_threshold = $state(2.5)
  let window_size = $state(5)
  let apply_smoothing = $state(false)
  let smoothing_window = $state(5)
  let smoothing_type = $state<`moving_avg` | `savgol`>(`moving_avg`)
  let apply_bounds = $state(false)
  let bounds_min = $state(0)
  let bounds_max = $state(30)
  let bounds_mode = $state<`clamp` | `filter` | `null`>(`clamp`)

  // Data generation parameters
  let data_length = $state(80)
  let noise_level = $state(3)
  let nan_probability = $state(0.1)
  let outlier_probability = $state(0.08)
  let outlier_magnitude = $state(25)
  let regenerate_counter = $state(0)

  // Derived: cleaning config from controls
  // Using $derived ensures Svelte tracks all state dependencies properly
  let cleaning_config = $derived.by((): CleaningConfig => {
    const config: CleaningConfig = {
      invalid_values: invalid_mode,
      oscillation_threshold,
      window_size,
      truncation_mode,
      in_place: false,
    }

    if (apply_smoothing) {
      config.smooth =
        smoothing_type === `savgol`
          ? { type: `savgol`, window: smoothing_window, polynomial_order: 2 }
          : { type: `moving_avg`, window: smoothing_window }
    }

    if (apply_bounds) {
      config.bounds = { min: bounds_min, max: bounds_max, mode: bounds_mode }
    }

    return config
  })

  // Derived: raw data - regenerates when counter, type, or generation params change
  let raw_data = $derived.by((): { x: number[]; y: number[] } => {
    void regenerate_counter // touch to trigger reactivity on button click
    if (data_type === `unstable`) {
      return generate_unstable(Math.floor(data_length * 0.5), Math.ceil(data_length * 0.5))
    }
    const x_vals = Array.from({ length: data_length }, (_, idx) => idx)
    if (data_type === `jumpy`) return { x: x_vals, y: generate_jumpy(data_length, 4) }
    // combined applies every defect at reduced strength
    const combined = data_type === `combined`
    const scale = combined ? 0.5 : 1
    let y_vals = generate_smooth(data_length)
    if (combined || data_type === `noisy`) y_vals = add_noise(y_vals, noise_level * scale)
    if (combined || data_type === `outliers`) {
      const magnitude = outlier_magnitude * (combined ? 0.7 : 1)
      y_vals = add_outliers(y_vals, outlier_probability * scale, magnitude)
    }
    if (combined || data_type === `nan_values`) {
      y_vals = add_nan_values(y_vals, nan_probability * scale)
    }
    return { x: x_vals, y: y_vals }
  })

  let cleaned_result = $derived(
    clean_series({ x: [...raw_data.x], y: [...raw_data.y] }, cleaning_config),
  )

  // Derived: instability detection result
  let instability_result = $derived(
    detect_instability(raw_data.x, raw_data.y, { oscillation_threshold, window_size }),
  )

  // Interpolated value at an index: the average of its nearest valid neighbors
  function interpolate_at_index(values: number[], idx: number, fallback: number): number {
    let prev = fallback,
      next = fallback
    for (let jdx = idx - 1; jdx >= 0; jdx--) {
      if (Number.isFinite(values[jdx])) {
        prev = values[jdx]
        break
      }
    }
    for (let jdx = idx + 1; jdx < values.length; jdx++) {
      if (Number.isFinite(values[jdx])) {
        next = values[jdx]
        break
      }
    }
    return (prev + next) / 2
  }

  // Find removed points via two-pointer comparison (cleaning preserves order)
  let removed_points = $derived.by(() => {
    const removed_x: number[] = []
    const removed_y: number[] = []
    const cleaned_x = cleaned_result.series.x

    for (let raw_idx = 0, cleaned_idx = 0; raw_idx < raw_data.x.length; raw_idx++) {
      if (cleaned_idx < cleaned_x.length && raw_data.x[raw_idx] === cleaned_x[cleaned_idx])
        cleaned_idx++
      else {
        removed_x.push(raw_data.x[raw_idx])
        const raw_y = raw_data.y[raw_idx]
        removed_y.push(
          Number.isFinite(raw_y) ? raw_y : interpolate_at_index(raw_data.y, raw_idx, 10),
        )
      }
    }
    return { x: removed_x, y: removed_y }
  })

  type Points = { x: number[]; y: number[] }

  // Points where both coordinates are finite
  const finite_points = (x_vals: number[], y_vals: number[]): Points => {
    const keep = (_: number, idx: number) =>
      Number.isFinite(x_vals[idx]) && Number.isFinite(y_vals[idx])
    return { x: x_vals.filter(keep), y: y_vals.filter(keep) }
  }

  const line_series = (
    { x, y }: Points,
    label: string,
    color: string,
    stroke_width = 1.5,
    point_style: PointStyle = {},
  ): DataSeries => ({
    x,
    y,
    label,
    point_style: { fill: color, radius: 4, ...point_style },
    line_style: { stroke: color, stroke_width },
    markers: `line+points`,
  })

  // Cross markers at the given points, labeled with their count (no series when empty)
  const cross_series = (points: Points, label: string, fill: string, radius: number) =>
    points.x.length > 0
      ? [
          {
            ...points,
            label: `${label} (${points.x.length})`,
            point_style: { fill, radius, symbol_type: `Cross` as const },
            markers: `points` as const,
          },
        ]
      : []

  let plot_series = $derived([
    line_series(finite_points(raw_data.x, raw_data.y), `Raw Data (valid)`, `#e74c3c`, 1.5, {
      fill_opacity: 0.6,
    }),
    line_series(cleaned_result.series, `Cleaned Data`, `#2ecc71`, 2, { radius: 5 }),
    ...cross_series(removed_points, `Removed/Invalid`, `#9b59b6`, 7),
  ])

  // Multi-series demo: correlated sensor readings at same timestamps
  let multi_series_data = $derived.by(() => {
    void regenerate_counter
    const time = Array.from({ length: 50 }, (_, idx) => idx) // timestamps
    const temperature = time.map(
      (time_value) => 25 + 5 * Math.sin(time_value * 0.2) + (Math.random() - 0.5) * 3,
    )
    const pressure = time.map(
      (time_value) => 101 + 4 * Math.cos(time_value * 0.15) + (Math.random() - 0.5) * 4,
    )
    // Sensor glitches at different times - if one reading is bad, both are suspect
    temperature[10] = NaN
    temperature[25] = NaN
    pressure[15] = NaN
    pressure[35] = NaN
    return { x: time, y_arrays: [temperature, pressure] }
  })

  let multi_series_cleaned = $derived(
    clean_multi_series(multi_series_data.x, multi_series_data.y_arrays, {
      invalid_values: invalid_mode,
      in_place: false,
    }),
  )

  // Interpolated positions of the points with a non-finite coordinate, for marking them
  const nan_markers = (x_vals: number[], y_vals: number[], fallback: number): Points => {
    const nan_indices = x_vals.flatMap((_, idx) =>
      Number.isFinite(x_vals[idx]) && Number.isFinite(y_vals[idx]) ? [] : [idx],
    )
    return {
      x: nan_indices.map((idx) => interpolate_at_index(x_vals, idx, fallback)),
      y: nan_indices.map((idx) => interpolate_at_index(y_vals, idx, fallback)),
    }
  }

  // Trajectory demo data - a spiral path where NaN in any coordinate removes that point from all
  let xyz_data = $derived.by(() => {
    void regenerate_counter
    const length = 50
    // Spiral trajectory: x and y are coordinates, t is the parameter (like time)
    const t_vals = Array.from({ length }, (_, idx) => idx)
    const x_vals = t_vals.map(
      (time_value) => 10 + 8 * Math.cos(time_value * 0.25) * (1 + time_value * 0.02),
    )
    const y_vals = t_vals.map(
      (time_value) => 10 + 8 * Math.sin(time_value * 0.25) * (1 + time_value * 0.02),
    )
    // Add NaN at different positions - these points will be removed from BOTH x and y
    x_vals[15] = NaN // NaN in x at t=15
    y_vals[35] = NaN // NaN in y at t=35
    x_vals[42] = NaN // another NaN in x
    return { x: x_vals, y: y_vals, z: t_vals } // z is just the time/index parameter
  })

  let xyz_cleaned = $derived(
    clean_xyz(xyz_data.x, xyz_data.y, xyz_data.z, {
      invalid_values: invalid_mode,
      in_place: false,
    }),
  )

  // Instability onset marker
  let ref_lines = $derived(
    instability_result.detected && data_type === `unstable`
      ? [
          {
            type: `vertical` as const,
            x: instability_result.onset_x,
            label: `Instability Onset`,
            style: { color: `#f39c12`, width: 2, dash: `6 3` },
            annotation: {
              text: `Onset x=${instability_result.onset_x.toFixed(0)}`,
              position: `end` as const,
              side: `right` as const,
            },
          },
        ]
      : [],
  )

  const format_quality = (quality: typeof cleaned_result.quality): string => {
    const parts = [
      quality.points_removed > 0 && `${quality.points_removed} removed`,
      quality.invalid_values_found > 0 && `${quality.invalid_values_found} invalid`,
      quality.bounds_violations > 0 && `${quality.bounds_violations} bounds violations`,
      quality.oscillation_detected && `oscillation detected`,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(`, `) : `No issues found`
  }

  // Tag tokens with starry-night's pl-* classes so the snippet below matches the fences
  // highlighted at build time elsewhere on the site and follows the active theme. Rule order
  // is load-bearing: comments and strings must swallow whatever code-like text they contain.
  const SYNTAX_RULES = [
    [`c`, /\/\/[^\n]*/], // comment
    [`s`, /'[^']*'/], // string
    [`k`, /\bimport(?: type)?\b|\b(?:from|const)\b/], // keyword
    [`en`, /\bclean_series\b/], // function
    [`smi`, /\b(?:DataSeries|CleaningConfig)\b/], // type
    [`c1`, /-?\d+(?:\.\d+)?|\b(?:true|false|NaN)\b/], // number, boolean, NaN
  ] as const
  const SYNTAX_RE = new RegExp(
    SYNTAX_RULES.map(([, real]) => `(${real.source})`).join(`|`),
    `g`,
  )

  const highlight = (code: string) =>
    sanitize_html(
      code.replace(SYNTAX_RE, (token, ...groups) => {
        const [cls] = SYNTAX_RULES[groups.findIndex((group) => group !== undefined)]
        return `<span class="pl-${cls}">${token}</span>`
      }),
    )

  let live_code = $derived.by(() => {
    const config_lines = [
      `  invalid_values: '${invalid_mode}',`,
      `  oscillation_threshold: ${oscillation_threshold},`,
      `  window_size: ${window_size},`,
      `  truncation_mode: '${truncation_mode}',`,
    ]

    if (apply_bounds) {
      config_lines.push(
        `  bounds: { min: ${bounds_min}, max: ${bounds_max}, mode: '${bounds_mode}' },`,
      )
    }

    if (apply_smoothing) {
      const window_prop = `window: ${smoothing_window}`
      config_lines.push(
        smoothing_type === `savgol`
          ? `  smooth: { type: 'savgol', ${window_prop}, polynomial_order: 2 },`
          : `  smooth: { type: 'moving_avg', ${window_prop} },`,
      )
    }

    config_lines.push(`  in_place: false,`)

    const x_preview = raw_data.x.slice(0, 5).join(`, `)
    const y_preview = raw_data.y
      .slice(0, 5)
      .map((val) => (Number.isFinite(val) ? val.toFixed(1) : `NaN`))
      .join(`, `)
    const { series, quality } = cleaned_result

    return `import { clean_series } from '#lib/plot/index.js'
import type { DataSeries, CleaningConfig } from '#lib/plot/index.js'

const series: DataSeries = {
  x: [${x_preview}, ...],
  y: [${y_preview}, ...],
}

const config: CleaningConfig = {
${config_lines.join(`\n`)}
}

const { series: cleaned, quality } = clean_series(series, config)
// Result: ${series.x.length} points (${quality.points_removed} removed)
// quality.invalid_values_found = ${quality.invalid_values_found}
// quality.oscillation_detected = ${quality.oscillation_detected}`
  })
</script>

<h1 id="data-cleaning-demo">Data Cleaning Demo</h1>

<section class="controls-panel">
  <h2 id="data-generation">Data Generation</h2>

  <div class="control-row">
    <label>
      Data Type:
      <select bind:value={data_type}>
        <option value="unstable">Unstable/Oscillating</option>
        <option value="noisy">Noisy Signal</option>
        <option value="outliers">Outliers/Spikes</option>
        <option value="nan_values">Missing Values (NaN)</option>
        <option value="jumpy">Jumpy/Discontinuous</option>
        <option value="combined">Combined Issues</option>
      </select>
    </label>

    <label>
      Data Length: {data_length}
      <input type="range" bind:value={data_length} min="30" max="150" step="10" />
    </label>

    <button onclick={() => regenerate_counter++} aria-label="Regenerate data">
      🔄 Regenerate Data
    </button>
  </div>

  {#if data_type === `noisy` || data_type === `combined`}
    <div class="control-row">
      <label>
        Noise Level: {noise_level.toFixed(1)}
        <input type="range" bind:value={noise_level} min="0.5" max="10" step="0.5" />
      </label>
    </div>
  {/if}

  {#if data_type === `nan_values` || data_type === `combined`}
    <div class="control-row">
      <label>
        NaN Probability: {(nan_probability * 100).toFixed(0)}%
        <input type="range" bind:value={nan_probability} min="0.02" max="0.3" step="0.02" />
      </label>
    </div>
  {/if}

  {#if data_type === `outliers` || data_type === `combined`}
    <div class="control-row">
      <label>
        Outlier Probability: {(outlier_probability * 100).toFixed(0)}%
        <input
          type="range"
          bind:value={outlier_probability}
          min="0.02"
          max="0.2"
          step="0.02"
        />
      </label>
      <label>
        Outlier Magnitude: {outlier_magnitude}
        <input type="range" bind:value={outlier_magnitude} min="10" max="50" step="5" />
      </label>
    </div>
  {/if}

  <h2 id="cleaning-options">Cleaning Options</h2>
  <p class="description">
    <code>detect_instability</code> combines derivative variance, amplitude growth, and
    sign-change frequency over <code>window_size</code>; <code>oscillation_threshold</code> applies
    to the derivative and combined scores.
  </p>

  <div class="control-row">
    <label>
      Invalid Value Handling:
      <select bind:value={invalid_mode}>
        <option value="remove">Remove</option>
        <option value="interpolate">Interpolate</option>
        <option value="propagate">Propagate (keep)</option>
      </select>
    </label>

    <label>
      Truncation Mode:
      <select bind:value={truncation_mode}>
        <option value="hard_cut">Hard Cut</option>
        <option value="mark_unstable">Mark Unstable</option>
      </select>
    </label>
  </div>

  <div class="control-row">
    <label>
      Oscillation Threshold: {oscillation_threshold.toFixed(1)}
      <input type="range" bind:value={oscillation_threshold} min="0.5" max="5" step="0.1" />
    </label>

    <label>
      Detection Window: {window_size}
      <input type="range" bind:value={window_size} min="3" max="15" step="1" />
    </label>
  </div>

  <div class="control-row">
    <label>
      <input type="checkbox" bind:checked={apply_smoothing} />
      Apply Smoothing
    </label>

    {#if apply_smoothing}
      <label>
        Type:
        <select bind:value={smoothing_type}>
          <option value="moving_avg">Moving Average</option>
          <option value="savgol">Savitzky-Golay</option>
        </select>
      </label>
      <label>
        Window: {smoothing_window}
        <input type="range" bind:value={smoothing_window} min="3" max="15" step="2" />
      </label>
    {/if}
  </div>

  <div class="control-row">
    <label>
      <input type="checkbox" bind:checked={apply_bounds} />
      Apply Bounds
    </label>

    {#if apply_bounds}
      <label>
        Min: {bounds_min}
        <input type="range" bind:value={bounds_min} min="-10" max="15" step="1" />
      </label>
      <label>
        Max: {bounds_max}
        <input type="range" bind:value={bounds_max} min="15" max="40" step="1" />
      </label>
      <label>
        Mode:
        <select bind:value={bounds_mode}>
          <option value="clamp">Clamp</option>
          <option value="filter">Filter</option>
          <option value="null">Replace with NaN</option>
        </select>
      </label>
    {/if}
  </div>
</section>

<section class="plot-section">
  <h2 id="single-series-cleaning">Single Series Cleaning</h2>

  <div class="quality-report">
    <strong>Quality Report:</strong>
    {format_quality(cleaned_result.quality)}
    <span style="opacity: 0.7">
      ({raw_data.x.length} → {cleaned_result.series.x.length} points)
    </span>
    {#if instability_result.detected}
      <span class="instability-badge">
        ⚠️ Instability at x={instability_result.onset_x.toFixed(0)} (score:
        {instability_result.combined_score.toFixed(2)})
      </span>
    {/if}
  </div>

  <LazyDemo label="Single Series Cleaning" height="400px">
    <ScatterPlot
      series={plot_series}
      {ref_lines}
      x_axis={{ label: `X (index)` }}
      y_axis={{ label: `Y Value` }}
      legend={{ layout: `horizontal`, style: `justify-content: center;` }}
      style="height: 400px"
    >
      {#snippet tooltip({ x: coord_x, y: coord_y, label })}
        <strong>{label}</strong><br />
        x: {coord_x.toFixed(1)}, y: {Number.isFinite(coord_y) ? coord_y.toFixed(2) : `NaN`}
      {/snippet}
    </ScatterPlot>
  </LazyDemo>

  <CodeBlock
    code={live_code}
    {highlight}
    language="typescript"
    label="Data cleaning example"
    style="margin-top: 1.5em"
  />
</section>

<section class="plot-section">
  <h2 id="multi-series-cleaning-correlated-data">Multi-Series Cleaning (Correlated Data)</h2>
  <p class="description">
    Synchronized filtering removes a row from every series when any value is invalid.
  </p>

  <div class="quality-report">
    <strong>Result:</strong>
    {multi_series_data.x.length} → {multi_series_cleaned.x.length} timesteps (Temp: {multi_series_cleaned
      .quality[0].invalid_values_found} glitches, Pressure: {multi_series_cleaned.quality[1]
      .invalid_values_found} glitches)
  </div>

  <div class="multi-series-grid">
    <div>
      <h3 id="raw-data-nan-positions-marked">Raw Data (NaN positions marked)</h3>
      <LazyDemo label="Raw Data (NaN positions marked)" height="280px">
        {@const {
          x: time,
          y_arrays: [temperature, pressure],
        } = multi_series_data}
        <ScatterPlot
          series={[
            line_series(finite_points(time, temperature), `Temperature`, `#e74c3c`),
            line_series(finite_points(time, pressure), `Pressure`, `#3498db`),
            ...cross_series(nan_markers(time, temperature, 25), `Temp NaN`, `#9b59b6`, 8),
            ...cross_series(nan_markers(time, pressure, 101), `Pressure NaN`, `#8e44ad`, 8),
          ]}
          x_axis={{ label: `Time (s)` }}
          y_axis={{ label: `Value` }}
          style="height: 280px"
        />
      </LazyDemo>
    </div>
    <div>
      <h3 id="cleaned-series-aligned">Cleaned (series aligned)</h3>
      <LazyDemo label="Cleaned (series aligned)" height="280px">
        <ScatterPlot
          series={multi_series_cleaned.cleaned_y.map((y_vals, idx) =>
            line_series(
              { x: multi_series_cleaned.x, y: y_vals },
              [`Temperature`, `Pressure`][idx],
              [`#27ae60`, `#2980b9`][idx],
              2,
            ),
          )}
          x_axis={{ label: `Time (s)` }}
          y_axis={{ label: `Value` }}
          style="height: 280px"
        />
      </LazyDemo>
    </div>
  </div>
</section>

<section class="plot-section">
  <h2 id="trajectory-alignment">Trajectory Alignment</h2>
  <p class="description">
    Invalid coordinates remove the corresponding point from every trajectory array.
  </p>

  <div class="quality-report">
    <strong>Result:</strong>
    {xyz_data.x.length} → {xyz_cleaned.x.length} points ({xyz_cleaned.quality
      .invalid_values_found} invalid values removed from all coordinates)
  </div>

  <div class="multi-series-grid">
    <div>
      <h3 id="raw-data-nan-positions-marked-1">Raw Data (NaN positions marked)</h3>
      <LazyDemo label="Raw Data (NaN positions marked)" height="300px">
        <ScatterPlot
          series={[
            line_series(finite_points(xyz_data.x, xyz_data.y), `Trajectory`, `#e74c3c`),
            ...cross_series(
              nan_markers(xyz_data.x, xyz_data.y, 10),
              `NaN points`,
              `#9b59b6`,
              10,
            ),
          ]}
          x_axis={{ label: `X position` }}
          y_axis={{ label: `Y position` }}
          style="height: 300px"
        />
      </LazyDemo>
    </div>
    <div>
      <h3 id="cleaned-nan-points-removed">Cleaned (NaN points removed)</h3>
      <LazyDemo label="Cleaned (NaN points removed)" height="300px">
        <ScatterPlot
          series={[line_series(xyz_cleaned, `Cleaned trajectory`, `#27ae60`)]}
          x_axis={{ label: `X position` }}
          y_axis={{ label: `Y position` }}
          style="height: 300px"
        />
      </LazyDemo>
    </div>
  </div>
</section>

<style>
  .controls-panel {
    background: var(--surface-bg-hover, rgba(255, 255, 255, 0.02));
    border-radius: 8px;
    padding: 0.6em 1.2em;
    margin-bottom: 1.5em;
    h2 {
      margin: 0.3em 0 0.5em;
      font-size: 1.1em;
      font-weight: 600;
      color: var(--text-secondary, #888);
    }
  }
  .control-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em 1.5em;
    align-items: center;
    margin-bottom: 0.4em;
    label {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }
    select,
    input[type='range'] {
      margin-left: 0.4em;
    }
    input[type='range'] {
      width: 100px;
    }
    button {
      padding: 0.3em 0.8em;
      border-radius: 4px;
      background: var(--accent-color, #3498db);
      color: white;
      border: none;
      cursor: pointer;
      &:hover {
        opacity: 0.9;
      }
    }
  }
  .plot-section {
    margin: 2em 0;
    h2 {
      margin-bottom: 0.5em;
    }
  }
  .quality-report {
    background: var(--surface-bg, rgba(0, 0, 0, 0.1));
    padding: 0.6em 1em;
    border-radius: 4px;
    margin-bottom: 1em;
    font-size: 0.9em;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em 1.5em;
    align-items: center;
  }
  .instability-badge {
    color: #f39c12;
    font-weight: 500;
  }
  .description {
    opacity: 0.85;
    margin-bottom: 1em;
  }
  .multi-series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5em;
    h3 {
      margin: 0 0 0.5em;
      text-align: center;
    }
  }
  @media (max-width: 600px) {
    .control-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
