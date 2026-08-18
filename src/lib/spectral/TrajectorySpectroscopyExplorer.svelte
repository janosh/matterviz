<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { THZ_TO_INVERSE_CM } from '$lib/constants'
  import { format_num } from '$lib/labels'
  import { info_pane_icon, ViewerPane } from '$lib/overlays'
  import type { TrajectoryType } from '$lib/trajectory'
  import type { PhononModeData } from './types'
  import {
    benchmark_spectroscopy,
    type FrequencyComparisonMode,
  } from './spectroscopy-benchmark'
  import {
    match_trajectory_modes_to_harmonic,
    trajectory_mode_trajectory,
    type HarmonicMatchOptions,
  } from './spectroscopy-modes'
  import type {
    ExperimentalSpectrum,
    VibrationalReferenceEntry,
  } from './spectroscopy-reference'
  import type {
    RamanChannel,
    RamanSpectrumResult,
    TrajectorySpectrumCurve,
    TrajectorySpectroscopyResult,
  } from './trajectory-spectroscopy'
  import TrajectorySpectrumPlot from './TrajectorySpectrumPlot.svelte'

  const raman_curve = (
    raman: RamanSpectrumResult | null | undefined,
    channel: RamanChannel,
  ): TrajectorySpectrumCurve | undefined =>
    channel === `polarized` ? raman?.polarized : raman?.[channel]
  const result_frequency_bounds = (
    spectroscopy_result: TrajectorySpectroscopyResult,
    channel: RamanChannel,
  ): [number, number] => {
    const selected_raman = raman_curve(spectroscopy_result.raman, channel)
    const { vdos } = spectroscopy_result
    let minimum = vdos.frequencies[0] ?? 0
    let maximum = vdos.frequencies.at(-1) ?? vdos.nyquist
    for (const curve of [spectroscopy_result.ir, selected_raman]) {
      if (!curve) continue
      minimum = Math.min(minimum, curve.frequencies[0] ?? 0)
      maximum = Math.max(maximum, curve.frequencies.at(-1) ?? curve.nyquist)
    }
    return [minimum, maximum]
  }
  const available_raman_channel = (
    spectroscopy_result: TrajectorySpectroscopyResult,
    channel: RamanChannel,
  ): RamanChannel => {
    const raman = spectroscopy_result.raman
    if (!raman) return channel
    if (raman_curve(raman, channel)) return channel
    return raman.selected_channel === `polarized` ? `unpolarized` : raman.selected_channel
  }

  let {
    result,
    reference,
    experimental_spectra = [],
    harmonic_modes,
    harmonic_options = {},
    mode_trajectory = $bindable(null),
    details_open = $bindable(false),
    show_controls = true,
    selected_peak_idx = $bindable(0),
    raman_channel = $bindable(result.raman?.selected_channel ?? `unpolarized`),
    comparison = $bindable(`absolute`),
    scale_factor = $bindable(1),
    frequency_range = $bindable(
      result_frequency_bounds(result, result.raman?.selected_channel ?? `unpolarized`),
    ),
  }: {
    result: TrajectorySpectroscopyResult
    reference?: VibrationalReferenceEntry
    experimental_spectra?: ExperimentalSpectrum[]
    harmonic_modes?: PhononModeData
    harmonic_options?: HarmonicMatchOptions
    mode_trajectory?: TrajectoryType | null
    details_open?: boolean
    show_controls?: boolean
    selected_peak_idx?: number
    raman_channel?: RamanChannel
    comparison?: FrequencyComparisonMode
    scale_factor?: number
    frequency_range?: [number, number]
  } = $props()

  const attempt = <Value>(
    operation: () => Value,
  ): { value: Value | null; error: string | null } => {
    try {
      return { value: operation(), error: null }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }
  let matched_result = $derived(
    harmonic_modes
      ? attempt(() =>
          match_trajectory_modes_to_harmonic(result, harmonic_modes, harmonic_options),
        )
      : { value: result, error: null },
  )
  let effective_result = $derived(matched_result.value ?? result)
  let display_raman_channel = $derived(available_raman_channel(result, raman_channel))
  let selected_trajectory = $derived(
    effective_result.peaks[selected_peak_idx]
      ? attempt(() => trajectory_mode_trajectory(effective_result, selected_peak_idx))
      : { value: null, error: null },
  )
  let benchmark = $derived.by(() => {
    if (!(reference && effective_result.peaks.length)) return { value: null, error: null }
    return attempt(() =>
      benchmark_spectroscopy(effective_result, reference, {
        comparison,
        ...(comparison === `scaled`
          ? { scale: { factor: scale_factor, source: `caller-supplied explorer scale` } }
          : {}),
      }),
    )
  })
  const benchmark_match = (peak_idx: number) =>
    benchmark.value?.matches.find(({ predicted_peak_idx }) => predicted_peak_idx === peak_idx)
  const comparison_error = (
    row: NonNullable<typeof benchmark.value>[`matches`][number],
  ): number => {
    if (comparison === `spacing`) return row.spacing_error_cm1
    if (comparison === `scaled`) return row.scaled_error_cm1
    return row.raw_error_cm1
  }
  const transform_curve = (
    curve: TrajectorySpectrumCurve,
    factor: number,
    offset: number,
  ): TrajectorySpectrumCurve => ({
    ...curve,
    frequencies: curve.frequencies.map((frequency) => factor * frequency + offset),
    frequency_spacing: factor * curve.frequency_spacing,
    rayleigh_resolution: factor * curve.rayleigh_resolution,
    nyquist: factor * curve.nyquist + offset,
  })
  let display_result = $derived.by((): TrajectorySpectroscopyResult => {
    const raw_result = effective_result
    if (!benchmark.value || comparison === `absolute`) return raw_result
    const factor = comparison === `scaled` ? benchmark.value.scale.factor : 1
    const offset_cm1 =
      comparison === `spacing` ? -(benchmark.value.absolute?.mean_signed_error_cm1 ?? 0) : 0
    const offset =
      raw_result.frequency_unit === `THz` ? offset_cm1 / THZ_TO_INVERSE_CM : offset_cm1
    const transform_raman = (raman: RamanSpectrumResult): RamanSpectrumResult => ({
      ...raman,
      isotropic: transform_curve(raman.isotropic, factor, offset),
      anisotropic: transform_curve(raman.anisotropic, factor, offset),
      vv: transform_curve(raman.vv, factor, offset),
      vh: transform_curve(raman.vh, factor, offset),
      unpolarized: transform_curve(raman.unpolarized, factor, offset),
      ...(raman.polarized && {
        polarized: transform_curve(raman.polarized, factor, offset),
      }),
    })
    return {
      ...raw_result,
      vdos: transform_curve(raw_result.vdos, factor, offset),
      ir: raw_result.ir ? transform_curve(raw_result.ir, factor, offset) : null,
      raman: raw_result.raman ? transform_raman(raw_result.raman) : null,
      peaks: raw_result.peaks.map((peak) => ({
        ...peak,
        frequency: factor * peak.frequency + offset,
      })),
      metadata: {
        ...raw_result.metadata,
        display_frequency_comparison: comparison,
        display_frequency_factor: factor,
        display_frequency_offset: offset,
      },
    }
  })
  $effect(() => {
    if (
      !Number.isInteger(selected_peak_idx) ||
      selected_peak_idx < 0 ||
      selected_peak_idx >= effective_result.peaks.length
    ) {
      selected_peak_idx = 0
    }
    const raman = result.raman
    if (!raman) return
    if (raman_channel !== display_raman_channel) raman_channel = display_raman_channel
  })
  $effect(() => {
    mode_trajectory = selected_trajectory.value
  })
  $effect(() => {
    const bounds = result_frequency_bounds(display_result, display_raman_channel)
    frequency_range = bounds
  })
</script>

{#snippet details_content()}
  <h4 style="margin-top: 0">Spectroscopy details</h4>
  {#if matched_result.error}<StatusMessage type="error" message={matched_result.error} />{/if}
  {#if selected_trajectory.error}<StatusMessage
      type="error"
      message={selected_trajectory.error}
    />{/if}
  {#if benchmark.error}<StatusMessage type="error" message={benchmark.error} />{/if}
  {#if !(result.ir || result.raman)}
    <p>Vibrational spectrum; IR/Raman activity unavailable.</p>
  {/if}
  {#if reference}
    <p>
      Spectrum x-axis: {comparison}; the mode table always retains raw predicted frequencies.
    </p>
  {/if}
  <h4>Detected finite-temperature modes</h4>
  <table>
    <thead
      ><tr
        ><th>Mode</th><th>Raw frequency</th>{#if reference}<th>Reference</th><th
            >{comparison} error</th
          >{/if}<th>IR</th><th>Raman</th><th>Harmonic overlap</th></tr
      ></thead
    >
    <tbody>
      {#each effective_result.peaks as peak, peak_idx (peak_idx)}
        {@const match = benchmark_match(peak_idx)}
        <tr class:selected={peak_idx === selected_peak_idx}>
          <td
            ><button
              class="mode-select"
              aria-label={`Select mode ${peak_idx + 1}`}
              onclick={() => (selected_peak_idx = peak_idx)}
              >{peak_idx + 1}{peak.potentially_mixed ? ` (mixed?)` : ``}</button
            ></td
          >
          <td>{format_num(peak.frequency, `.5~g`)} {result.frequency_unit}</td>
          {#if reference}
            <td
              >{match
                ? `${match.reference_mode_id} · ${format_num(match.reference_cm1, `.5~g`)} cm⁻¹`
                : `unmatched`}</td
            >
            <td
              >{match
                ? `${format_num(comparison_error(match), `+.4~g`)} cm⁻¹ ` +
                  `(resolution ${format_num(match.resolution_cm1, `.3~g`)} cm⁻¹)`
                : `—`}</td
            >
          {/if}
          <td>{peak.ir_activity}</td><td>{peak.raman_activity}</td>
          <td
            >{peak.harmonic_matches?.length
              ? peak.harmonic_matches
                  .map(
                    ({ overlap, frequency_difference }) =>
                      `${format_num(overlap, `.3~f`)} (Δ ${format_num(
                        frequency_difference,
                        `+.3~g`,
                      )} ${result.frequency_unit})`,
                  )
                  .join(`; `)
              : `—`}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
  {#if benchmark.value}
    <p class="metrics">
      Raw MAE {benchmark.value.absolute
        ? `${format_num(benchmark.value.absolute.mae_cm1, `.4~g`)} cm⁻¹`
        : `unavailable`} · spacing MAE {benchmark.value.spacing_mae_cm1 === null
        ? `unavailable`
        : `${format_num(benchmark.value.spacing_mae_cm1, `.4~g`)} cm⁻¹`} · scaled MAE {benchmark
        .value.scaled
        ? `${format_num(benchmark.value.scaled.mae_cm1, `.4~g`)} cm⁻¹`
        : `unavailable`}
    </p>
    <p class="metrics">
      Scale {format_num(benchmark.value.scale.factor, `.6~g`)} · {benchmark.value.scale
        .source}{benchmark.value.scale_is_in_sample
        ? ` · in-sample calibration`
        : ``}{benchmark.value.unmatched_reference_mode_ids.length
        ? ` · unmatched reference modes: ${benchmark.value.unmatched_reference_mode_ids.join(`, `)}`
        : ``}
    </p>
    <p class="metrics">
      Activity agreement · IR {benchmark.value.ir_activity.correct}/{benchmark.value
        .ir_activity.compared} · Raman {benchmark.value.raman_activity.correct}/{benchmark
        .value.raman_activity.compared}
    </p>
  {/if}
{/snippet}

<div class="trajectory-spectroscopy-explorer" style="padding-top: 0">
  <ViewerPane
    bind:open={details_open}
    pane_name="spectroscopy details"
    class_prefix="spectroscopy-details"
    closed_icon={info_pane_icon}
    max_width="min(52em, 90cqw)"
    toggle_props={{
      'aria-label': `Spectroscopy details`,
      style: `position: absolute; top: 4pt; right: 2.55em; z-index: 20; width: 1.8em; height: 1.8em; padding: 0.14em; font-size: 1.2em`,
    }}
    pane_props={{
      style: `max-height: calc(100% - 2ex); overflow: auto; z-index: 21`,
    }}
  >
    {@render details_content()}
  </ViewerPane>
  {#if show_controls}
    <div class="explorer-controls">
      {#if result.raman}
        <label
          >Raman channel
          <select bind:value={raman_channel}>
            {#each [`unpolarized`, `vv`, `vh`, `isotropic`, `anisotropic`, `polarized`] as channel (channel)}
              {#if channel !== `polarized` || result.raman.polarized}<option value={channel}
                  >{channel}</option
                >{/if}
            {/each}
          </select>
        </label>
      {/if}
      {#if reference}
        <label
          >Comparison
          <select bind:value={comparison}>
            <option value="absolute">raw absolute</option>
            <option value="spacing">shift-independent spacing</option>
            <option value="scaled">explicitly scaled</option>
          </select>
        </label>
        {#if comparison === `scaled`}
          <label
            >Scale <input
              type="number"
              min="0.01"
              step="0.001"
              bind:value={scale_factor}
            /></label
          >
        {/if}
      {/if}
      <label
        >Frequency range
        <span class="range-inputs"
          ><input type="number" bind:value={frequency_range[0]} />–<input
            type="number"
            bind:value={frequency_range[1]}
          />
          {result.frequency_unit}</span
        >
      </label>
    </div>
  {/if}
  <div class="spectrum-plot">
    <TrajectorySpectrumPlot
      result={display_result}
      {reference}
      {experimental_spectra}
      raman_channel={display_raman_channel}
      {frequency_range}
      show_summary={false}
      style="height: 100%; min-height: 0"
      bind:selected_peak_idx
    />
  </div>
</div>

<style>
  .trajectory-spectroscopy-explorer {
    display: flex;
    flex-direction: column;
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
  }
  .explorer-controls {
    display: grid;
    gap: 8pt;
    grid-template-columns: repeat(auto-fit, minmax(12em, 1fr));
  }
  .spectrum-plot {
    flex: 1;
    min-height: 0;
  }
  .spectrum-plot :global(.trajectory-spectrum-plots) {
    height: 100%;
    min-height: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5pt;
  }
  .range-inputs {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  .range-inputs input {
    width: 6.5em;
  }
  h4,
  p {
    margin: 4pt 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
  }
  th,
  td {
    text-align: left;
    padding: 3pt 5pt;
    border-bottom: 1px solid var(--border-color, #8884);
  }
  .mode-select {
    border: 0;
    padding: 2pt 4pt;
    color: inherit;
    background: transparent;
    cursor: pointer;
  }
  tbody tr.selected {
    background: color-mix(in srgb, var(--primary-color, #357abd) 16%, transparent);
  }
  .metrics {
    font-size: 0.82em;
  }
</style>
