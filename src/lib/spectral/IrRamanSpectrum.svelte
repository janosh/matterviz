<script lang="ts">
  import EmptyState from '$lib/EmptyState.svelte'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type { AxisConfig, DataSeries } from '$lib/plot/core/types'
  import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
  import { extent } from 'd3-array'
  import type { ComponentProps } from 'svelte'
  import {
    convert_frequencies,
    FREQUENCY_UNITS,
    NORMALIZATION_MODES,
    normalize_densities,
    sync_axis_range,
  } from './helpers'
  import { broaden_spectrum, spectrum_sticks, to_transmittance } from './ir-raman'
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
    units = $bindable(`cm-1`),
    fwhm = $bindable(10),
    shape_factor = $bindable(0.5),
    normalize = $bindable(`max`),
    presentation = $bindable(`absorbance`),
    show_sticks = $bindable(true),
    x_axis = {},
    y_axis = $bindable({}),
    hovered_frequency = $bindable(null),
    selected_mode_idx = $bindable(null),
    on_mode_select,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    spectrum: VibrationalSpectrum
    kind?: SpectrumKind
    units?: FrequencyUnit // defaults to cm-1, the vibrational spectroscopy convention
    fwhm?: number // peak width in the currently selected frequency unit
    shape_factor?: number // pseudo-Voigt mixing: 0 = Gaussian, 1 = Lorentzian
    normalize?: NormalizationMode
    presentation?: SpectrumPresentation // transmittance flips IR spectra to point downwards
    show_sticks?: boolean
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    hovered_frequency?: number | null
    selected_mode_idx?: number | null
    on_mode_select?: (mode_idx: number) => void
  } = $props()

  // FWHM is quoted in the displayed unit, so rescale it when the user switches units;
  // otherwise 10 cm^-1 would silently become 10 THz. prev_units is intentionally a plain
  // local: it is bookkeeping for the effect, not reactive state anything renders.
  let prev_units = units
  $effect(() => {
    if (units === prev_units) return
    const rescale =
      convert_frequencies([1], units)[0] / convert_frequencies([1], prev_units)[0]
    prev_units = units
    fwhm *= rescale
  })

  let raman_unavailable = $derived(kind === `raman` && !spectrum?.has_raman)
  let sticks = $derived(
    !spectrum?.modes?.length || raman_unavailable
      ? { x: [], y: [] }
      : spectrum_sticks(spectrum, kind, { unit: units }),
  )
  let stick_modes = $derived(
    spectrum?.modes?.filter((mode) => !mode.is_acoustic && !mode.is_imaginary) ?? [],
  )
  let has_signal = $derived(sticks.x.length > 0 && sticks.y.some((val) => val > 0))

  // Pad the grid well beyond the outermost peak so tails are not clipped, and keep the
  // low-frequency edge at zero, as vibrational spectra are conventionally drawn.
  let plot_range = $derived.by((): Vec2 => {
    // extent([]) is [undefined, undefined], which would make the whole range NaN
    if (sticks.x.length === 0) return [0, 1]
    const [min_x, max_x] = extent(sticks.x) as [number, number]
    const pad = Math.max(8 * fwhm, (max_x - min_x) * 0.1, 1e-6)
    return [Math.max(0, min_x - pad), max_x + pad]
  })

  let broadened = $derived.by(() => {
    if (!has_signal) return { x: [], y: [] }
    const opts = { fwhm, shape_factor, range: plot_range, step_size: fwhm / 20 }
    return broaden_spectrum(sticks, opts)
  })

  // Transmittance needs a bounded absorbance to invert, so it always scales to max=1
  // regardless of the normalization selector.
  let is_transmittance = $derived(presentation === `transmittance`)
  let curve_y = $derived.by(() => {
    if (broadened.y.length === 0) return []
    if (is_transmittance) return to_transmittance(broadened.y)
    return normalize_densities(broadened.y, broadened.x, normalize)
  })

  // Sticks share the curve's y-scale so both are legible on one axis. In transmittance the
  // sticks hang down from the baseline at 1.
  let stick_scale = $derived.by(() => {
    const max_stick = Math.max(...sticks.y, 0)
    if (max_stick <= 0) return 0
    const max_curve = Math.max(...curve_y, 0)
    if (is_transmittance) return 1 / max_stick
    return (max_curve > 0 ? max_curve : 1) / max_stick
  })

  let kind_label = $derived(kind === `ir` ? `IR` : `Raman`)
  let intensity_label = $derived(
    kind === `ir` ? (is_transmittance ? `Transmittance` : `IR absorbance`) : `Raman activity`,
  )

  const line_style = { stroke: `var(--ir-raman-line-color, #4c78a8)`, stroke_width: 1.6 }
  let series_data = $derived.by((): DataSeries[] => {
    if (curve_y.length === 0) return []
    const label = `${kind_label} spectrum`
    return [{ x: broadened.x, y: curve_y, markers: `line`, label, line_style }]
  })

  let final_x_axis = $derived({
    label: `Frequency (${units})`,
    format: `.4~s`,
    range: plot_range,
    ...x_axis,
  })
  let internal_y_axis = $derived({
    label: intensity_label,
    format: `.3~`,
    range: (is_transmittance ? [0, 1.05] : undefined) as Vec2 | undefined,
    ...y_axis,
  })
  $effect(() => {
    const next = sync_axis_range(y_axis, internal_y_axis.range)
    if (next !== y_axis) y_axis = next
  })

  let display = $state({ x_grid: true, y_grid: true, x_zero_line: false, y_zero_line: true })

  // Slider bounds scale with the plotted range so they stay sensible in every unit.
  let fwhm_input = $derived.by(() => {
    const span = plot_range[1] - plot_range[0]
    const [min, max] = span > 0 ? [span / 2000, span / 10] : [0.01, 1]
    return { min, max, step: (max - min) / 200 || 0.01 }
  })
  const shape_input = { min: 0, max: 1, step: 0.05 }

  let mode_count = $derived(spectrum?.modes?.length ?? 0)
  let active_count = $derived(sticks.y.filter((val) => val > 1e-12).length)
