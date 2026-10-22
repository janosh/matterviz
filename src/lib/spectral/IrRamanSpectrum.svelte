<script lang="ts">
  import { TooltipValue } from '#lib/tooltip/index.js'
  import { track_settings } from '#lib/controls.js'
  import type { ScatterHandlerProps, ScatterPlotOptions } from '#lib/plot/index.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import { format_num } from '#lib/labels.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import { array_extent, array_max, type Vec2 } from '#lib/math.js'
  import type {
    AxisConfig,
    DataSeries,
    Orientation,
    UserContentProps,
  } from '#lib/plot/core/types.js'
  import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
  import { plot_area_line } from '#lib/plot/core/layout.js'
  import {
    convert_frequencies,
    frequency_unit_label,
    frequency_unit_text,
    parse_frequency_unit,
  } from './frequency-units'
  import FrequencyUnitSelect from './FrequencyUnitSelect.svelte'
  import { density_divisor, NORMALIZATION_MODES } from './helpers'
  import {
    broaden_spectrum,
    peak_mode_indices,
    spectrum_kind_label,
    spectrum_sticks,
    to_transmittance,
  } from './ir-raman'
  import type {
    FrequencyUnit,
    NormalizationMode,
    SpectrumKind,
    SpectrumPresentation,
    VibrationalSpectrum,
  } from './types'

  let {
    spectrum,
    kind = $bindable(`ir`),
    units = $bindable(`cm^-1`),
    fwhm = $bindable(10),
    shape_factor = $bindable(0.5),
    normalize = $bindable(`max`),
    presentation = $bindable(`absorbance`),
    show_sticks = $bindable(true),
    orientation = `vertical`,
    x_axis = {},
    y_axis = {},
    view = $bindable(),
    hovered_frequency = $bindable(null),
    hovered_mode_indices = $bindable([]),
    reference_frequency = null,
    highlighted_mode_indices = [],
    selected_mode_idx = $bindable(null),
    on_mode_select,
    display = $bindable({ x_grid: true, y_grid: true, x_zero_line: false, y_zero_line: true }),
    show_controls,
    controls_open = $bindable(false),
    resolved_padding = $bindable(), // to align the plot with a band plot beside it
    ...rest
  }: Omit<ScatterPlotOptions, `controls_extra`> & {
    spectrum: VibrationalSpectrum
    kind?: SpectrumKind
    units?: FrequencyUnit // defaults to cm^-1, the vibrational spectroscopy convention
    fwhm?: number // peak width in cm^-1 whatever `units` displays
    shape_factor?: number // pseudo-Voigt mixing: 0 = Gaussian, 1 = Lorentzian
    normalize?: NormalizationMode
    presentation?: SpectrumPresentation // transmittance flips IR spectra to point downwards
    show_sticks?: boolean
    orientation?: Orientation // horizontal: frequency on y, to sit beside a band structure
    hovered_frequency?: number | null // THz, like every frequency the spectral module passes
    hovered_mode_indices?: number[] // modes behind the hovered peak (read-only output)
    reference_frequency?: number | null // THz, dashed line across the frequency axis
    highlighted_mode_indices?: number[] // sticks to emphasize, e.g. a band hovered at Γ
    selected_mode_idx?: number | null
    on_mode_select?: (mode_idx: number) => void
  } = $props()

  const is_horizontal = $derived(orientation === `horizontal`)
  // Accept the spellings found in the wild (`cm-1`, `cm⁻¹`) at the prop boundary; every read
  // below uses the canonical unit so no $derived throws on an alias
  let unit = $derived(parse_frequency_unit(units) ?? units)

  // Derived, not effect-synced, so a unit switch never broadens a stale width on the new grid
  let display_fwhm = $derived(convert_frequencies([fwhm], unit, `cm^-1`)[0])

  let raman_unavailable = $derived(kind === `raman` && !spectrum.has_raman)
  let sticks = $derived(
    !spectrum.modes.length || raman_unavailable
      ? { x: [], y: [], modes: [] }
      : spectrum_sticks(spectrum, kind, { unit }),
  )
  let has_signal = $derived(sticks.x.length > 0 && sticks.y.some((val) => val > 0))

  const select_mode = (mode_idx: number): void => {
    selected_mode_idx = mode_idx
    on_mode_select?.(mode_idx)
  }

  // Pad the grid well beyond the outermost peak so tails are not clipped, and keep the
  // low-frequency edge at zero, as vibrational spectra are conventionally drawn.
  let plot_range = $derived.by((): Vec2 => {
    // array_extent([]) is [Infinity, -Infinity], which is no range at all
    if (sticks.x.length === 0) return [0, 1]
    const [min_x, max_x] = array_extent(sticks.x)
    const pad = Math.max(8 * display_fwhm, (max_x - min_x) * 0.1, 1e-6)
    return [Math.max(0, min_x - pad), max_x + pad]
  })

  let broadened = $derived.by(() => {
    if (!has_signal) return { x: [], y: [] }
    const opts = { shape_factor, range: plot_range, step_size: display_fwhm / 20 }
    return broaden_spectrum(sticks, { ...opts, fwhm: display_fwhm })
  })

  // Transmittance needs a bounded absorbance to invert, so it always scales to max=1
  // regardless of the normalization selector. IR only: Raman light is scattered, not absorbed.
  let is_transmittance = $derived(kind === `ir` && presentation === `transmittance`)
  let curve_y = $derived.by(() => {
    if (broadened.y.length === 0) return []
    if (is_transmittance) return to_transmittance(broadened.y)
    const divisor = density_divisor([broadened.y], broadened.x, normalize)
    return broadened.y.map((intensity) => intensity / divisor)
  })

  // Sticks share the curve's y-scale so both are legible on one axis. In transmittance the
  // sticks hang down from the baseline at 1. (array_max: the curve grid can be huge.)
  let stick_scale = $derived.by(() => {
    const max_stick = array_max(sticks.y)
    if (!(max_stick > 0)) return 0
    const max_curve = array_max(curve_y)
    return (is_transmittance || !(max_curve > 0) ? 1 : max_curve) / max_stick
  })

  let kind_label = $derived(spectrum_kind_label(kind))
  let intensity_label = $derived(
    kind === `ir` ? (is_transmittance ? `Transmittance` : `IR absorbance`) : `Raman activity`,
  )

  const line_style = { stroke: `var(--ir-raman-line-color, #4c78a8)`, stroke_width: 1.6 }
  let series_data = $derived.by((): DataSeries[] => {
    if (curve_y.length === 0) return []
    const label = `${kind_label} spectrum`
    const [x, y] = is_horizontal ? [curve_y, broadened.x] : [broadened.x, curve_y]
    return [{ x, y, markers: `line`, label, line_style }]
  })

  const frequency_axis = $derived<AxisConfig>({
    label: `Frequency (${frequency_unit_label(unit)})`,
    format: `.4~s`,
    range: plot_range,
  })
  const intensity_axis = $derived<AxisConfig>({
    label: intensity_label,
    format: `.3~`,
    range: is_transmittance ? [0, 1.05] : undefined,
  })
  // Screen position of a (frequency, intensity) pair in either orientation
  const to_px = (frequency: number, intensity: number, ctx: UserContentProps): Vec2 =>
    is_horizontal
      ? [ctx.x_scale_fn(intensity), ctx.y_scale_fn(frequency)]
      : [ctx.x_scale_fn(frequency), ctx.y_scale_fn(intensity)]
  let emphasized_modes = $derived(
    new Set([...highlighted_mode_indices, ...hovered_mode_indices]),
  )

  // Slider bounds scale with the plotted range so they stay sensible in every unit.
  let fwhm_input = $derived.by(() => {
    const span = plot_range[1] - plot_range[0]
    const [min, max] = span > 0 ? [span / 2000, span / 10] : [0.01, 1]
    return { min, max, step: (max - min) / 200 || 0.01 }
  })
  const shape_input = { min: 0, max: 1, step: 0.05 }

  let mode_count = $derived(spectrum.modes.length)
  let active_count = $derived(sticks.y.filter((val) => val > 1e-12).length)

  const spectrum_settings = track_settings(
    () => ({
      kind,
      units: unit,
      presentation,
      show_sticks,
      normalize,
    }),
    {
      kind: `ir`,
      units: `cm^-1`,
      presentation: `absorbance`,
      show_sticks: true,
      normalize: `max`,
    },
  )
  // One percent of the unbroadened span; a single peak uses the initial 10 cm^-1 width.
  // Including the FWHM-dependent plot padding would move the target after every reset.
  const broadening_defaults = $derived.by(() => {
    const [lower, upper] = array_extent(sticks.x) // [Infinity, -Infinity] with no sticks
    const span_cm = convert_frequencies([upper - lower], `cm^-1`, unit)[0]
    return { fwhm: span_cm > 0 ? span_cm / 100 : 10, shape_factor: 0.5 }
  })
  const broadening_settings = $derived(
    track_settings(() => ({ fwhm, shape_factor }), broadening_defaults),
  )
