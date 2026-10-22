<script lang="ts">
  import { track_settings } from '#lib/controls.js'
  import type {
    ScatterPlotOptions,
    BarPlotOptions,
    BarHandlerProps,
    BarSeries,
    DataSeries,
    ScatterHandlerProps,
  } from '#lib/plot/index.js'
  import { add_alpha, plot_color } from '#lib/colors/index.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { untrack } from 'svelte'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import * as file_io from '../io'
  import { format_value } from '#lib/labels.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import { to_error } from 'svelte-widgets/utils'
  import { SettingsSection } from '#lib/layout/index.js'
  import { array_extent, array_max, type Vec2 } from '#lib/math.js'
  import { BarPlot, ScatterPlot } from '#lib/plot/index.js'
  import { structure_drop_zone } from '#lib/plot/core/structure-input.js'
  import { structure_xrd_pattern } from '#lib/xrd/calc-xrd.js'
  import { is_xrd_data_file, parse_xrd_file } from './parse'
  import type { RadiationType } from '#lib/scattering/index.js'
  import type { BroadeningParams } from './broadening'
  import { compute_broadened_pattern, DEFAULT_BROADENING } from './broadening'
  import { decimate_pattern, format_hkl } from './index'
  import type { Hkl, HklFormat, PatternEntry, XrdPattern, XrdPeak } from './index'

  // Measured scans can run to 10⁵ points; the stick/profile views stay responsive at this
  // budget while the peak-preserving thinning keeps every significant maximum
  const MAX_RENDERED_POINTS = 1000
  type PeakMeta = { label?: string; hkls?: Hkl[]; d?: number }

  function is_xrd_pattern(obj: unknown): obj is XrdPattern {
    const { x: x_vals, y: y_vals } = (obj ?? {}) as { x?: unknown; y?: unknown }
    return Array.isArray(x_vals) && Array.isArray(y_vals) && x_vals.length === y_vals.length
  }

  let {
    patterns,
    peak_width = 0.8,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    orientation = `vertical`,
    wavelength = null,
    radiation = $bindable(`xray`),
    show_controls,
    controls_open = $bindable(false),
    x_axis = {},
    y_axis = {},
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    loading_message = `Reading dropped file…`,
    error_msg = $bindable(),
    broadening_enabled = $bindable(false),
    broadening_params = $bindable({ ...DEFAULT_BROADENING }),
    hovered_peak = $bindable(null),
    selected_peak = $bindable(null),
    on_bar_hover,
    on_bar_click,
    tooltip,
    ...rest
  }: Omit<BarPlotOptions & ScatterPlotOptions, `tooltip`> & {
    // the snippet receives the profile point (broadened) or the peak's bar (sticks)
    tooltip?: TooltipProp<ScatterHandlerProps | BarHandlerProps<PeakMeta>>
    patterns:
      | XrdPattern
      | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>
      | PatternEntry[]
    peak_width?: number // stick width in degrees 2θ
    annotate_peaks?: number // int => top-k, float in (0,1) => threshold of max
    hkl_format?: HklFormat
    show_angles?: boolean | null
    wavelength?: number | null
    // Probe used when recomputing a pattern from a dropped structure file. Neutron and
    // electron both require an explicit `wavelength` (no anode default exists for them).
    radiation?: RadiationType
    allow_file_drop?: boolean
    on_file_drop?: file_io.FileLoadCallback
    loading?: boolean
    // Empty-state text while `loading`
    loading_message?: string
    error_msg?: string
    broadening_enabled?: boolean
    broadening_params?: BroadeningParams
    // Stick under the pointer or keyboard focus (e.g. to draw diffraction_planes(peak.hkls) in a
    // Structure); profiles and the broadened view report none
    hovered_peak?: XrdPeak | null
    selected_peak?: XrdPeak | null // pinned (and labelled) by a click, unpinned by another
  } = $props()

  let dropped_entries = $state<PatternEntry[]>([])

  const is_profile = (pattern: XrdPattern): boolean => pattern.kind === `profile`

  // Representative hkl of each family merged into peak `idx` (empty for measured patterns)
  const peak_hkls = (pattern: XrdPattern, idx: number): Hkl[] =>
    pattern.hkls?.[idx]?.map((hkl_obj) => hkl_obj.hkl) ?? []
  // Intensity on the plot's 0..100 scale, shared by every pattern
  const scaled_intensity = (val: number): number => ((val || 0) / global_max_intensity) * 100

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
    // Merge user-provided patterns with any dropped-on-the-fly entries. Only profiles are
    // thinned: every reflection of a stick pattern is a peak, labelled or not
    return [...base_entries, ...dropped_entries].map((entry) => ({
      ...entry,
      pattern: is_profile(entry.pattern)
        ? decimate_pattern(entry.pattern, MAX_RENDERED_POINTS)
        : entry.pattern,
    }))
  })

  // Global max intensity for normalization (as in pymatviz xrd_pattern); 1 when every
  // pattern is empty or flat so the division below stays finite
  const global_max_intensity = $derived(
    Math.max(0, ...pattern_entries.map((entry) => array_max(entry.pattern.y))) || 1,
  )

  // Overall 2θ domain (degrees)
  const angle_range = $derived.by((): Vec2 => {
    const extents = pattern_entries.map((entry) => array_extent(entry.pattern.x))
    const min_x = Math.min(...extents.map(([lower]) => lower))
    const max_x = Math.max(0, ...extents.map(([, upper]) => upper))
    if (!Number.isFinite(min_x)) return [0, 90] // every pattern was empty
    return [min_x > 10 ? Math.floor(min_x) : 0, Math.ceil(max_x)]
  })

  // Scaled intensities are normalized to 0..100, add 10% top padding for peak labels
  const intensity_range: Vec2 = [0, 110]

  // Stick view series
  const bar_series = $derived.by<BarSeries[]>(() => {
    if (broadening_enabled) return []

    return pattern_entries.map((entry, entry_idx) => {
      const x_values = entry.pattern.x
      const y_values = entry.pattern.y.map(scaled_intensity)

      // Determine which peaks to annotate
      const selected_indices: number[] = []
      if (annotate_peaks > 0) {
        const threshold = annotate_peaks < 1 ? annotate_peaks * 100 : -Infinity
        const max_peaks = annotate_peaks < 1 ? Infinity : Math.floor(annotate_peaks)
        // Strongest first, so a crowded neighbourhood is won by its tallest peak
        const candidates = y_values
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
            (kept_idx) => Math.abs(x_values[kept_idx] - x_values[idx]) < min_spacing,
          )
          if (!too_close) selected_indices.push(idx)
        }
      }
      if (selected_peak?.pattern_idx === entry_idx)
        selected_indices.push(selected_peak.peak_idx)
      const selected = new Set(selected_indices)
      // Angles are shown by default only while the plot holds at most two patterns
      const with_angle = show_angles ?? pattern_entries.length <= 2
      const metadata = x_values.map((_, idx) => ({
        hkls: peak_hkls(entry.pattern, idx),
        d: entry.pattern.d_hkls?.[idx],
        label: entry.label,
      }))
      const labels = metadata.map(({ hkls }, idx) => {
        if (!selected.has(idx)) return null
        const angle_text = with_angle ? `${format_value(x_values[idx], `.2f`)}°` : ``
        return [join_hkls(hkls), angle_text].filter(Boolean).join(` @ `)
      })

      // A profile is a sampled curve, not a set of reflections: draw it as a line
      const shape = is_profile(entry.pattern)
        ? { render_mode: `line` as const, markers: `line` as const }
        : { bar_width: peak_width }
      return {
        x: x_values,
        y: y_values,
        ...series_style(entry, entry_idx),
        ...shape,
        visible: true,
        metadata,
        labels,
      }
    })
  })

  // The stick at (pattern_idx, peak_idx) of the plotted entries, null for a profile sample
  const peak_at = (pattern_idx: number, peak_idx: number): XrdPeak | null => {
    const { pattern, label } = pattern_entries[pattern_idx]
    if (is_profile(pattern)) return null
    return {
      pattern_idx,
      peak_idx,
      label,
      two_theta: pattern.x[peak_idx],
      intensity: scaled_intensity(pattern.y[peak_idx]),
      hkls: peak_hkls(pattern, peak_idx),
      d_spacing: pattern.d_hkls?.[peak_idx],
    }
  }

  // A hovered or pinned peak names a reflection, its indices only locate it: on new patterns
  // re-read it there (fresh intensity scale) while the same stick still sits at them, else
  // drop it rather than label whatever peak those indices now name
  const resolve_peak = (peak: XrdPeak | null): XrdPeak | null => {
    if (!peak || peak.pattern_idx >= pattern_entries.length) return null
    const fresh = peak_at(peak.pattern_idx, peak.peak_idx)
    return fresh?.label === peak.label && fresh.two_theta === peak.two_theta ? fresh : null
  }
  $effect.pre(() => {
    void pattern_entries
    untrack(() => {
      hovered_peak = resolve_peak(hovered_peak)
      selected_peak = resolve_peak(selected_peak)
    })
  })

  // compute_broadened_pattern throws when a Caglioti triple drives FWHM² non-positive inside
  // `angle_range`, reachable from the spinners alone (V² <= 4UW couples all three, so no static
  // input `min` enforces it). Uncaught in a $derived the throw blanks the whole component, so
  // return the message and let the banner render it.
  // Profiles pass through untouched: they are already continuous, and broadening their
  // samples as if each were a reflection would widen every measured peak a second time
  const broadened = $derived.by<XrdPattern[] | string>(() => {
    if (!broadening_enabled) return []
    try {
      return pattern_entries.map(({ pattern }) =>
        is_profile(pattern)
          ? pattern
          : {
              ...compute_broadened_pattern(pattern, broadening_params, angle_range),
              kind: `profile`,
            },
      )
    } catch (exc) {
      return to_error(exc).message
    }
  })
  const broadening_error = $derived(typeof broadened === `string` ? broadened : undefined)

  // Broadened profile view series
  const scatter_series = $derived.by<DataSeries[]>(() => {
    if (typeof broadened === `string` || broadened.length === 0) return []

    // Broadened sticks are area-normalized while input profiles carry their own (often
    // count) scale, so the two groups share no unit: each is scaled so its true highest point
    // (often < 1 for normalized profiles) is 100, keeping relative heights within a group.
    const from_profile = pattern_entries.map(({ pattern }) => is_profile(pattern))
    const [sticks_max, profiles_max] = [false, true].map((profiles) => {
      const group = broadened.filter((_profile, idx) => from_profile[idx] === profiles)
      return Math.max(0, ...group.map((profile) => array_max(profile.y)))
    })

    return broadened.map((profile, entry_idx) => {
      const max_y = from_profile[entry_idx] ? profiles_max : sticks_max
      // broaden_peaks drops non-positive peaks, so max_y === 0 means an all-zero profile
      const y_values = max_y > 0 ? profile.y.map((y_val) => (y_val / max_y) * 100) : profile.y
      // ScatterPlot has no orientation of its own, so the horizontal layout swaps the data
      return {
        x: is_horizontal ? y_values : profile.x,
        y: is_horizontal ? profile.x : y_values,
        ...series_style(pattern_entries[entry_idx], entry_idx),
        markers: `line`,
        line_style: { stroke_width: 2 },
        visible: true,
      } as DataSeries
    })
  })

  // The latest drop's recoverable parse warnings, one dismissible notice
  let parse_warning_msg = $state<string>()
  // Dropped measured patterns are parsed here; structure files get a computed pattern
  const add_dropped = (label: string, pattern: XrdPattern) => {
    dropped_entries = [{ label, pattern }, ...dropped_entries]
  }
  const drop_zone = structure_drop_zone({
    allow: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    intercept: async (content, filename) => {
      if (!is_xrd_data_file(filename)) return false
      add_dropped(filename, await parse_xrd_file(content, filename))
      return true
    },
    on_structure: async (structure, filename) =>
      add_dropped(filename, await structure_xrd_pattern(structure, wavelength, radiation)),
    on_error: (msg) => (error_msg = msg),
    on_warning: (msg) => (parse_warning_msg = msg),
    set_loading: (val) => (loading = val),
  })

  const [angle_label, intensity_label] = [`2θ (degrees)`, `Intensity (a.u.)`]
  // In the horizontal layout the 2θ and intensity axes trade places
  const is_horizontal = $derived(orientation === `horizontal`)
  const plot_x_axis = $derived({
    label: is_horizontal ? intensity_label : angle_label,
    ...(is_horizontal ? y_axis : x_axis),
    range: is_horizontal ? intensity_range : angle_range,
  })
  const plot_y_axis = $derived({
    label: is_horizontal ? angle_label : intensity_label,
    ...(is_horizontal ? x_axis : y_axis),
    range: is_horizontal ? angle_range : intensity_range,
  })

  // [key, label, tooltip, step, min?, max?]
  type BroadeningInput = [keyof BroadeningParams, string, string, number, number?, number?]
  const broadening_inputs: BroadeningInput[] = [
    // U and W are non-negative by construction (only V is legitimately negative)
    [`U`, `U`, `Caglioti U parameter`, 0.001, 0],
    [`V`, `V`, `Caglioti V parameter`, 0.001],
    [`W`, `W`, `Caglioti W parameter`, 0.001, 0],
    [`shape_factor`, `η`, `Pseudo-Voigt shape factor (0=Gaussian, 1=Lorentzian)`, 0.05, 0, 1],
  ]

  const dropped_structure_files_settings = track_settings(() => ({ radiation }), {
    radiation: `xray`,
  })
  const broadening_settings = track_settings(
    () => ({ ...broadening_params, broadening_enabled }),
    { ...DEFAULT_BROADENING, broadening_enabled: false },
  )