</script>

{#if raman_unavailable}
  <EmptyState
    message="No Raman data: polarizability derivatives must be supplied as raman_tensors or raman_activities"
  />
{:else if has_signal}
  <ScatterPlot
    series={series_data}
    x_axis={final_x_axis}
    bind:y_axis={internal_y_axis}
    bind:display
    legend={null}
    hover_config={{ threshold_px: 30 }}
    on_point_hover={(event) => (hovered_frequency = event?.point?.x ?? null)}
    range_padding={0}
    {...rest}
    bind:show_controls
    bind:controls_open
  >
    {#snippet tooltip({ x_formatted, y_formatted })}
      Frequency: {x_formatted}
      {units}<br />
      {intensity_label}: {y_formatted}
    {/snippet}

    {#snippet controls_extra()}
      <SettingsSection
        title="Spectrum"
        current_values={{ kind }}
        on_reset={() => (kind = `ir`)}
      >
        <div class="pane-row">
          <label for="ir-raman-kind">Type:</label>
          <select id="ir-raman-kind" bind:value={kind}>
            <option value="ir">Infrared</option>
            <option value="raman" disabled={!spectrum.has_raman}>Raman</option>
          </select>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Units"
        current_values={{ units }}
        on_reset={() => (units = `cm-1`)}
      >
        <div class="pane-row">
          <label for="ir-raman-units">Frequency:</label>
          <select id="ir-raman-units" bind:value={units}>
            {#each FREQUENCY_UNITS as unit (unit)}
              <option value={unit}>{unit}</option>
            {/each}
          </select>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Broadening"
        current_values={{ fwhm, shape_factor }}
        on_reset={() => ([fwhm, shape_factor] = [(plot_range[1] - plot_range[0]) / 100, 0.5])}
      >
        <div class="pane-row">
          <label for="ir-raman-fwhm" title="Full width at half maximum">FWHM:</label>
          <input id="ir-raman-fwhm" type="range" {...fwhm_input} bind:value={fwhm} />
          <span class="value">{format_num(fwhm, `.3~`)}</span>
        </div>
        <div class="pane-row">
          <label for="ir-raman-shape" title="0 = Gaussian, 1 = Lorentzian">Shape:</label>
          <input id="ir-raman-shape" type="range" {...shape_input} bind:value={shape_factor} />
          <span class="value">{format_num(shape_factor, `.2~`)}</span>
        </div>
      </SettingsSection>
      {#if !is_transmittance}
        <SettingsSection
          title="Normalization"
          current_values={{ normalize }}
          on_reset={() => (normalize = `max`)}
        >
          <div class="pane-row">
            <label for="ir-raman-normalize">Mode:</label>
            <select id="ir-raman-normalize" bind:value={normalize}>
              {#each NORMALIZATION_MODES as mode (mode.value)}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
        </SettingsSection>
      {/if}
      <SettingsSection
        title="Display"
        current_values={{ presentation, show_sticks }}
        on_reset={() => ([presentation, show_sticks] = [`absorbance`, true])}
      >
        <div class="pane-row">
          <label for="ir-raman-presentation">Axis:</label>
          <select id="ir-raman-presentation" bind:value={presentation}>
            <option value="absorbance">Absorbance</option>
            <option value="transmittance">Transmittance</option>
          </select>
        </div>
        <div class="pane-row">
          <label for="ir-raman-sticks">Sticks:</label>
          <input id="ir-raman-sticks" type="checkbox" bind:checked={show_sticks} />
          <span class="value">{active_count}/{mode_count}</span>
        </div>
      </SettingsSection>
    {/snippet}

    {#snippet user_content({ x_scale_fn, y_scale_fn })}
      {#if show_sticks && stick_scale > 0}
        {@const baseline = y_scale_fn(is_transmittance ? 1 : 0)}
        {#each sticks.x as position, stick_idx (stick_idx)}
          {@const height = sticks.y[stick_idx] * stick_scale}
          {#if height > 0}
            {@const x_px = x_scale_fn(position)}
            {@const tip = y_scale_fn(is_transmittance ? 1 - height : height)}
            {@const mode = stick_modes[stick_idx]}
            <line
              class="mode-stick"
              class:selected={mode?.mode_idx === selected_mode_idx}
              x1={x_px}
              x2={x_px}
              y1={baseline}
              y2={tip}
              role="button"
              tabindex="0"
              aria-label={mode
                ? `Select mode ${mode.mode_idx + 1} at ${format_num(position, `.4~`)} ${units}`
                : `Select vibrational mode`}
              onclick={() => {
                if (!mode) return
                selected_mode_idx = mode.mode_idx
                on_mode_select?.(mode.mode_idx)
              }}
              onkeydown={(event) => {
                if (!mode || (event.key !== `Enter` && event.key !== ` `)) return
                event.preventDefault()
                selected_mode_idx = mode.mode_idx
                on_mode_select?.(mode.mode_idx)
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
  .pane-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.3em 0;
    font-size: 0.9em;
  }
  .pane-row label {
    min-width: 4.5em;
    flex-shrink: 0;
  }
  .pane-row input[type='range'] {
    flex: 1;
    min-width: 4em;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
  }
  .value {
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    min-width: 3.5em;
    text-align: right;
  }
</style>
