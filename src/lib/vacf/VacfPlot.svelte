<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { to_error } from '$lib/utils'
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
  } & ComponentProps<typeof ScatterPlot> = $props()

  // Async compute can't be a $derived; a request id drops results of superseded inputs
  let request_id = 0
  $effect(() => {
    const [request_input, options] = [input, vacf_options]
    const this_request = ++request_id
    if (!request_input) {
      loading = false
      return
    }
    loading = true
    error_msg = undefined
    compute_vacf_async(request_input, options)
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
      line_style: { stroke: PLOT_COLORS[idx % PLOT_COLORS.length], stroke_width: 2 },
    }))

  // n_origins/std_error per point so the tooltip can show how thin the tail is. The VDOS
  // gets none: its x axis is frequency bins, which have no time origins.
  let vacf_series = $derived(
    curve_series(
      result?.times ?? [],
      (curve) => curve.vacf_normalized,
      (curve) =>
        (result?.lags ?? []).map((lag, point_idx) => ({
          lag,
          n_origins: curve.n_origins[point_idx],
          std_error: curve.std_error[point_idx],
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
  {#snippet panel_plot(series: DataSeries[], x_label: string, y_label: string)}
    <ScatterPlot
      {...rest}
      {series}
      x_axis={{ label: x_label }}
      y_axis={{ label: y_label }}
      styles={{ show_lines: true, show_points: false }}
      style={plot_style}
    />
  {/snippet}
  {#if show_vacf}{@render panel_plot(vacf_series, result.x_label, `VACF / VACF(0)`)}{/if}
  {#if show_vdos}
    {@render panel_plot(vdos_series, result.frequency_label, `VDOS (arb. units)`)}
  {/if}
  {#if show_summary}
    <table class="vacf-summary">
      <thead>
        <tr>
          {#each [`Species`, `Atoms`, `VACF(0)`, `Peak`] as header (header)}
            <th>{header}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each result.curves as { label, n_atoms, vacf, peak_frequency } (label)}
          <tr>
            <td>{label}</td>
            <td>{n_atoms}</td>
            <td>{format_num(vacf[0], `.3~e`)} {result.velocity_unit}</td>
            <td>
              {peak_frequency === null
                ? `—`
                : `${format_num(peak_frequency, `.4~g`)} ${result.frequency_unit}`}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="vacf-note">
      {result.n_frames} velocity frames × {result.n_atoms} atoms
      {#if result.frame_stride > 1}· 1 in {result.frame_stride} source frames{/if}
      {#if result.origin_stride > 1}· 1 in {result.origin_stride} time origins{/if}
      {#if result.lag_stride > 1}
        · 1 in {result.lag_stride} lags, which lowers the VDOS Nyquist frequency by the same factor
      {/if}
      · {result.velocity_source === `stored`
        ? `velocities read from the file`
        : `central differences of ${result.unwrapped ? `unwrapped` : `raw`} positions`}
      · {result.window} window
      {#if result.frequency_unit === `1/frame`}
        · no timestep supplied, so frequencies are per frame
      {/if}
    </p>
  {/if}
{/if}

<style>
  .vacf-summary {
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
  .vacf-note {
    font-size: 0.75em;
    opacity: 0.7;
    margin: 4pt 0 0;
  }
</style>
