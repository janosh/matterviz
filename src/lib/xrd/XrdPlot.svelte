<script lang="ts">
  import { EmptyState, SettingsSection, StatusMessage } from '$lib'
  import { add_alpha, PLOT_COLORS } from '$lib/colors'
  import {
    decompress_data_binary,
    decompress_file,
    detect_compression_format,
    handle_url_drop,
  } from '$lib/io'
  import { format_value } from '$lib/labels'
  import type {
    AxisConfig,
    BarHandlerProps,
    BarSeries,
    ControlsConfig,
    DataSeries,
    ScatterHandlerProps,
  } from '$lib/plot'
  import { BarPlot, ScatterPlot } from '$lib/plot'
  import { add_xrd_pattern } from '$lib/xrd/calc-xrd'
  import type { ComponentProps } from 'svelte'
  import type { BroadeningParams } from './broadening'
  import { compute_broadened_pattern, DEFAULT_BROADENING } from './broadening'
  import type { Hkl, HklFormat, PatternEntry, XrdPattern } from './index'

  function is_xrd_pattern(obj: unknown): obj is XrdPattern {
    if (!obj || typeof obj !== `object`) return false
    const record = obj as Record<string, unknown>
    return (
      Array.isArray(record.x) &&
      Array.isArray(record.y) &&
      record.x.length === record.y.length
    )
  }

  function format_hkl(hkl: Hkl, format: HklFormat): string {
    if (format === `compact`) {
      // Use crystallographic overbar notation for negative indices (e.g. 1̄ instead of -1)
      // Note: Requires font support for Unicode combining characters (U+0305)
      return hkl
        .map((val) => {
          // Use combining overline character (U+0305) for negative values
          // Apply overbar to each digit for multi-digit numbers
          if (val < 0) {
            const digits = String(Math.abs(val))
            return digits
              .split(``)
              .map((digit) => `${digit}\u0305`)
              .join(``)
          }
          return `${val}`
        })
        .join(``)
    }
    if (format === `full`) return `(${hkl.join(`, `)})`
    return ``
  }

  let {
    patterns,
    peak_width = 0.5,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    orientation = `vertical`,
    wavelength = null,
    x_axis = {},
    y_axis = {},
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(),
    broadening_enabled = $bindable(false),
    broadening_params = $bindable({ ...DEFAULT_BROADENING }),
    controls = {},
    ...rest
  }:
    & ComponentProps<typeof BarPlot>
    & ComponentProps<typeof ScatterPlot>
    & {
      patterns:
        | XrdPattern
        | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>
        | PatternEntry[]
      peak_width?: number
      annotate_peaks?: number // int => top-k, float in (0,1) => threshold of max
      hkl_format?: HklFormat
      show_angles?: boolean | null
      wavelength?: number | null
      x_axis?: AxisConfig
      y_axis?: AxisConfig
      allow_file_drop?: boolean
      on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
      loading?: boolean
      error_msg?: string
      broadening_enabled?: boolean
      broadening_params?: BroadeningParams
      controls?: ControlsConfig
    } = $props()

  let dragover = $state(false)
  let dropped_entries = $state<PatternEntry[]>([])

  // Normalize various input shapes to a consistent array of { label, pattern, color }
  const pattern_entries = $derived.by<PatternEntry[]>(() => {
    if (!patterns) return []
    const base_entries = Array.isArray(patterns)
      ? (patterns as PatternEntry[])
      : is_xrd_pattern(patterns)
      ? [{ label: `XRD Pattern`, pattern: patterns as XrdPattern }]
      : Object.entries(
        patterns as Record<
          string,
          XrdPattern | { pattern: XrdPattern; color?: string }
        >,
      ).map(([label, value]) =>
        `pattern` in value
          ? { label, ...value }
          : { label, pattern: value as XrdPattern }
      )
    // Merge user-provided patterns with any dropped-on-the-fly entries
    return [...base_entries, ...dropped_entries]
  })

  // Decide default show_angles
  const actual_show_angles = $derived(
    show_angles ?? pattern_entries.length <= 2,
  )

  // Compute global max intensity for normalization (as in pymatviz xrd_pattern)
  const global_max_intensity = $derived.by(() => {
    let max_val = 0
    for (const entry of pattern_entries) {
      for (const y of entry.pattern.y) if (y > max_val) max_val = y
    }
    return max_val || 1
  })

  // Compute overall 2θ domain (degrees)
  const angle_range = $derived.by(() => {
    if (pattern_entries.length === 0) return [0, 90] as [number, number] // Default range
    let min_x = Infinity
    let max_x = 0
    for (const entry of pattern_entries) {
      const entry_min = Math.min(...entry.pattern.x)
      const entry_max = Math.max(...entry.pattern.x)
      if (entry_min < min_x) min_x = entry_min
      if (entry_max > max_x) max_x = entry_max
    }
    // Use data min if it's significantly above 0, otherwise start at 0
    const x_min = min_x > 10 ? Math.floor(min_x) : 0
    return [x_min, Math.ceil(max_x)] as [number, number]
  })

  // Scaled intensities are normalized to 0..100, add 10% top padding for peak labels
  const intensity_range: [number, number] = [0, 110]

  // Build BarPlot series from entries (for Discrete/Stick view)
  const bar_series = $derived.by<BarSeries[]>(() => {
    if (broadening_enabled) return [] // Optimization: skip if not used

    const include_name = pattern_entries.length > 1
    // Add transparency when multiple series overlap
    const alpha = pattern_entries.length > 1 ? 0.6 : 1
    const scale = (y: number) => (y / global_max_intensity) * 100
    return pattern_entries.map((entry, entry_idx) => {
      const xs = entry.pattern.x
      const ys = entry.pattern.y.map((val) => scale(val || 0))
      const metadata: Record<string, unknown>[] = []
      const labels: (string | null)[] = []

      // Determine which peaks to annotate
      const intens = ys
      let selected_indices: number[] = []
      if (annotate_peaks && annotate_peaks > 0) {
        let candidates: { idx: number; y_val: number }[] = []
        if (annotate_peaks > 0 && annotate_peaks < 1) {
          const thresh = annotate_peaks * 100
          candidates = intens
            .map((y_val, idx) => ({ y_val, idx }))
            .filter(({ y_val }) => y_val > thresh)
        } else {
          const k = Math.min(intens.length, Math.floor(annotate_peaks))
          candidates = intens
            .map((y_val, idx) => ({ y_val, idx }))
            .sort((a, b) => b.y_val - a.y_val)
            .slice(0, k)
        }

        // Filter out overlapping labels: keep higher intensity peaks when x values are close
        // Min spacing as fraction of x-range to avoid overlaps (roughly 3% of range)
        const x_range = Math.max(...xs) - Math.min(...xs)
        const min_spacing = x_range * 0.03
        // Sort by intensity descending so we keep highest peaks first
        candidates.sort((a, b) => b.y_val - a.y_val)
        const kept: { idx: number; y_val: number }[] = []
        for (const cand of candidates) {
          const cand_x = xs[cand.idx]
          // Check if any already-kept peak is too close
          const too_close = kept.some(
            (kept_peak) => Math.abs(xs[kept_peak.idx] - cand_x) < min_spacing,
          )
          if (!too_close) kept.push(cand)
        }
        selected_indices = kept.map((kept_peak) => kept_peak.idx)
      }

      for (let idx = 0; idx < xs.length; idx++) {
        const hkls_objs = entry.pattern.hkls?.[idx] ?? []
        const hkls: Hkl[] = hkls_objs
          .map((h) => (Array.isArray(h?.hkl) ? h.hkl : null))
          .filter((h): h is Hkl => Array.isArray(h) && h.length === 3)
        const d_hkl = entry.pattern.d_hkls?.[idx]
        metadata.push({ hkls, d: d_hkl, label: entry.label })

        if (selected_indices.includes(idx)) {
          const angle_text = actual_show_angles
            ? `${format_value(xs[idx], `.2f`)}°`
            : ``
          const hkl_text = hkls && hkl_format
            ? hkls.map((h) => format_hkl(h, hkl_format)).join(`, `)
            : ``
          // Use @ separator between hkl and angle for better clarity
          const separator = hkl_text && angle_text ? ` @ ` : ``
          const text = [hkl_text, angle_text].filter(Boolean).join(separator)
          labels.push(text)
        } else labels.push(null)
      }

      const base_color = entry.color ?? PLOT_COLORS[entry_idx % PLOT_COLORS.length]
      return {
        x: xs,
        y: ys,
        label: include_name ? entry.label : ``,
        color: add_alpha(base_color, alpha),
        bar_width: Math.max(peak_width, 0.8),
        visible: true,
        metadata,
        labels,
      }
    })
  })

  // Build ScatterPlot series (for Broadened Profile view)
  const scatter_series = $derived.by<DataSeries[]>(() => {
    if (!broadening_enabled) return []

    const include_name = pattern_entries.length > 1
    // We rescale after broadening so that max peak is 100, matching stick view scale
    return pattern_entries
      .map((entry, entry_idx) => {
        const broadened = compute_broadened_pattern(
          entry.pattern,
          broadening_params,
          angle_range,
        )

        // Normalize broadened profile relative to GLOBAL max intensity of stick patterns?
        // Or normalize to 100 for *this* profile?
        // Usually we want relative intensities between patterns to be preserved if possible.
        // But broadening spreads intensity, so peak heights drop.
        // If we normalize each profile to 100 independently, we lose relative scaling between patterns.
        // If we normalize by global_max_intensity (from sticks), broadened peaks will be tiny.
        // Let's normalize such that the highest peak across ALL broadened patterns is 100.

        return {
          broadened,
          entry,
          entry_idx,
        }
      })
      .map(({ broadened, entry, entry_idx }, _, all_processed) => {
        // Find global max of all broadened patterns to normalize
        const all_ys = all_processed.flatMap((p) => p.broadened.y)
        const max_y = Math.max(...all_ys, 1) // Avoid div by zero

        const scale = (y: number) => (y / max_y) * 100
        const base_color = entry.color ?? PLOT_COLORS[entry_idx % PLOT_COLORS.length]
        // Add transparency when multiple series overlap
        const alpha = all_processed.length > 1 ? 0.6 : 1

        return {
          x: broadened.x,
          y: broadened.y.map(scale),
          label: include_name ? entry.label : ``,
          color: add_alpha(base_color, alpha),
          markers: `line`, // Only line for profile
          line_style: { stroke_width: 2 },
          visible: true,
        } as DataSeries
      })
  })

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return
    loading = true
    error_msg = undefined

    const compute_and_add = async (
      content: string | ArrayBuffer,
      filename: string,
    ) => {
      const result = await add_xrd_pattern(content, filename, wavelength)
      if (result.error) {
        error_msg = result.error
      } else if (result.pattern) {
        dropped_entries = [result.pattern, ...dropped_entries]
      }
    }

    try {
      // Handle URL-based drops
      const handled = await handle_url_drop(
        event,
        on_file_drop || compute_and_add,
      ).catch(() => false)
      if (handled) return

      const file = event.dataTransfer?.files?.[0]
      if (file) {
        try {
          const lower_name = file.name.toLowerCase()
          const compression_format = detect_compression_format(lower_name)
          // Get base filename without compression extension
          const base_name = compression_format
            ? lower_name.replace(/\.(gz|gzip)$/i, ``)
            : lower_name
          const base_ext = base_name.split(`.`).pop()

          // Handle .brml files (ZIP archives) - both plain and gzipped
          if (base_ext === `brml`) {
            let buffer = await file.arrayBuffer()
            // Decompress if gzipped
            if (compression_format === `gzip`) {
              buffer = await decompress_data_binary(buffer, `gzip`)
            }
            const output_name = base_name.endsWith(`.brml`)
              ? base_name
              : file.name.replace(/\.gz$/i, ``)
            await (on_file_drop || compute_and_add)(buffer, output_name)
          } else {
            // Text-based formats (.xy, .xye, .xrdml) - decompress_file handles .gz
            const { content, filename } = await decompress_file(file)
            if (content) await (on_file_drop || compute_and_add)(content, filename)
          }
        } catch (exc) {
          error_msg = `Failed to load file ${file.name}: ${
            exc instanceof Error ? exc.message : String(exc)
          }`
        }
      }
    } finally {
      loading = false
    }
  }

  const [angle_label, intensity_label] = [`2θ (degrees)`, `Intensity (a.u.)`]
