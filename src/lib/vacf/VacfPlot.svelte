<script lang="ts">
  import { plot_color } from '$lib/colors'
  import { StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import { frequency_unit_label } from '$lib/spectral/frequency-units'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import AnalysisSummary from '$lib/trajectory/AnalysisSummary.svelte'
  import { use_async_result } from '$lib/trajectory/async-result.svelte'
  import type { ComponentProps } from 'svelte'
  import { compute_vacf_async } from './async-compute.svelte'
  import type { VacfInput, VacfOptions, VacfResult } from './index'

  let {
    result = $bindable(),
    input,
    vacf_options = {},
    panel = `both`,
    show_summary = true,
    max_visible_curves = 4,
    loading = $bindable(false),
    error_msg = $bindable(),
    show_controls = $bindable(true),
    vacf_controls_open = $bindable(false),
    vdos_controls_open = $bindable(false),
    ...rest
  }: {
    // Precomputed curves. Bindable so a parent can read back what `input` produced.
    result?: VacfResult
    // Supply an input instead of `result` to have this component compute (in a worker)
    input?: VacfInput
    vacf_options?: VacfOptions
    // Which of the two panels to render
    panel?: `vacf` | `vdos` | `both`
    show_summary?: boolean
    max_visible_curves?: number
    loading?: boolean
    error_msg?: string
    vacf_controls_open?: boolean
    vdos_controls_open?: boolean
  } & Omit<ComponentProps<typeof ScatterPlot>, `controls_open`> = $props()

  use_async_result({
    input: () => input,
    options: () => vacf_options,
    compute: (request_input, options, signal) =>
      compute_vacf_async(request_input, options, { signal }),
    set_result: (computed) => (result = computed),
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
  })

  const curve_series = (
    xs: number[],
    pick: (curve: VacfResult[`curves`][number]) => number[],
    metadata?: (curve: VacfResult[`curves`][number]) => Record<string, unknown>[],
  ): DataSeries[] =>
    (result?.curves ?? []).map((curve, idx) => ({
      x: xs,
      y: pick(curve),
      label: `${curve.label} (${curve.n_atoms} atoms)`,
      visible: idx < max_visible_curves,
      markers: `line`,
      ...(metadata ? { metadata: metadata(curve) } : {}),
      line_style: { stroke: plot_color(idx), stroke_width: 2 },
    }))

  // n_origins per point so the tooltip can show how thin the tail is. The VDOS gets none:
  // its x axis is frequency bins, which have no time origins.
  let vacf_series = $derived(
    curve_series(
      result?.times ?? [],
      (curve) => curve.vacf_normalized,
      (curve) =>
        (result?.lags ?? []).map((lag, point_idx) => ({
          lag,
          n_origins: curve.n_origins[point_idx],
        })),
    ),
  )
  let vdos_series = $derived(
    result?.frequencies.length ? curve_series(result.frequencies, (curve) => curve.vdos) : [],
  )

  let show_vacf = $derived(panel !== `vdos` && vacf_series.length > 0)
  let show_vdos = $derived(panel !== `vacf` && vdos_series.length > 0)
  let plot_style = $derived(rest.style ?? `height: 280px;`)
</script>

{#if !show_vacf && !show_vdos}
  <!-- Single owner of the message area: an error replaces the empty state rather than
  stacking a second StatusMessage above it -->
  <StatusMessage
    message={error_msg ?? (loading ? `Computing VACF…` : `No VACF data to display`)}
    type={error_msg ? `error` : `info`}
    style={error_msg ? `` : `border: none`}
  />
{:else if result}
  {@const summary = result}
  {#snippet panel_plot(
    series: DataSeries[],
    x_label: string,
    y_label: string,
    controls_open: boolean,
    set_controls_open: (value: boolean) => void,
  )}
    <ScatterPlot
      {...rest}
      bind:show_controls
      bind:controls_open={() => controls_open, set_controls_open}
      {series}
      x_axis={{ label: x_label }}
      y_axis={{ label: y_label }}
      styles={{ show_lines: true, show_points: false }}
      style={plot_style}
    />
  {/snippet}
  {#if show_vacf}
    {@render panel_plot(
      vacf_series,
      summary.x_label,
      `VACF / VACF(0)`,
      vacf_controls_open,
      (value) => (vacf_controls_open = value),
    )}
  {/if}
  {#if show_vdos}
    {@render panel_plot(
      vdos_series,
      summary.frequency_label,
      `VDOS (arb. units)`,
      vdos_controls_open,
      (value) => (vdos_controls_open = value),
    )}
  {/if}
  {#if show_summary}
    <AnalysisSummary
      headers={[`Species`, `Atoms`, `VACF(0)`, `Peak`]}
      downloads={[
        {
          label: `VACF CSV`,
          filename: `vacf.csv`,
          columns: () => ({
            lag_frames: summary.lags,
            [`lag_time_${summary.time_unit}`]: summary.times,
            ...Object.fromEntries(
              summary.curves.flatMap(({ label, vacf, vacf_normalized }) => [
                [`vacf_${label}`, vacf],
                [`vacf_normalized_${label}`, vacf_normalized],
              ]),
            ),
          }),
        },
        {
          label: `VDOS CSV`,
          filename: `vdos.csv`,
          columns: () => ({
            [`frequency_${summary.frequency_unit}`]: summary.frequencies,
            ...Object.fromEntries(
              summary.curves.map(({ label, vdos }) => [`vdos_${label}`, vdos]),
            ),
          }),
        },
      ]}
    >
      {#each summary.curves as { label, n_atoms, vacf, peak_frequency } (label)}
        <tr>
          <td>{label}</td>
          <td>{n_atoms}</td>
          <td>{format_num(vacf[0], `.3~e`)} {summary.velocity_unit}</td>
          <td>
            {format_num(peak_frequency, `.4~g`)}
            {frequency_unit_label(summary.frequency_unit)}
          </td>
        </tr>
      {/each}
      {#snippet note()}
        {summary.n_frames} velocity frames × {summary.n_atoms} atoms
        {#if summary.frame_stride > 1}· 1 in {summary.frame_stride} source frames{/if}
        · {summary.velocity_source === `stored`
          ? `velocities read from the file`
          : `central differences of ${summary.unwrapped ? `unwrapped` : `raw`} positions`}
        · {summary.window} window
        {#if summary.frequency_unit === `1/frame`}
          · no timestep supplied, so frequencies are per collected frame
        {/if}
      {/snippet}
    </AnalysisSummary>
  {/if}
{/if}
