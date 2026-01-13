<script lang="ts">
  import { ScatterPlot } from '$lib'
  import {
    clean_multi_series,
    clean_series,
    clean_xyz,
    detect_instability,
  } from '$lib/plot/data-cleaning'
  import type {
    CleaningConfig,
    DataSeries,
    InvalidValueMode,
    TruncationMode,
  } from '$lib/plot/types'

  // --- Synthetic Data Generators ---

  // Generate smooth baseline data
  const generate_smooth = (
    length: number,
    amplitude = 10,
    frequency = 0.2,
  ): number[] =>
    Array.from(
      { length },
      (_, idx) => amplitude * Math.sin(idx * frequency) + amplitude,
    )

  // Add random noise
  const add_noise = (data: number[], noise_level: number): number[] =>
    data.map((val) => val + (Math.random() - 0.5) * noise_level * 2)

  // Add NaN values at random positions
  const add_nan_values = (data: number[], probability: number): number[] =>
    data.map((val) => (Math.random() < probability ? NaN : val))

  // Add outliers (spike values)
  const add_outliers = (
    data: number[],
    probability: number,
    magnitude: number,
  ): number[] =>
    data.map((val) =>
      Math.random() < probability
        ? val + (Math.random() > 0.5 ? 1 : -1) * magnitude
        : val
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
      return (
        val * 0.5 + 10 +
        Math.exp(growth_rate * unstable_idx) * Math.sin(unstable_idx * 2)
      )
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
  type DataType =
    | `unstable`
    | `noisy`
    | `outliers`
    | `nan_values`
    | `jumpy`
    | `combined`
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
      config.smooth = smoothing_type === `savgol`
        ? { type: `savgol`, window: smoothing_window, polynomial_order: 2 }
        : { type: `moving_avg`, window: smoothing_window }
    }

    if (apply_bounds) {
      config.bounds = { min: bounds_min, max: bounds_max, mode: bounds_mode }
    }

    return config
  })

  // Derived: raw data - regenerates when counter, type, or generation params change
  // All state reads happen directly in $derived.by to ensure proper dependency tracking
  let raw_data = $derived.by((): { x: number[]; y: number[] } => {
    void regenerate_counter // touch to trigger reactivity on button click
    const x_vals = Array.from({ length: data_length }, (_, idx) => idx)

    if (data_type === `unstable`) {
      return generate_unstable(
        Math.floor(data_length * 0.5),
        Math.ceil(data_length * 0.5),
      )
    } else if (data_type === `noisy`) {
      const smooth = generate_smooth(data_length)
      return { x: x_vals, y: add_noise(smooth, noise_level) }
    } else if (data_type === `outliers`) {
      const base = generate_smooth(data_length)
      return {
        x: x_vals,
        y: add_outliers(base, outlier_probability, outlier_magnitude),
      }
    } else if (data_type === `nan_values`) {
      const base = generate_smooth(data_length)
      return { x: x_vals, y: add_nan_values(base, nan_probability) }
    } else if (data_type === `jumpy`) {
      return { x: x_vals, y: generate_jumpy(data_length, 4) }
    } else {
      // combined
      let y_vals = generate_smooth(data_length)
      y_vals = add_noise(y_vals, noise_level * 0.5)
      y_vals = add_outliers(
        y_vals,
        outlier_probability * 0.5,
        outlier_magnitude * 0.7,
      )
      y_vals = add_nan_values(y_vals, nan_probability * 0.5)
      return { x: x_vals, y: y_vals }
    }
  })

  // Derived: cleaned data
  let cleaned_result = $derived.by(() => {
    const series: DataSeries = {
      x: [...raw_data.x],
      y: [...raw_data.y],
    }
    return clean_series(series, cleaning_config)
  })

  // Derived: instability detection result
  let instability_result = $derived.by(() => {
    return detect_instability(raw_data.x, raw_data.y, {
      oscillation_threshold,
      window_size,
    })
  })

  // Shared helper: find interpolated value at an index by averaging nearest valid neighbors
  // Used by removed_points, find_nan_positions, and find_trajectory_nan_positions
  function interpolate_at_index(
    values: number[],
    idx: number,
    fallback: number,
  ): number {
    let prev = fallback, next = fallback
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
      if (
        cleaned_idx < cleaned_x.length &&
        raw_data.x[raw_idx] === cleaned_x[cleaned_idx]
      ) cleaned_idx++
      else {
        removed_x.push(raw_data.x[raw_idx])
        const raw_y = raw_data.y[raw_idx]
        removed_y.push(
          Number.isFinite(raw_y)
            ? raw_y
            : interpolate_at_index(raw_data.y, raw_idx, 10),
        )
      }
    }
    return { x: removed_x, y: removed_y }
  })

  // Derived: series for plotting
  let plot_series = $derived.by(() => {
    const series: DataSeries[] = [
      {
        x: raw_data.x.filter((_, idx) => Number.isFinite(raw_data.y[idx])),
        y: raw_data.y.filter((y) => Number.isFinite(y)),
        label: `Raw Data (valid)`,
        point_style: { fill: `#e74c3c`, radius: 4, fill_opacity: 0.6 },
        line_style: { stroke: `#e74c3c`, stroke_width: 1.5 },
        markers: `line+points` as const,
      },
      {
        x: cleaned_result.series.x,
        y: cleaned_result.series.y,
        label: `Cleaned Data`,
        point_style: { fill: `#2ecc71`, radius: 5 },
        line_style: { stroke: `#2ecc71`, stroke_width: 2 },
        markers: `line+points` as const,
      },
    ]

    // Add removed points as a separate series if there are any
    if (removed_points.x.length > 0) {
      series.push({
        x: removed_points.x,
        y: removed_points.y,
        label: `Removed/Invalid (${removed_points.x.length})`,
        point_style: { fill: `#9b59b6`, radius: 7, symbol_type: `Cross` },
        markers: `points` as const,
      })
    }

    return series
  })

  // Multi-series demo: correlated sensor readings at same timestamps
  let multi_series_data = $derived.by(() => {
    void regenerate_counter
    const time = Array.from({ length: 50 }, (_, idx) => idx) // timestamps
    const temperature = time.map(
      (t) => 25 + 5 * Math.sin(t * 0.2) + (Math.random() - 0.5) * 3,
    )
    const pressure = time.map(
      (t) => 101 + 4 * Math.cos(t * 0.15) + (Math.random() - 0.5) * 4,
    )
    // Sensor glitches at different times - if one reading is bad, both are suspect
    temperature[10] = NaN
    temperature[25] = NaN
    pressure[15] = NaN
    pressure[35] = NaN
    return { x: time, y_arrays: [temperature, pressure] }
  })

  let multi_series_cleaned = $derived.by(() => {
    return clean_multi_series(multi_series_data.x, multi_series_data.y_arrays, {
      invalid_values: invalid_mode,
      in_place: false,
    })
  })

  // Helper: find interpolated y-value for NaN positions in an array
  function find_nan_positions(
    x_vals: number[],
    y_vals: number[],
    fallback: number,
  ): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = []
    for (let idx = 0; idx < y_vals.length; idx++) {
      if (Number.isFinite(y_vals[idx])) continue
      result.push({ x: x_vals[idx], y: interpolate_at_index(y_vals, idx, fallback) })
    }
    return result
  }

  let multi_series_nan_markers = $derived({
    temp_nan: find_nan_positions(
      multi_series_data.x,
      multi_series_data.y_arrays[0],
      25,
    ),
    pressure_nan: find_nan_positions(
      multi_series_data.x,
      multi_series_data.y_arrays[1],
      101,
    ),
  })

  // Trajectory demo data - a spiral path where NaN in any coordinate removes that point from all
  let xyz_data = $derived.by(() => {
    void regenerate_counter
    const length = 50
    // Spiral trajectory: x and y are coordinates, t is the parameter (like time)
    const t_vals = Array.from({ length }, (_, idx) => idx)
    const x_vals = t_vals.map((t) => 10 + 8 * Math.cos(t * 0.25) * (1 + t * 0.02))
    const y_vals = t_vals.map((t) => 10 + 8 * Math.sin(t * 0.25) * (1 + t * 0.02))
    // Add NaN at different positions - these points will be removed from BOTH x and y
    x_vals[15] = NaN // NaN in x at t=15
    y_vals[35] = NaN // NaN in y at t=35
    x_vals[42] = NaN // another NaN in x
    return { x: x_vals, y: y_vals, z: t_vals } // z is just the time/index parameter
  })

  let xyz_cleaned = $derived.by(() => {
    return clean_xyz(xyz_data.x, xyz_data.y, xyz_data.z, {
      invalid_values: invalid_mode,
      in_place: false,
    })
  })

  // Helper: find interpolated positions for NaN in 2D trajectory
  function find_trajectory_nan_positions(
    x_vals: number[],
    y_vals: number[],
    fallback = 10,
  ): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = []
    for (let idx = 0; idx < x_vals.length; idx++) {
      if (Number.isFinite(x_vals[idx]) && Number.isFinite(y_vals[idx])) continue
      result.push({
        x: interpolate_at_index(x_vals, idx, fallback),
        y: interpolate_at_index(y_vals, idx, fallback),
      })
    }
    return result
  }

  let trajectory_nan_markers = $derived(
    find_trajectory_nan_positions(xyz_data.x, xyz_data.y),
  )

  // Reference lines for instability marker
  let ref_lines = $derived.by(() => {
    if (instability_result.detected && data_type === `unstable`) {
      return [
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
    }
    return []
  })

  // Quality report formatting
  function format_quality(quality: typeof cleaned_result.quality): string {
    const parts = []
    if (quality.points_removed > 0) parts.push(`${quality.points_removed} removed`)
    if (quality.invalid_values_found > 0) {
      parts.push(`${quality.invalid_values_found} invalid`)
    }
    if (quality.bounds_violations > 0) {
      parts.push(`${quality.bounds_violations} bounds violations`)
    }
    if (quality.oscillation_detected) parts.push(`oscillation detected`)
    return parts.length > 0 ? parts.join(`, `) : `No issues found`
  }

  // Syntax highlighting helpers
  const kw = (s: string) => `<span class="kw">${s}</span>`
  const str = (s: string) => `<span class="str">'${s}'</span>`
  const num = (s: number | string) => `<span class="num">${s}</span>`
  const typ = (s: string) => `<span class="typ">${s}</span>`
  const fn = (s: string) => `<span class="fn">${s}</span>`
  const cmt = (s: string) => `<span class="cmt">// ${s}</span>`
  const prop = (s: string) => `<span class="prop">${s}</span>`

  // Live code example with syntax highlighting
  let live_code_html = $derived.by(() => {
    // Build config lines with highlighting
    const config_lines: string[] = []
    config_lines.push(`  ${prop(`invalid_values`)}: ${str(invalid_mode)},`)
    config_lines.push(
      `  ${prop(`oscillation_threshold`)}: ${num(oscillation_threshold)},`,
    )
    config_lines.push(`  ${prop(`window_size`)}: ${num(window_size)},`)
    config_lines.push(`  ${prop(`truncation_mode`)}: ${str(truncation_mode)},`)

    if (apply_bounds) {
      config_lines.push(
        `  ${prop(`bounds`)}: { ${prop(`min`)}: ${num(bounds_min)}, ${prop(`max`)}: ${
          num(bounds_max)
        }, ${prop(`mode`)}: ${str(bounds_mode)} },`,
      )
    }

    if (apply_smoothing) {
      if (smoothing_type === `savgol`) {
        config_lines.push(
          `  ${prop(`smooth`)}: { ${prop(`type`)}: ${str(`savgol`)}, ${
            prop(`window`)
          }: ${num(smoothing_window)}, ${prop(`polynomial_order`)}: ${num(2)} },`,
        )
      } else {
        config_lines.push(
          `  ${prop(`smooth`)}: { ${prop(`type`)}: ${str(`moving_avg`)}, ${
            prop(`window`)
          }: ${num(smoothing_window)} },`,
        )
      }
    }

    config_lines.push(`  ${prop(`in_place`)}: ${kw(`false`)},`)

    const x_preview = raw_data.x.slice(0, 5).map((v) => num(v)).join(`, `)
    const y_preview = raw_data.y.slice(0, 5)
      .map((v) => Number.isFinite(v) ? num(v.toFixed(1)) : kw(`NaN`))
      .join(`, `)

    return `${kw(`import`)} { ${fn(`clean_series`)} } ${kw(`from`)} ${
      str(`$lib/plot`)
    }
${kw(`import type`)} { ${typ(`DataSeries`)}, ${typ(`CleaningConfig`)} } ${
      kw(`from`)
    } ${str(`$lib/plot`)}

${kw(`const`)} series: ${typ(`DataSeries`)} = {
  ${prop(`x`)}: [${x_preview}, ...],
  ${prop(`y`)}: [${y_preview}, ...],
}

${kw(`const`)} config: ${typ(`CleaningConfig`)} = {
${config_lines.join(`\n`)}
}

${kw(`const`)} { series: cleaned, quality } = ${fn(`clean_series`)}(series, config)
${cmt(`Result: ${cleaned_result.series.x.length} points (${cleaned_result.quality.points_removed} removed)`)}
${cmt(`quality.invalid_values_found = ${cleaned_result.quality.invalid_values_found}`)}
${cmt(`quality.oscillation_detected = ${cleaned_result.quality.oscillation_detected}`)}`
  })
</script>

<h1>Data Cleaning Demo</h1>

<p class="intro">
  Interactive demonstration of data cleaning utilities for handling noisy, erratic, or
  unreliable scientific data. Generate various types of problematic data and experiment
  with different filtering strategies.
</p>

<section class="controls-panel">
  <h3>Data Generation</h3>

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
        <input
          type="range"
          bind:value={nan_probability}
          min="0.02"
          max="0.3"
          step="0.02"
        />
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

  <h3>Cleaning Options</h3>

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
      <input
        type="range"
        bind:value={oscillation_threshold}
        min="0.5"
        max="5"
        step="0.1"
      />
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
  <h2>Single Series Cleaning</h2>

  <div class="quality-report">
    <strong>Quality Report:</strong>
    {format_quality(cleaned_result.quality)}
    <span class="point-count">
      ({raw_data.x.length} → {cleaned_result.series.x.length} points)
    </span>
    {#if instability_result.detected}
      <span class="instability-badge">
        ⚠️ Instability at x={instability_result.onset_x.toFixed(0)} (score:
        {instability_result.combined_score.toFixed(2)})
      </span>
    {/if}
  </div>

  <ScatterPlot
    series={plot_series}
    {ref_lines}
    x_axis={{ label: `X (index)` }}
    y_axis={{ label: `Y Value` }}
    legend={{ layout: `horizontal`, style: `justify-content: center;` }}
    style="height: 400px"
  >
    {#snippet tooltip({ x, y, label })}
      <strong>{label}</strong><br />
      x: {x.toFixed(1)}, y: {Number.isFinite(y) ? y.toFixed(2) : `NaN`}
    {/snippet}
  </ScatterPlot>

  <div class="code-block">
    <pre><code>{@html live_code_html}</code></pre>
  </div>
</section>

<section class="plot-section">
  <h2>Multi-Series Cleaning (Correlated Data)</h2>
  <p class="description">
    For <em>correlated</em> measurements (e.g., temperature and pressure from the same
    sensor at each timestep), if one reading is invalid, the comparison at that point is
    meaningless. Here, synchronized filtering removes the entire row when <em>any</em>
    series has a bad value.
  </p>

  <div class="quality-report">
    <strong>Result:</strong>
    {multi_series_data.x.length} → {multi_series_cleaned.x.length} timesteps (Temp: {
      multi_series_cleaned.quality[0].invalid_values_found
    } glitches, Pressure: {multi_series_cleaned.quality[1].invalid_values_found} glitches)
  </div>

  <div class="multi-series-grid">
    <div>
      <h4>Raw Data (NaN positions marked)</h4>
      <ScatterPlot
        series={[
          {
            x: multi_series_data.x.filter((_, idx) =>
              Number.isFinite(multi_series_data.y_arrays[0][idx])
            ),
            y: multi_series_data.y_arrays[0].filter((y) => Number.isFinite(y)),
            label: `Temperature`,
            point_style: { fill: `#e74c3c`, radius: 4 },
            line_style: { stroke: `#e74c3c`, stroke_width: 1.5 },
            markers: `line+points`,
          },
          {
            x: multi_series_data.x.filter((_, idx) =>
              Number.isFinite(multi_series_data.y_arrays[1][idx])
            ),
            y: multi_series_data.y_arrays[1].filter((y) => Number.isFinite(y)),
            label: `Pressure`,
            point_style: { fill: `#3498db`, radius: 4 },
            line_style: { stroke: `#3498db`, stroke_width: 1.5 },
            markers: `line+points`,
          },
          ...(multi_series_nan_markers.temp_nan.length > 0
            ? [{
              x: multi_series_nan_markers.temp_nan.map((p) => p.x),
              y: multi_series_nan_markers.temp_nan.map((p) => p.y),
              label: `Temp NaN (${multi_series_nan_markers.temp_nan.length})`,
              point_style: {
                fill: `#9b59b6`,
                radius: 8,
                symbol_type: `Cross` as const,
              },
              markers: `points` as const,
            }]
            : []),
          ...(multi_series_nan_markers.pressure_nan.length > 0
            ? [{
              x: multi_series_nan_markers.pressure_nan.map((p) => p.x),
              y: multi_series_nan_markers.pressure_nan.map((p) => p.y),
              label:
                `Pressure NaN (${multi_series_nan_markers.pressure_nan.length})`,
              point_style: {
                fill: `#8e44ad`,
                radius: 8,
                symbol_type: `Cross` as const,
              },
              markers: `points` as const,
            }]
            : []),
        ]}
        x_axis={{ label: `Time (s)` }}
        y_axis={{ label: `Value` }}
        style="height: 280px"
      />
    </div>
    <div>
      <h4>Cleaned (series aligned)</h4>
      <ScatterPlot
        series={[
          {
            x: multi_series_cleaned.x,
            y: multi_series_cleaned.cleaned_y[0],
            label: `Temperature`,
            point_style: { fill: `#27ae60`, radius: 4 },
            line_style: { stroke: `#27ae60`, stroke_width: 2 },
            markers: `line+points`,
          },
          {
            x: multi_series_cleaned.x,
            y: multi_series_cleaned.cleaned_y[1],
            label: `Pressure`,
            point_style: { fill: `#2980b9`, radius: 4 },
            line_style: { stroke: `#2980b9`, stroke_width: 2 },
            markers: `line+points`,
          },
        ]}
        x_axis={{ label: `Time (s)` }}
        y_axis={{ label: `Value` }}
        style="height: 280px"
      />
    </div>
  </div>
</section>

<section class="plot-section">
  <h2>Trajectory Alignment</h2>
  <p class="description">
    A spiral trajectory with NaN values at t=15, 35, and 42. When <em>any</em> coordinate
    (x or y) has NaN, that entire point is removed from <em>both</em> arrays, keeping the
    trajectory synchronized.
  </p>

  <div class="quality-report">
    <strong>Result:</strong>
    {xyz_data.x.length} → {xyz_cleaned.x.length} points ({
      xyz_cleaned.quality.invalid_values_found
    } invalid values removed from all coordinates)
  </div>

  <div class="multi-series-grid">
    <div>
      <h4>Raw Data (NaN positions marked)</h4>
      <ScatterPlot
        series={[
          {
            x: xyz_data.x.filter((x, idx) =>
              Number.isFinite(x) && Number.isFinite(xyz_data.y[idx])
            ),
            y: xyz_data.y.filter((y, idx) =>
              Number.isFinite(y) && Number.isFinite(xyz_data.x[idx])
            ),
            label: `Trajectory`,
            point_style: { fill: `#e74c3c`, radius: 4 },
            line_style: { stroke: `#e74c3c`, stroke_width: 1.5 },
            markers: `line+points`,
          },
          ...(trajectory_nan_markers.length > 0
            ? [{
              x: trajectory_nan_markers.map((p) => p.x),
              y: trajectory_nan_markers.map((p) => p.y),
              label: `NaN points (${trajectory_nan_markers.length})`,
              point_style: {
                fill: `#9b59b6`,
                radius: 10,
                symbol_type: `Cross` as const,
              },
              markers: `points` as const,
            }]
            : []),
        ]}
        x_axis={{ label: `X position` }}
        y_axis={{ label: `Y position` }}
        style="height: 300px"
      />
    </div>
    <div>
      <h4>Cleaned (NaN points removed)</h4>
      <ScatterPlot
        series={[
          {
            x: xyz_cleaned.x,
            y: xyz_cleaned.y,
            label: `Cleaned trajectory`,
            point_style: { fill: `#27ae60`, radius: 4 },
            line_style: { stroke: `#27ae60`, stroke_width: 1.5 },
            markers: `line+points`,
          },
        ]}
        x_axis={{ label: `X position` }}
        y_axis={{ label: `Y position` }}
        style="height: 300px"
      />
    </div>
  </div>
</section>

<section class="explanation">
  <h2>How It Works</h2>
  <ul>
    <li>
      <strong>Invalid Values:</strong> Remove,
      <a href="https://en.wikipedia.org/wiki/Interpolation">interpolate</a>, or keep
      <a href="https://en.wikipedia.org/wiki/NaN">NaN</a>/Infinity
    </li>
    <li>
      <strong>Oscillation Detection:</strong> Finds unstable regions via
      <a href="https://en.wikipedia.org/wiki/Numerical_differentiation">derivative</a>
      analysis
    </li>
    <li>
      <strong>Bounds:</strong>
      <a href="https://en.wikipedia.org/wiki/Clamping_(graphics)">Clamp</a>, filter, or
      nullify out-of-range values
    </li>
    <li>
      <strong>Smoothing:</strong>
      <a href="https://en.wikipedia.org/wiki/Moving_average">Moving average</a> or
      <a href="https://en.wikipedia.org/wiki/Savitzky%E2%80%93Golay_filter"
      >Savitzky-Golay</a> filtering
    </li>
    <li><strong>Alignment:</strong> Multi-series and 3D data stay synchronized</li>
    <li>
      <strong>Quality Reports:</strong> Track points removed, violations, and issues found
    </li>
  </ul>
</section>

<style>
  .intro {
    font-size: 1.1em;
    opacity: 0.9;
    max-width: 800px;
    margin: 0 auto 2em;
    text-align: center;
  }
  .controls-panel {
    background: var(--surface-bg-hover, rgba(255, 255, 255, 0.02));
    border-radius: 8px;
    padding: 0.6em 1.2em;
    margin-bottom: 1.5em;
    h3 {
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
  .point-count {
    opacity: 0.7;
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
    h4 {
      margin: 0 0 0.5em;
      text-align: center;
    }
  }
  .explanation {
    margin-top: 3em;
    padding-top: 2em;
    border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    ul {
      margin: 0.5em 0 0;
      padding-left: 1.5em;
    }
    li {
      margin-bottom: 0.3em;
    }
  }
  .code-block {
    margin-top: 1.5em;
    pre {
      margin: 0;
      padding: 1em;
      overflow-x: auto;
      background: #1e1e2e;
      border-radius: 6px;
    }
    code {
      font-family:
        ui-monospace,
        'Cascadia Code',
        'Source Code Pro',
        Menlo,
        Consolas,
        'DejaVu Sans Mono',
        monospace;
      font-size: 0.85em;
      line-height: 1.6;
      color: #cdd6f4;
      white-space: pre;
    }
    /* Syntax highlighting (Catppuccin Mocha) */
    :global(.kw) {
      color: #cba6f7;
    }
    :global(.str) {
      color: #a6e3a1;
    }
    :global(.num) {
      color: #fab387;
    }
    :global(.typ) {
      color: #89dceb;
    }
    :global(.fn) {
      color: #89b4fa;
    }
    :global(.cmt) {
      color: #6c7086;
      font-style: italic;
    }
    :global(.prop) {
      color: #f5c2e7;
    }
  }
  @media (max-width: 600px) {
    .control-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
