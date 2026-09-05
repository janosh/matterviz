<script lang="ts">
  import { plot_color } from '$lib/colors'
  import { StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import AnalysisSummary from '$lib/trajectory/AnalysisSummary.svelte'
  import { use_async_result } from '$lib/trajectory/async-result.svelte'
  import type { TrajectoryPositionStream } from '$lib/trajectory'
  import type { ComponentProps } from 'svelte'
  import { compute_msd_async } from './async-compute.svelte'
  import type { MsdOptions, MsdResult } from './index'

  let {
    result = $bindable(),
    positions,
    msd_options = {},
    show_fit = true,
    show_summary = true,
    max_visible_curves = 4,
    loading = $bindable(false),
    error_msg = $bindable(),
    x_axis = {},
    y_axis = {},
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: {
    // Precomputed curves. Bindable so a parent can read back what `positions` produced.
    result?: MsdResult
    // Supply positions instead of `result` to have this component compute (in a worker)
    positions?: TrajectoryPositionStream
    msd_options?: MsdOptions
    show_fit?: boolean
    show_summary?: boolean
    max_visible_curves?: number
    loading?: boolean
    error_msg?: string
    x_axis?: ComponentProps<typeof ScatterPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof ScatterPlot>[`y_axis`]
  } & ComponentProps<typeof ScatterPlot> = $props()

  use_async_result({
    input: () => positions,
    options: () => msd_options,
    compute: (input, options, signal) => compute_msd_async(input, options, { signal }),
    set_result: (computed) => (result = computed),
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
  })

  let series = $derived.by<DataSeries[]>(() => {
    if (!result) return []
    const { times, curves, lags, dt } = result
    return curves.flatMap((curve, idx): DataSeries[] => {
      const color = plot_color(idx)
      const visible = idx < max_visible_curves
      const msd_series: DataSeries = {
        x: times,
        y: curve.msd,
        label: `${curve.label} (${curve.n_atoms} atoms)`,
        visible,
        markers: `line`,
        // n_origins/std_error per point so the tooltip can show how thin the tail is
        metadata: times.map((_time, point_idx) => ({
          lag: lags[point_idx],
          n_origins: curve.n_origins[point_idx],
          std_error: curve.std_error[point_idx],
        })),
        line_style: { stroke: color, stroke_width: 2 },
      }
      const { fit } = curve
      if (!show_fit || !fit) return [msd_series]
      const [fit_start, fit_end] = [fit.lag_window[0] * dt, fit.lag_window[1] * dt]
      return [
        msd_series,
        {
          x: [fit_start, fit_end],
          y: [fit.intercept + fit.slope * fit_start, fit.intercept + fit.slope * fit_end],
          label: `${curve.label} fit`,
          legend_group: `Einstein fits`,
          visible,
          markers: `line`,
          line_style: { stroke: color, stroke_width: 1, line_dash: `5,4` },
        },
      ]
    })
  })
</script>

{#if series.length === 0}
  <!-- Single owner of the message area: an error replaces the empty state rather than
  stacking a second StatusMessage above it -->
  <StatusMessage
    message={error_msg ?? (loading ? `Computing MSD…` : `No MSD data to display`)}
    type={error_msg ? `error` : `info`}
    style={error_msg ? `` : `border: none`}
  />
{:else if result}
  {@const summary = result}
  <ScatterPlot
    {...rest}
    bind:show_controls
    bind:controls_open
    {series}
    x_axis={{ label: summary.x_label, ...x_axis }}
    y_axis={{ label: `MSD (Å²)`, ...y_axis }}
    styles={{ show_lines: true, show_points: false }}
    style={rest.style ?? `height: 320px;`}
  />
  {#if show_summary}
    <AnalysisSummary
      headers={[`Species`, `Atoms`, `D`, `R²`, `Fit lags`]}
      downloads={[
        {
          label: `MSD CSV`,
          filename: `msd.csv`,
          columns: () => ({
            lag_frames: summary.lags,
            [`lag_time_${summary.time_unit}`]: summary.times,
            ...Object.fromEntries(
              summary.curves.flatMap(({ label, msd, std_error, n_origins }) => [
                [`msd_${label}_A2`, msd],
                [`std_error_${label}_A2`, std_error],
                [`n_origins_${label}`, n_origins],
              ]),
            ),
          }),
        },
      ]}
    >
      {#each summary.curves as { label, n_atoms, fit } (label)}
        <tr>
          <td>{label}</td>
          <td>{n_atoms}</td>
          <td>
            {fit ? `${format_num(fit.diffusion_coefficient, `.3~e`)} ${fit.units}` : `—`}
            {#if fit?.diffusion_coefficient_cm2_s != null}
              <br /><small>{format_num(fit.diffusion_coefficient_cm2_s, `.3~e`)} cm²/s</small>
            {/if}
          </td>
          <td>{fit ? format_num(fit.r_squared, `.4~f`) : `—`}</td>
          <td>{fit ? `${fit.lag_window[0]}–${fit.lag_window[1]}` : `—`}</td>
        </tr>
      {/each}
      {#snippet note()}
        {summary.n_frames} frames × {summary.n_atoms} atoms
        {#if summary.frame_stride > 1}· 1 in {summary.frame_stride} frames{/if}
        {#if summary.origin_stride > 1}· 1 in {summary.origin_stride} time origins{/if}
        {#if summary.lag_stride > 1}· 1 in {summary.lag_stride} lags{/if}
        · {summary.unwrapped ? `unwrapped across periodic images` : `no unwrapping applied`}
      {/snippet}
    </AnalysisSummary>
  {/if}
{/if}
