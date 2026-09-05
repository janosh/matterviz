<script lang="ts">
  import { WINDOW_TYPES, type WindowType } from '$lib/fft'
  import type { ViewerPaneOptions } from '$lib/overlays'
  import type { TrajectoryRun } from '$lib/trajectory'
  import type { AnalysisPaneContext } from '$lib/trajectory/analysis'
  import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
  import {
    frequency_unit_label,
    MD_FREQUENCY_UNITS,
    thz_per_inverse_time,
    TIME_UNIT_TO_THZ,
  } from '$lib/spectral/frequency-units'
  import { collect_vacf_input, suggest_vacf_frame_stride } from './collect'
  import type { VacfFrequencyUnit, VacfInput, VacfOptions, VacfResult } from './index'
  import VacfPlot from './VacfPlot.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    default_dt = null,
    default_time_unit,
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: VacfResult
    // Time between source frames as recorded in the file. Without it the VDOS axis can
    // only be labelled in inverse frames, so a file that knows its timestep should say so.
    default_dt?: number | null
    default_time_unit?: string
  } = $props()

  let max_lag_fraction = $state(0.5)
  let window_type = $state<WindowType>(`hann`)
  let frequency_unit = $state<VacfFrequencyUnit>(`THz`)
  let panel = $state<`vacf` | `vdos` | `both`>(`both`)
  let input = $state<VacfInput | undefined>(undefined)
  let plotting = $state(false)
  let error_msg = $state<string | undefined>(undefined)

  // A lag axis in an unconvertible unit (e.g. `steps`) still gets real lag times, but the
  // VDOS can only be reported per frame. The context is not destructured: its fields are
  // getters and VacfPlot recomputes on every new options object, so dt/time_unit are only
  // read once a timestep is actually in use.
  type Ctx = AnalysisPaneContext<VacfInput>
  const effective_frequency_unit = (ctx: Ctx): VacfFrequencyUnit =>
    ctx.has_valid_dt && thz_per_inverse_time(ctx.time_unit) !== undefined
      ? frequency_unit
      : `1/frame`
  const vacf_options = (ctx: Ctx): VacfOptions => ({
    ...(ctx.has_valid_dt ? { dt: ctx.dt_collected, time_unit: ctx.time_unit } : {}),
    max_lag_fraction,
    vdos: { window: window_type, frequency_unit: effective_frequency_unit(ctx) },
  })
</script>

<TrajectoryAnalysisPane
  {run}
  bind:pane_open
  bind:input
  bind:error_msg
  busy={plotting}
  title="Velocity Autocorrelation & Vibrational DOS"
  pane_name="velocity autocorrelation and vibrational DOS"
  class_prefix="trajectory-vacf"
  analysis_name="VACF"
  collect={collect_vacf_input}
  frame_steps={(input) => input.steps}
  suggest_stride={(source, frame_count) =>
    suggest_vacf_frame_stride(source, undefined, frame_count)}
  compute_label="Compute VACF"
  recollect_label="Recollect velocities"
  bytes_per_atom_frame={input?.velocities ? 48 : 24}
  {default_dt}
  {default_time_unit}
  time_unit_fallback="fs"
  on_clear={() => (result = undefined)}
  {...pane_options}
>
  {#snippet controls(ctx)}
    <label>
      Max lag
      <input type="number" min="0.05" max="1" step="0.05" bind:value={max_lag_fraction} />
      <span>× length</span>
    </label>
    <label>
      Window
      <select bind:value={window_type}>
        {#each WINDOW_TYPES as choice (choice)}<option value={choice}>{choice}</option>{/each}
      </select>
      <span class="hint">applied to the VACF before transforming</span>
    </label>
    <label>
      Frequency axis
      <select
        bind:value={frequency_unit}
        disabled={effective_frequency_unit(ctx) === `1/frame`}
      >
        {#each MD_FREQUENCY_UNITS as unit (unit)}
          <option value={unit}>{frequency_unit_label(unit)}</option>
        {/each}
      </select>
      <span class="hint">{frequency_unit_label(effective_frequency_unit(ctx))}</span>
    </label>
    <label>
      Show
      <select bind:value={panel}>
        {#each [`both`, `vacf`, `vdos`] as choice (choice)}
          <option value={choice}>{choice}</option>
        {/each}
      </select>
    </label>
  {/snippet}
  {#snippet hint({ has_valid_dt, time_unit })}
    {#if !has_valid_dt}
      and the VDOS axis in inverse frames
    {:else if thz_per_inverse_time(time_unit) === undefined}
      {`· ${time_unit} is not one of ${Object.keys(TIME_UNIT_TO_THZ).join(`, `)}, so lag time keeps ${time_unit} while the VDOS axis stays in inverse frames`}
    {/if}
  {/snippet}
  {#snippet children(ctx)}
    <VacfPlot
      input={ctx.input}
      vacf_options={vacf_options(ctx)}
      {panel}
      bind:result
      bind:loading={plotting}
      bind:error_msg
    />
  {/snippet}
</TrajectoryAnalysisPane>
