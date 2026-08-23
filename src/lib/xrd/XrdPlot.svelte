<script lang="ts">
  import { add_alpha, plot_color } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import StatusMessage from '$lib/feedback/StatusMessage.svelte'
  import * as io from '$lib/io'
  import { format_value } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type {
    AxisConfig,
    BarHandlerProps,
    BarSeries,
    DataSeries,
    ScatterHandlerProps,
  } from '$lib/plot'
  import { BarPlot, ScatterPlot } from '$lib/plot'
  import { add_xrd_pattern } from '$lib/xrd/calc-xrd'
  import type { ComponentProps } from 'svelte'
  import type { RadiationType } from '$lib/scattering'
  import type { BroadeningParams } from './broadening'
  import { compute_broadened_pattern, DEFAULT_BROADENING } from './broadening'
  import { decimate_pattern, format_hkl } from './index'
  import type { Hkl, HklFormat, PatternEntry, XrdPattern } from './index'

  // Measured scans can run to 10⁵ points; the stick/profile views stay responsive at this
  // budget while the peak-preserving thinning keeps every significant maximum
  const MAX_RENDERED_POINTS = 1000

  function is_xrd_pattern(obj: unknown): obj is XrdPattern {
    const { x: x_vals, y: y_vals } = (obj ?? {}) as { x?: unknown; y?: unknown }
    return Array.isArray(x_vals) && Array.isArray(y_vals) && x_vals.length === y_vals.length
  }

  let {
    patterns,
    peak_width = 0.5,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    orientation = `vertical`,
    wavelength = null,
    radiation = $bindable(`xray`),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    x_axis = {},
    y_axis = {},
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(),
    broadening_enabled = $bindable(false),
    broadening_params = $bindable({ ...DEFAULT_BROADENING }),
    ...rest
  }: ComponentProps<typeof BarPlot> &
    ComponentProps<typeof ScatterPlot> & {
      patterns:
        | XrdPattern
        | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>
        | PatternEntry[]
      peak_width?: number
      annotate_peaks?: number // int => top-k, float in (0,1) => threshold of max
      hkl_format?: HklFormat
      show_angles?: boolean | null
      wavelength?: number | null
      // Probe used when recomputing a pattern from a dropped structure file. Neutron and
      // electron both require an explicit `wavelength` (no anode default exists for them).
      radiation?: RadiationType
      x_axis?: AxisConfig
      y_axis?: AxisConfig
      allow_file_drop?: boolean
      on_file_drop?: (
        content: string | ArrayBuffer,
        filename: string,
        metadata: io.FileLoadMeta,
      ) => Promise<void> | void
      loading?: boolean
      error_msg?: string
      broadening_enabled?: boolean
      broadening_params?: BroadeningParams
    } = $props()

  let dropped_entries = $state<PatternEntry[]>([])

  // Miller indices of one peak, joined for a bar label or a tooltip line
  const join_hkls = (hkls: Hkl[] | undefined): string =>
    hkl_format && hkls ? hkls.map((hkl_val) => format_hkl(hkl_val, hkl_format)).join(`, `) : ``

  // Legend label and colour, shared by the stick and profile views. Overlapping series get
  // 60% alpha so a peak sitting behind another still shows through.
  const series_style = (entry: PatternEntry, entry_idx: number) => ({
    label: pattern_entries.length > 1 ? entry.label : ``,
    color: add_alpha(
      entry.color ?? plot_color(entry_idx),
      pattern_entries.length > 1 ? 0.6 : 1,
    ),
  })

  // Normalize various input shapes to a consistent array of { label, pattern, color }
  const pattern_entries = $derived.by<PatternEntry[]>(() => {
    if (!patterns) return []
    const base_entries = Array.isArray(patterns)
      ? (patterns as PatternEntry[])
      : is_xrd_pattern(patterns)
        ? [{ label: `XRD Pattern`, pattern: patterns as XrdPattern }]
        : Object.entries(
            patterns as Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>,
          ).map(([label, value]) =>
            `pattern` in value ? { label, ...value } : { label, pattern: value as XrdPattern },
          )
    // Merge user-provided patterns with any dropped-on-the-fly entries. Only measured scans
    // (no hkls) are thinned: every reflection of a computed stick pattern is a labelled peak
    return [...base_entries, ...dropped_entries].map((entry) => ({
      ...entry,
      pattern: entry.pattern.hkls
        ? entry.pattern
        : decimate_pattern(entry.pattern, MAX_RENDERED_POINTS),
    }))
  })

  // Compute global max intensity for normalization (as in pymatviz xrd_pattern)
  const global_max_intensity = $derived.by(() => {
    let max_val = 0
    for (const entry of pattern_entries) {
      for (const intensity of entry.pattern.y) if (intensity > max_val) max_val = intensity
    }
    return max_val || 1
  })

  // Overall 2θ domain (degrees). Looped rather than spread: Math.min(...xs) over a
  // multi-thousand-point profile can overflow the argument stack.
  const angle_range = $derived.by((): Vec2 => {
    let [min_x, max_x] = [Infinity, 0]
    for (const entry of pattern_entries) {
      for (const angle of entry.pattern.x) {
        if (angle < min_x) min_x = angle
        if (angle > max_x) max_x = angle
      }
    }
    if (!Number.isFinite(min_x)) return [0, 90] // every pattern was empty
    return [min_x > 10 ? Math.floor(min_x) : 0, Math.ceil(max_x)]
  })

  // Scaled intensities are normalized to 0..100, add 10% top padding for peak labels
  const intensity_range: Vec2 = [0, 110]

  // Build BarPlot series from entries (for Discrete/Stick view)
  const bar_series = $derived.by<BarSeries[]>(() => {
    if (broadening_enabled) return [] // Optimization: skip if not used

    return pattern_entries.map((entry, entry_idx) => {
      const xs = entry.pattern.x
      const ys = entry.pattern.y.map((val) => ((val || 0) / global_max_intensity) * 100)
      const metadata: Record<string, unknown>[] = []
      const labels: (string | null)[] = []

      // Determine which peaks to annotate
      const selected_indices: number[] = []
      if (annotate_peaks > 0) {
        const threshold = annotate_peaks < 1 ? annotate_peaks * 100 : -Infinity
        const max_peaks = annotate_peaks < 1 ? Infinity : Math.floor(annotate_peaks)
        // Strongest first, so a crowded neighbourhood is won by its tallest peak
        const candidates = ys
          .map((y_val, idx) => ({ y_val, idx }))
          .filter(({ y_val }) => y_val > threshold)
          .toSorted((peak_a, peak_b) => peak_b.y_val - peak_a.y_val)
          .slice(0, max_peaks)
        // Drop a label sitting within 3% of the x-range of one already kept, else they
        // overlap. Taken off the shared domain rather than spreading `xs`, which can be a
        // multi-thousand-point pre-broadened profile even in stick view (see angle_range).
        const min_spacing = (angle_range[1] - angle_range[0]) * 0.03
        for (const { idx } of candidates) {
          const too_close = selected_indices.some(
            (kept_idx) => Math.abs(xs[kept_idx] - xs[idx]) < min_spacing,
          )
          if (!too_close) selected_indices.push(idx)
        }
      }

      for (let idx = 0; idx < xs.length; idx++) {
        const hkls_objs = entry.pattern.hkls?.[idx] ?? []
        const hkls: Hkl[] = hkls_objs
          .map((hkl_obj) => (Array.isArray(hkl_obj?.hkl) ? hkl_obj.hkl : null))
          .filter((hkl_val): hkl_val is Hkl => Array.isArray(hkl_val) && hkl_val.length === 3)
        const d_hkl = entry.pattern.d_hkls?.[idx]
        metadata.push({ hkls, d: d_hkl, label: entry.label })

        if (selected_indices.includes(idx)) {
          // Angles are shown by default only while the plot holds at most two patterns
          const with_angle = show_angles ?? pattern_entries.length <= 2
          const angle_text = with_angle ? `${format_value(xs[idx], `.2f`)}°` : ``
          labels.push([join_hkls(hkls), angle_text].filter(Boolean).join(` @ `))
        } else labels.push(null)
      }

      return {
        x: xs,
        y: ys,
        ...series_style(entry, entry_idx),
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

    // Normalize so the highest peak across ALL broadened profiles is 100: per-profile
    // normalization would lose relative scaling between patterns, while the stick-view
    // global max would make broadened peaks tiny (broadening spreads intensity)
    const broadened = pattern_entries.map((entry) =>
      compute_broadened_pattern(entry.pattern, broadening_params, angle_range),
    )
    let max_y = 1 // avoid div by zero
    for (const profile of broadened) {
      for (const y_val of profile.y) max_y = Math.max(max_y, y_val)
    }

    return broadened.map(
      (profile, entry_idx) =>
        ({
          x: profile.x,
          y: profile.y.map((y_val) => (y_val / max_y) * 100),
          ...series_style(pattern_entries[entry_idx], entry_idx),
          markers: `line`, // Only line for profile
          line_style: { stroke_width: 2 },
          visible: true,
        }) as DataSeries,
    )
  })

  // Dropped files: measured patterns are parsed, structure files get a computed pattern
  const drop_zone = io.file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: async (content, filename, metadata) => {
      if (on_file_drop) return on_file_drop(content, filename, metadata)
      const result = await add_xrd_pattern(content, filename, wavelength, radiation)
      if (result.error) error_msg = result.error
      else if (result.pattern) dropped_entries = [result.pattern, ...dropped_entries]
    },
    on_error: (msg) => (error_msg = msg),
    set_loading: (val) => {
      loading = val
      if (val) error_msg = undefined
    },
  })

  const [angle_label, intensity_label] = [`2θ (degrees)`, `Intensity (a.u.)`]
  // In the horizontal layout the 2θ and intensity axes trade places
  const is_horizontal = $derived(orientation === `horizontal`)

  // [key, label, tooltip, step, min?, max?]
  type BroadeningInput = [keyof BroadeningParams, string, string, number, number?, number?]
  const broadening_inputs: BroadeningInput[] = [
    [`U`, `U`, `Caglioti U parameter`, 0.001],
    [`V`, `V`, `Caglioti V parameter`, 0.001],
    [`W`, `W`, `Caglioti W parameter`, 0.001],
    [`shape_factor`, `η`, `Pseudo-Voigt shape factor (0=Gaussian, 1=Lorentzian)`, 0.05, 0, 1],
  ]
</script>

{#snippet readout(label: string, angle: number, intensity: number)}
  {@html sanitize_html(label)}<br />
  2θ: {format_value(angle, `.2f`)}°<br />
  Intensity: {format_value(intensity, `.1f`)}
{/snippet}

{#snippet broadening_controls_snippet()}
  <!-- Scoped to dropped files: this component gets finished patterns, never structures -->
  {#if allow_file_drop}
    <SettingsSection
      title="Dropped structure files"
      current_values={{ radiation }}
      on_reset={() => (radiation = `xray`)}
    >
      <label class="toggle">
        Compute with
        <select bind:value={radiation}>
          {#each [[`xray`, `X-rays`], [`neutron`, `Neutrons`], [`electron`, `Electrons`]] as const as [key, text] (key)}
            <option value={key}>{text}</option>
          {/each}
        </select>
      </label>
      <small>
        Applies to structure files dropped here; patterns already shown are not recomputed.
        {#if radiation !== `xray` && wavelength === null}
          {radiation} patterns also need an explicit <code>wavelength</code> prop in Å.
        {/if}
      </small>
    </SettingsSection>
  {/if}

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
      <div class="pane-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1ex">
        {#each broadening_inputs as [key, text, title, step, min, max] (key)}
          <label {title}>
            {text}:
            <input
              type="number"
              {step}
              {min}
              {max}
              bind:value={broadening_params[key]}
              class="param-input"
            />
          </label>
        {/each}
      </div>
    {/if}
  </SettingsSection>
{/snippet}

{#if pattern_entries.length === 0}
  <EmptyState
    class="xrd-empty-state"
    style={rest.style}
    {@attach drop_zone}
    role="region"
    aria-label="XRD drop zone"
  >
    {#if error_msg}
      <StatusMessage bind:message={error_msg} type="error" dismissible />
    {:else}
      <StatusMessage
        message={allow_file_drop
          ? `Drag and drop structure files (.cif, .json, etc.) or XRD data files (.xy, .csv, .ras, .uxd, .gsas, .xrdml, .brml, .raw, + .gz) here`
          : `No XRD data to display`}
      />
    {/if}
  </EmptyState>
{:else}
  <div class="xrd-plot-container" style={`position: relative; ${rest.style ?? ``}`}>
    {#if error_msg}
      <StatusMessage
        bind:message={error_msg}
        type="error"
        dismissible
        style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; max-width: 80%"
      />
    {/if}
    {#if broadening_enabled}
      <!-- Broadened Profile View -->
      {#snippet tooltip(info: ScatterHandlerProps)}
        {@render readout(info.label ?? ``, info.x, info.y)}
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
        {@attach drop_zone}
        class={rest.class}
        style={`overflow: visible; ${rest.style ?? ``}`}
        controls_extra={broadening_controls_snippet}
        bind:show_controls
        bind:controls_open
      />
    {:else}
      <!-- Discrete Stick View -->
      {#snippet tooltip(info: BarHandlerProps<{ label?: string; hkls?: Hkl[]; d?: number }>)}
        {@const d_spacing = info.metadata?.d}
        {@const hkl_text = join_hkls(info.metadata?.hkls)}
        {@render readout(info.metadata?.label ?? ``, info.x, info.y)}
        {#if hkl_text}<br />hkl: {hkl_text}{/if}
        {#if d_spacing != null}<br />d: {format_value(d_spacing, `.3f`)} Å{/if}
      {/snippet}

      <BarPlot
        {...rest}
        series={bar_series}
        bind:orientation
        x_axis={{
          label: is_horizontal ? intensity_label : angle_label,
          ...(is_horizontal ? y_axis : x_axis),
          range: is_horizontal ? intensity_range : angle_range,
        }}
        y_axis={{
          label: is_horizontal ? angle_label : intensity_label,
          ...(is_horizontal ? x_axis : y_axis),
          label_shift: { x: 2, ...(is_horizontal ? x_axis : y_axis).label_shift },
          range: is_horizontal ? angle_range : intensity_range,
        }}
        {tooltip}
        {@attach drop_zone}
        class={rest.class}
        style={`overflow: visible; ${rest.style ?? ``}`}
        controls_extra={broadening_controls_snippet}
        bind:show_controls
        bind:controls_open
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
  :global(.xrd-plot-container .dragover),
  :global(.xrd-empty-state.dragover) {
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
</style>