</script>

{#snippet readout(label: string, angle: number, intensity: number)}
  <!-- a lone pattern's series has no label, which must not leave a blank first line -->
  {#if label}{@html sanitize_html(label)}<br />{/if}
  2θ: {format_value(angle, `.2f`)} <small>°</small><br />
  Intensity: {format_value(intensity, `.1f`)}
{/snippet}

{#snippet broadening_controls_snippet()}
  <!-- Scoped to dropped files: this component gets finished patterns, never structures -->
  {#if allow_file_drop}
    <SettingsSection
      title="Dropped structure files"
      changed_keys={dropped_structure_files_settings.changed_keys}
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
    changed_keys={broadening_settings.changed_keys}
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
        message={loading
          ? loading_message
          : allow_file_drop
            ? `Drag and drop structure files (.cif, .json, etc.) or XRD data files (.xy, .csv, .ras, .uxd, .gsas, .xrdml, .brml, .raw, + .gz) here`
            : `No XRD data to display`}
        style="border: none"
      />
    {/if}
  </EmptyState>
{:else}
  <div class="xrd-plot-container" style={`position: relative; ${rest.style ?? ``}`}>
    <ViewerNotices>
      {#if error_msg}
        <StatusMessage bind:message={error_msg} type="error" dismissible />
      {:else if broadening_error}
        <StatusMessage message={broadening_error} type="error" />
      {/if}
      <StatusMessage bind:message={parse_warning_msg} type="warning" dismissible />
    </ViewerNotices>
    {#if broadening_enabled}
      {#snippet profile_tooltip(info: ScatterHandlerProps)}
        {@render readout(
          info.label ?? ``,
          is_horizontal ? info.y : info.x,
          is_horizontal ? info.x : info.y,
        )}
      {/snippet}

      <ScatterPlot
        {...rest}
        series={scatter_series}
        x_axis={plot_x_axis}
        y_axis={plot_y_axis}
        tooltip={tooltip ?? profile_tooltip}
        {@attach drop_zone}
        style={`overflow: visible; ${rest.style ?? ``}`}
        controls_extra={broadening_controls_snippet}
        {show_controls}
        bind:controls_open
      />
    {:else}
      {#snippet peak_tooltip(info: BarHandlerProps<PeakMeta>)}
        {@const d_spacing = info.metadata?.d}
        {@const hkl_text = join_hkls(info.metadata?.hkls)}
        {@render readout(info.metadata?.label ?? ``, info.x, info.y)}
        {#if hkl_text}<br />hkl: {hkl_text}{/if}
        {#if d_spacing != null}<br />d: {format_value(d_spacing, `.3f`)} <small>Å</small>{/if}
      {/snippet}

      <BarPlot
        {...rest}
        series={bar_series}
        bind:orientation
        x_axis={plot_x_axis}
        y_axis={{ ...plot_y_axis, label_shift: { x: 2, ...plot_y_axis.label_shift } }}
        tooltip={tooltip ?? peak_tooltip}
        on_bar_hover={(data) => {
          hovered_peak = data && peak_at(data.series_idx, data.bar_idx)
          on_bar_hover?.(data)
        }}
        on_bar_click={(data) => {
          const { series_idx, bar_idx } = data
          const pinned =
            selected_peak?.pattern_idx === series_idx && selected_peak.peak_idx === bar_idx
          selected_peak = pinned ? null : peak_at(series_idx, bar_idx)
          on_bar_click?.(data)
        }}
        {@attach drop_zone}
        style={`overflow: visible; ${rest.style ?? ``}`}
        controls_extra={broadening_controls_snippet}
        {show_controls}
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
