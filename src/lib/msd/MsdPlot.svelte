<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import { compute_msd_async } from './async-compute.svelte'
  import type { MsdOptions, MsdPositions, MsdResult } from './index'

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
    positions?: MsdPositions
    msd_options?: MsdOptions
    show_fit?: boolean
    show_summary?: boolean
    max_visible_curves?: number
    loading?: boolean
    error_msg?: string
    x_axis?: ComponentProps<typeof ScatterPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof ScatterPlot>[`y_axis`]
  } & ComponentProps<typeof ScatterPlot> = $props()

  // Async compute can't be a $derived; a request id drops results of superseded inputs
  let request_id = 0
  $effect(() => {
    const [input, options] = [positions, msd_options]
    const this_request = ++request_id
    loading = Boolean(input)
    if (!input) return
    error_msg = undefined
    compute_msd_async(input, options)
      .then((computed) => {
        if (this_request !== request_id) return
        result = computed
      })
      .catch((err) => {
        if (this_request !== request_id) return
        // drop the stale curves, else `series` stays non-empty and the empty-state
        // StatusMessage that owns the error display never renders
        result = undefined
        error_msg = to_error(err).message
      })
      .finally(() => {
        if (this_request === request_id) loading = false
      })
  })

  let series = $derived.by<DataSeries[]>(() => {
    if (!result) return []
    const { times, curves, lags, dt } = result
    return curves.flatMap((curve, idx): DataSeries[] => {
      const color = PLOT_COLORS[idx % PLOT_COLORS.length]
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
  <ScatterPlot
    {...rest}
    {show_controls}
    bind:controls_open
    {series}
    x_axis={{ label: result.x_label, ...x_axis }}
    y_axis={{ label: `MSD (Å²)`, ...y_axis }}
    styles={{ show_lines: true, show_points: false }}
    style={rest.style ?? `height: 320px;`}
  />
  {#if show_summary}
    <table class="msd-summary">
      <thead>
        <tr>
          {#each [`Species`, `Atoms`, `D`, `R²`, `Fit lags`] as header (header)}
            <th>{header}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each result.curves as { label, n_atoms, fit } (label)}
          <tr>
            <td>{label}</td>
            <td>{n_atoms}</td>
            <td>
              {fit ? `${format_num(fit.diffusion_coefficient, `.3~e`)} ${fit.units}` : `—`}
            </td>
            <td>{fit ? format_num(fit.r_squared, `.4~f`) : `—`}</td>
            <td>{fit ? `${fit.lag_window[0]}–${fit.lag_window[1]}` : `—`}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="msd-note">
      {result.n_frames} frames × {result.n_atoms} atoms
      {#if result.frame_stride > 1}· 1 in {result.frame_stride} frames{/if}
      {#if result.origin_stride > 1}· 1 in {result.origin_stride} time origins{/if}
      {#if result.lag_stride > 1}· 1 in {result.lag_stride} lags{/if}
      · {result.unwrapped ? `unwrapped across periodic images` : `no unwrapping applied`}
    </p>
  {/if}
{/if}

<style>
  .msd-summary {
    width: 100%;
    font-size: 0.85em;
    border-collapse: collapse;
    margin-top: 4pt;
    th,
    td {
      text-align: left;
      padding: 2pt 4pt;
      border-bottom: 1px solid var(--border-color, #8884);
    }
  }
  .msd-note {
    font-size: 0.75em;
    opacity: 0.7;
    margin: 4pt 0 0;
  }
</style>