</script>

{#if raman_unavailable}
  <EmptyState
    message="No Raman data: polarizability derivatives must be supplied as raman_tensors or raman_activities"
  />
{:else if has_signal}
  {#snippet spectrum_tooltip({ x_formatted, y_formatted }: ScatterHandlerProps)}
    {@const [frequency_text, intensity_text] = is_horizontal
      ? [y_formatted, x_formatted]
      : [x_formatted, y_formatted]}
    <TooltipValue
      label="Frequency"
      value={frequency_text}
      unit={frequency_unit_label(unit)}
    /><br />
    <TooltipValue label={intensity_label} value={intensity_text} />
  {/snippet}

  <ScatterPlot
    {...rest}
    tooltip={rest.tooltip ?? spectrum_tooltip}
    series={series_data}
    x_axis={{ ...(is_horizontal ? intensity_axis : frequency_axis), ...x_axis }}
    y_axis={{ ...(is_horizontal ? frequency_axis : intensity_axis), ...y_axis }}
    bind:display
    bind:view
    bind:resolved_padding
    legend={rest.legend === undefined ? null : rest.legend}
    hover_config={{ threshold_px: 30, ...rest.hover_config }}
    on_point_hover={(event) => {
      const position = is_horizontal ? event?.point?.y : event?.point?.x
      hovered_frequency =
        position == null ? null : convert_frequencies([position], `THz`, unit)[0]
      const modes = position == null ? [] : peak_mode_indices(sticks, position, display_fwhm)
      // a new array on every pointer move would re-run everything that reads it
      if (modes.join() !== hovered_mode_indices.join()) hovered_mode_indices = modes
      rest.on_point_hover?.(event)
    }}
    range_padding={rest.range_padding ?? 0}
    {show_controls}
    bind:controls_open
  >
    {#snippet controls_extra()}
      <SettingsSection
        title="Spectrum"
        class="ctrl-line"
        changed_keys={spectrum_settings.changed_keys}
        on_reset={() =>
          ({ kind, units, presentation, show_sticks, normalize } =
            spectrum_settings.snapshot())}
        layout="flow"
      >
        <label>
          <span>Type</span>
          <select id="ir-raman-kind" bind:value={kind}>
            <option value="ir">Infrared</option>
            <option value="raman" disabled={!spectrum.has_raman}>Raman</option>
          </select>
        </label>
        <FrequencyUnitSelect id="ir-raman-units" bind:units />
        {#if !is_transmittance}
          <label>
            <span>Norm</span>
            <select id="ir-raman-normalize" bind:value={normalize}>
              {#each NORMALIZATION_MODES as mode (mode.value)}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if kind === `ir`}
          <label>
            <span>Axis</span>
            <select id="ir-raman-presentation" bind:value={presentation}>
              <option value="absorbance">Absorbance</option>
              <option value="transmittance">Transmittance</option>
            </select>
          </label>
        {/if}
        <label>
          <input id="ir-raman-sticks" type="checkbox" bind:checked={show_sticks} />
          Sticks
          <span class="value">{active_count}/{mode_count}</span>
        </label>
      </SettingsSection>
      <SettingsSection
        title="Broadening"
        changed_keys={broadening_settings.changed_keys}
        on_reset={() => ({ fwhm, shape_factor } = broadening_defaults)}
        layout="flow"
      >
        <div class="style-row">
          <label>
            <span title="Full width at half maximum">FWHM</span>
            <span class="value">{format_num(display_fwhm, `.3~`)}</span>
            <input
              id="ir-raman-fwhm"
              type="range"
              {...fwhm_input}
              bind:value={
                () => display_fwhm,
                (width) => (fwhm = convert_frequencies([width], `cm^-1`, unit)[0])
              }
            />
          </label>
          <label>
            <span title="0 = Gaussian, 1 = Lorentzian">Shape</span>
            <span class="value">{format_num(shape_factor, `.2~`)}</span>
            <input
              id="ir-raman-shape"
              type="range"
              {...shape_input}
              bind:value={shape_factor}
            />
          </label>
        </div>
      </SettingsSection>
    {/snippet}

    {#snippet user_content(ctx)}
      {@const ref_display = convert_frequencies([reference_frequency ?? NaN], unit)[0]}
      {#if Number.isFinite(ref_display)}
        {@const ref_px = to_px(ref_display, 0, ctx)[is_horizontal ? 1 : 0]}
        <line class="reference-line" {...plot_area_line(ref_px, is_horizontal, ctx)} />
      {/if}
      {#if show_sticks && stick_scale > 0}
        {#each sticks.x as position, stick_idx (stick_idx)}
          {@const height = sticks.y[stick_idx] * stick_scale}
          {#if height > 0}
            {@const [x1, y1] = to_px(position, is_transmittance ? 1 : 0, ctx)}
            {@const [x2, y2] = to_px(position, is_transmittance ? 1 - height : height, ctx)}
            {@const mode = sticks.modes[stick_idx]}
            <line
              class="mode-stick"
              class:selected={mode.mode_idx === selected_mode_idx}
              class:highlighted={emphasized_modes.has(mode.mode_idx)}
              {x1}
              {x2}
              {y1}
              {y2}
              role="button"
              tabindex="0"
              aria-label={`Select mode ${mode.mode_idx + 1} at ${format_num(position, `.4~`)} ${frequency_unit_text(unit)}`}
              onclick={() => select_mode(mode.mode_idx)}
              onkeydown={(event) => {
                if (event.key !== `Enter` && event.key !== ` `) return
                event.preventDefault()
                select_mode(mode.mode_idx)
              }}
            />
          {/if}
        {/each}
      {/if}
    {/snippet}
  </ScatterPlot>
{:else}
  <EmptyState message="No {kind_label}-active modes to display" />
{/if}

<style>
  .mode-stick {
    stroke: var(--ir-raman-stick-color, light-dark(#c44e52, #e07b7e));
    stroke-width: var(--ir-raman-stick-width, 1.2);
    opacity: var(--ir-raman-stick-opacity, 0.85);
    cursor: pointer;
  }
  .mode-stick.selected {
    stroke: var(--ir-raman-selected-stick-color, light-dark(#e66101, #fdb863));
    stroke-width: var(--ir-raman-selected-stick-width, 2.5);
  }
  .mode-stick.highlighted {
    stroke-width: var(--ir-raman-highlighted-stick-width, 3.5);
    opacity: 1;
  }
  .reference-line {
    stroke: var(--ir-raman-reference-line-color, light-dark(#d48860, #c47850));
    stroke-width: var(--ir-raman-reference-line-width, 1);
    stroke-dasharray: var(--ir-raman-reference-line-dash, 4 3);
    opacity: var(--ir-raman-reference-line-opacity, 0.7);
    pointer-events: none;
  }
  .value {
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    text-align: right;
  }
</style>
