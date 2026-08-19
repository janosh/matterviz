<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import type {
    DataSeries,
    FacetPanel,
    FacetPanelContext,
    ScatterHandlerEvent,
  } from '$lib/plot'
  import { FacetGrid, ScatterPlot } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
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
    show_controls = $bindable(true),
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
    show_controls?: boolean
    frequency_range?: [number, number]
  } & Omit<
    ComponentProps<typeof ScatterPlot>,
    `series` | `error_bands` | `ref_lines` | `facet_layout`
  > = $props()

  interface SpectrumPanelDatum {
    kind: string
    response: TrajectorySpectrumCurve
  }

  const nearest_power = (curve: TrajectorySpectrumCurve, frequency: number): number => {
    const bin_idx = Math.max(
      0,
      Math.min(
        curve.frequencies.length - 1,
        Math.round((frequency - (curve.frequencies[0] ?? 0)) / curve.frequency_spacing),
      ),
    )
    return curve.normalized_power[bin_idx] ?? 0
  }
  const is_response_panel = (kind: string): kind is `ir` | `raman` =>
    kind === `ir` || kind === `raman`
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
  const handle_point_click = (event: ScatterHandlerEvent): void => {
    const peak_idx = event.metadata?.peak_idx
    if (typeof peak_idx === `number`) selected_peak_idx = peak_idx
  }

  let selected_raman_curve = $derived(result.raman?.[raman_channel] ?? null)
  let response_panels = $derived.by(() => {
    const panels: FacetPanel<SpectrumPanelDatum>[] = []
    if (result.ir) {
      panels.push({
        key: `ir`,
        data: { kind: `ir`, response: result.ir },
      })
    }
    if (selected_raman_curve) {
      panels.push({
        key: `raman`,
        data: {
          kind: `raman`,
          response: selected_raman_curve,
        },
      })
    }
    return panels.length
      ? panels
      : [{ key: `vdos`, data: { kind: `vdos`, response: result.vdos } }]
  })
  let grid_style = $derived(style ?? `height: ${Math.max(1, response_panels.length) * 290}px;`)
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
  {@const response_label = kind === `ir` ? `Relative IR intensity` : `Raman ${raman_channel}`}
  {@const series = [
    ...(!is_response_panel(kind)
      ? []
      : [
          {
            id: `${kind}-response`,
            x: response.frequencies,
            y: response.normalized_power,
            label: response_label,
            markers: `line` as const,
            line_style: { stroke: PLOT_COLORS[0], stroke_width: 2 },
          },
        ]),
    {
      id: `${kind}-vdos`,
      x: result.vdos.frequencies,
      y: result.vdos.normalized_power,
      label: `Mass-weighted VDOS`,
      markers: `line` as const,
      line_style: { stroke: PLOT_COLORS[1], stroke_width: 2, line_dash: `6 4` },
    },
    peak_series(response),
  ] satisfies DataSeries[]}
  <ScatterPlot
    {...rest}
    legend={spectroscopy_legend}
    bind:show_controls
    {series}
    on_point_click={handle_point_click}
    {header_controls}
    {controls_extra}
    x_axis={{ label: `Frequency (${result.frequency_unit})`, range: frequency_range }}
    y_axis={{
      label: is_response_panel(kind)
        ? `Independent normalized power`
        : `Normalized vibrational power`,
    }}
    styles={{ show_lines: true, show_points: true }}
    {facet_layout}
    fullscreen_toggle={false}
    style="height: 100%; min-height: 0"
  />
{/snippet}

<div class="trajectory-spectrum-plots">
  <FacetGrid
    panels={response_panels}
    columns={1}
    gap={8}
    axis_modes={{ x: `shared`, y: `free` }}
    axis_visibility={{ x: `outer`, x2: `none`, y: `outer`, y2: `none` }}
    style={grid_style}
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
    gap: 8pt;
  }
  p {
    margin: 0;
    font-size: 0.8em;
    opacity: 0.75;
  }
</style>
