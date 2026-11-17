<script lang="ts">
  import { clamp } from 'svelte-widgets/utils'
  import type {
    ScatterPlotOptions,
    DataSeries,
    FacetPanel,
    FacetPanelContext,
  } from '#lib/plot/index.js'
  import { PLOT_COLORS } from '#lib/colors/index.js'
  import { array_extent } from '#lib/math.js'
  import { FacetGrid, ScatterPlot } from '#lib/plot/index.js'
  import { frequency_unit_label } from './frequency-units'
  import type {
    RamanChannel,
    TrajectorySpectrumCurve,
    TrajectorySpectroscopyResult,
  } from './trajectory-spectroscopy'

  let {
    result,
    raman_channel = result.raman?.selected_channel ?? `unpolarized`,
    selected_peak_idx = $bindable(),
    show_summary = true,
    show_controls,
    frequency_range,
    style,
    header_controls,
    controls_extra,
    ...rest
  }: {
    result: TrajectorySpectroscopyResult
    raman_channel?: RamanChannel
    selected_peak_idx?: number
    show_summary?: boolean
    frequency_range?: [number, number]
  } & Omit<ScatterPlotOptions, `ref_lines` | `fullscreen` | `fullscreen_toggle`> = $props()

  interface SpectrumPanelDatum {
    kind: `ir` | `raman` | `vdos`
    response: TrajectorySpectrumCurve
  }

  const SPECTRUM_POWER_FLOOR = 0.01
  const make_spectrum_panel = (
    kind: SpectrumPanelDatum[`kind`],
    response: TrajectorySpectrumCurve,
  ): FacetPanel<SpectrumPanelDatum> => ({ key: kind, data: { kind, response } })
  // Frequencies where any curve clears the power floor, padded by 12% of that span or the
  // coarsest spectral resolution and clipped to the data
  const significant_frequency_range = (
    curves: readonly TrajectorySpectrumCurve[],
  ): [number, number] | undefined => {
    const finite = (values: number[]) => values.filter(Number.isFinite)
    const [data_minimum, data_maximum] = array_extent(
      curves.flatMap(({ frequencies }) => finite(frequencies)),
    )
    const [significant_minimum, significant_maximum] = array_extent(
      curves.flatMap(({ frequencies, normalized_power }) =>
        finite(frequencies.filter((_, idx) => normalized_power[idx] >= SPECTRUM_POWER_FLOOR)),
      ),
    )
    if (!Number.isFinite(significant_minimum)) return undefined
    const padding = Math.max(
      (significant_maximum - significant_minimum) * 0.12,
      ...finite(curves.map(({ rayleigh_resolution }) => rayleigh_resolution)),
    )
    return [
      Math.max(data_minimum, significant_minimum - padding),
      Math.min(data_maximum, significant_maximum + padding),
    ]
  }
  const nearest_power = (curve: TrajectorySpectrumCurve, frequency: number): number => {
    const bin_idx = clamp(
      Math.round((frequency - (curve.frequencies[0] ?? 0)) / curve.frequency_spacing),
      0,
      curve.frequencies.length - 1,
    )
    return curve.normalized_power[bin_idx] ?? 0
  }
  const peak_series = (curve: TrajectorySpectrumCurve): DataSeries => {
    const min_frequency = curve.frequencies[0] ?? 0
    const max_frequency = curve.frequencies.at(-1) ?? min_frequency
    const peaks_in_range = result.peaks
      .map((peak, peak_idx) => ({ peak, peak_idx }))
      .filter(({ peak }) => peak.frequency >= min_frequency && peak.frequency <= max_frequency)
    return {
      id: `detected-peaks`,
      x: peaks_in_range.map(({ peak }) => peak.frequency),
      y: peaks_in_range.map(({ peak }) => nearest_power(curve, peak.frequency)),
      label: `Detected modes`,
      markers: `points`,
      metadata: peaks_in_range.map(({ peak, peak_idx }) => ({ peak_idx, ...peak })),
      point_style: peaks_in_range.map(({ peak_idx }) => ({
        fill: peak_idx === selected_peak_idx ? `#d62728` : `#111`,
        stroke: `white`,
        stroke_width: 1,
        radius: peak_idx === selected_peak_idx ? 5 : 3,
      })),
    }
  }

  let selected_raman_curve = $derived(result.raman?.[raman_channel] ?? null)
  let response_panels = $derived.by(() => {
    const panels: FacetPanel<SpectrumPanelDatum>[] = []
    if (result.ir) panels.push(make_spectrum_panel(`ir`, result.ir))
    if (selected_raman_curve) panels.push(make_spectrum_panel(`raman`, selected_raman_curve))
    return panels.length ? panels : [make_spectrum_panel(`vdos`, result.vdos)]
  })
  let visible_frequency_range = $derived(
    frequency_range ??
      significant_frequency_range(
        [result.vdos, result.ir, selected_raman_curve].filter((curve) => curve !== null),
      ),
  )
  let spectroscopy_legend = $derived(
    rest.legend === null
      ? null
      : {
          ...rest.legend,
          // Reserve the top-right plot chrome occupied by spectroscopy's info/settings toggles.
          axis_clearance: Math.max(72, rest.legend?.axis_clearance ?? 0),
        },
  )