</script>

{#snippet broadening_controls_snippet()}
  <SettingsSection
    title="Broadening"
    current_values={broadening_params}
    on_reset={() => {
      broadening_params = { ...DEFAULT_BROADENING }
      broadening_enabled = false
    }}
  >
    <label class="toggle">
      <input type="checkbox" bind:checked={broadening_enabled} />
      Simulate Broadening
    </label>

    {#if broadening_enabled}
      <div
        class="pane-grid"
        style="display: grid; grid-template-columns: 1fr 1fr; gap: 1ex"
      >
        <label title="Caglioti U parameter">U:
          <input
            type="number"
            step="0.001"
            bind:value={broadening_params.U}
            class="param-input"
          />
        </label>
        <label title="Caglioti V parameter">V:
          <input
            type="number"
            step="0.001"
            bind:value={broadening_params.V}
            class="param-input"
          />
        </label>
        <label title="Caglioti W parameter">W:
          <input
            type="number"
            step="0.001"
            bind:value={broadening_params.W}
            class="param-input"
          />
        </label>
        <label title="Pseudo-Voigt shape factor (0=Gaussian, 1=Lorentzian)">η:
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            bind:value={broadening_params.shape_factor}
            class="param-input"
          />
        </label>
      </div>
    {/if}
  </SettingsSection>
{/snippet}

{#if pattern_entries.length === 0}
  <EmptyState
    class="xrd-empty-state"
    style={rest.style}
    ondrop={allow_file_drop ? handle_file_drop : undefined}
    ondragover={allow_file_drop ? (evt) => evt.preventDefault() : undefined}
    role="region"
    aria-label="XRD drop zone"
  >
    {#if error_msg}
      <StatusMessage bind:message={error_msg} type="error" dismissible />
    {:else}
      <StatusMessage
        message={allow_file_drop
        ? `Drag and drop structure files (.cif, .json, etc.) or XRD data files (.xy, .xye, .xrdml, .brml, + .gz) here`
        : `No XRD data to display`}
      />
    {/if}
  </EmptyState>
{:else}
  <div class="xrd-plot-container" style={`position: relative; ${rest.style ?? ``}`}>
    {#if error_msg}
      <div class="error-overlay">
        <StatusMessage bind:message={error_msg} type="error" dismissible />
      </div>
    {/if}
    {#if broadening_enabled}
      <!-- Broadened Profile View -->
      {#snippet tooltip(info: ScatterHandlerProps)}
        {@const angle_text = `${format_value(info.x, `.2f`)}°`}
        {@const intensity_text = `${format_value(info.y, `.1f`)}`}
        {@html info.label ?? ``}<br />
        2θ: {angle_text}<br />
        Intensity: {intensity_text}
      {/snippet}

      <ScatterPlot
        {...rest}
        series={scatter_series}
        x_axis={{
          label: angle_label,
          ...x_axis,
          range: angle_range,
        }}
        y_axis={{
          label: intensity_label,
          ...y_axis,
          range: intensity_range,
        }}
        {tooltip}
        ondrop={handle_file_drop}
        ondragover={(event) => {
          event.preventDefault()
          if (!allow_file_drop) return
          dragover = true
        }}
        ondragleave={(event) => {
          event.preventDefault()
          dragover = false
        }}
        class={(rest.class ?? ``) + (dragover ? ` dragover` : ``)}
        style={`overflow: visible; ${rest.style ?? ``}`}
        {controls}
        controls_extra={broadening_controls_snippet}
      />
    {:else}
      <!-- Discrete Stick View -->
      {#snippet tooltip(
    info: BarHandlerProps<{ label?: string; hkls?: Hkl[]; d?: number }>,
  )}
        {@const angle_text = `${format_value(info.x, `.2f`)}°`}
        {@const intensity_text = `${format_value(info.y, `.1f`)}`}
        {@const hkls = info.metadata?.hkls}
        {@const d = info.metadata?.d}
        {@const hkl_text = hkls && hkl_format
      ? hkls.map((hkl: Hkl) => format_hkl(hkl, hkl_format)).join(`, `)
      : ``}
        {@const d_text = d != null ? `${format_value(d, `.3f`)} Å` : ``}
        {@html info.metadata?.label ?? ``}<br />
        2θ: {angle_text}<br />
        Intensity: {intensity_text}
        {#if hkl_text}<br />hkl: {hkl_text}{/if}
        {#if d_text}<br />d: {d_text}{/if}
      {/snippet}

      <BarPlot
        {...rest}
        series={bar_series}
        bind:orientation
        x_axis={{
          label: orientation === `horizontal` ? intensity_label : angle_label,

          ...(orientation === `horizontal` ? y_axis : x_axis),
          label_shift: {
            y: 20,
            ...(orientation === `horizontal` ? y_axis : x_axis).label_shift,
          },
          range: orientation === `horizontal` ? intensity_range : angle_range,
        }}
        y_axis={{
          label: orientation === `horizontal` ? angle_label : intensity_label,
          ...(orientation === `horizontal` ? x_axis : y_axis),
          label_shift: {
            x: 2,
            ...(orientation === `horizontal` ? x_axis : y_axis).label_shift,
          },
          range: orientation === `horizontal` ? angle_range : intensity_range,
        }}
        {tooltip}
        ondrop={handle_file_drop}
        ondragover={(event) => {
          event.preventDefault()
          if (!allow_file_drop) return
          dragover = true
        }}
        ondragleave={(event) => {
          event.preventDefault()
          dragover = false
        }}
        class={(rest.class ?? ``) + (dragover ? ` dragover` : ``)}
        style={`overflow: visible; ${rest.style ?? ``}`}
        show_controls={controls.show}
        controls_open={controls.open}
        controls_toggle_props={controls.toggle_props}
        controls_pane_props={controls.pane_props}
        controls_extra={broadening_controls_snippet}
      />
    {/if}
  </div>
{/if}

<style>
  .xrd-plot-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    height: 100%;
  }
  /* Hide controls toggle by default, show on hover */
  .xrd-plot-container :global(.pane-toggle) {
    opacity: 0;
    transition: opacity 0.2s;
  }
  .xrd-plot-container:hover :global(.pane-toggle),
  .xrd-plot-container :global(.pane-toggle:focus-visible),
  .xrd-plot-container :global(.pane-toggle[aria-expanded='true']) {
    opacity: 1;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 500;
  }
  .param-input {
    width: 4.5em;
    padding: 2px 4px;
    border: 1px solid var(--border-color, #ccc);
    box-sizing: border-box;
    border-radius: 3px;
    background: transparent;
    color: inherit;
  }
  :global(.xrd-plot-container .dragover) {
    outline: 2px dashed var(--primary-color, cornflowerblue);
    outline-offset: -2px;
    background: rgba(100, 149, 237, 0.1);
  }
  :global(.xrd-empty-state) {
    min-height: 200px;
    border: 2px dashed var(--border-color, #ccc);
    border-radius: 8px;
    background: light-dark(rgba(0, 0, 0, 0.02), rgba(255, 255, 255, 0.02));
  }
  :global(.xrd-empty-state .message) {
    max-width: 80%;
  }
  .error-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10;
    max-width: 80%;
  }
  .error-overlay :global(.message) {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
</style>