</script>

{#snippet spectrum_panel(
  kind: string,
  response: TrajectorySpectrumCurve,
  facet_layout: FacetPanelContext<SpectrumPanelDatum>,
)}
  {@const series = [
    ...(kind === `vdos`
      ? []
      : [
          {
            id: `${kind}-response`,
            x: response.frequencies,
            y: response.normalized_power,
            label: kind === `ir` ? `Relative IR intensity` : `Raman ${raman_channel}`,
            markers: `line` as const,
            line_style: { color: PLOT_COLORS[0], width: 2 },
          },
        ]),
    {
      id: `${kind}-vdos`,
      x: result.vdos.frequencies,
      y: result.vdos.normalized_power,
      label: `Mass-weighted VDOS`,
      markers: `line` as const,
      line_style: { color: PLOT_COLORS[1], width: 2, dash: `6 4` },
    },
    peak_series(response),
  ] satisfies DataSeries[]}
  <ScatterPlot
    {...rest}
    legend={spectroscopy_legend}
    {show_controls}
    {series}
    on_point_click={(event) => {
      const peak_idx = event.metadata?.peak_idx
      if (typeof peak_idx === `number`) selected_peak_idx = peak_idx
      rest.on_point_click?.(event)
    }}
    header_controls={facet_layout.index === 0 ? header_controls : undefined}
    controls_extra={facet_layout.index === 0 ? controls_extra : undefined}
    x_axis={{
      label: `Frequency (${frequency_unit_label(result.frequency_unit)})`,
      ...rest.x_axis,
      range: visible_frequency_range,
    }}
    y_axis={{
      label: kind !== `vdos` ? `Independent normalized power` : `Normalized vibrational power`,
      ...rest.y_axis,
    }}
    styles={{ show_lines: true, show_points: true, ...rest.styles }}
    {facet_layout}
    fullscreen_toggle={false}
    style="height: 100%; min-height: 0"
  />
{/snippet}

<div
  class="trajectory-spectrum-plots"
  style={style ?? `height: ${response_panels.length * 290}px;`}
>
  <FacetGrid
    panels={response_panels}
    columns={1}
    gap={8}
    axis_modes={{ x: `shared`, y: `free` }}
    axis_visibility={{ x: `outer`, x2: `none`, y: `outer`, y2: `none` }}
    style="height: 100%; min-height: 0"
  >
    {#snippet children(context)}
      {@render spectrum_panel(context.data.kind, context.data.response, context)}
    {/snippet}
  </FacetGrid>
  {#if !result.ir && !selected_raman_curve && show_summary}
    <p>Vibrational spectrum; IR/Raman activity unavailable.</p>
  {/if}
</div>

<style>
  .trajectory-spectrum-plots {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 8pt;
    min-height: 0;
  }
  p {
    margin: 0;
    font-size: 0.8em;
    opacity: 0.75;
  }
</style>
