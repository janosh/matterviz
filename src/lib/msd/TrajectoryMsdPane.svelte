<script lang="ts">
  import type { ViewerPaneOptions } from '$lib/overlays'
  import type { TrajectoryType } from '$lib/trajectory'
  import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
  import { collect_msd_positions, suggest_msd_frame_stride } from './collect'
  import type { MsdOptions, MsdPositions, MsdResult } from './index'
  import MsdPlot from './MsdPlot.svelte'

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    default_dt = null,
    default_time_unit,
    ...pane_options
  }: ViewerPaneOptions & {
    trajectory?: TrajectoryType
    // Raw file bytes from Trajectory.svelte's orig_data for source-dependent loaders.
    raw_data?: string | ArrayBuffer | null
    pane_open?: boolean
    result?: MsdResult
    // Time between source frames as recorded in the file. When present the pane starts
    // with a real time axis instead of lags in frames; the user can still override it.
    default_dt?: number | null
    default_time_unit?: string
  } = $props()

  let max_lag_fraction = $state(0.5)
  let fit_start_fraction = $state(0.2)
  let fit_end_fraction = $state(0.8)
  let positions = $state<MsdPositions | undefined>(undefined)
  let plotting = $state(false)
  let error_msg = $state<string | undefined>(undefined)

  const msd_options = (has_valid_dt: boolean, dt: number, time_unit: string): MsdOptions => ({
    ...(has_valid_dt ? { dt, time_unit } : {}),
    max_lag_fraction,
    fit: { start_fraction: fit_start_fraction, end_fraction: fit_end_fraction },
  })
</script>

<TrajectoryAnalysisPane
  {trajectory}
  {raw_data}
  bind:pane_open
  bind:input={positions}
  bind:error_msg
  busy={plotting}
  title="Mean Squared Displacement"
  pane_name="mean squared displacement"
  class_prefix="trajectory-msd"
  analysis_name="MSD"
  collect={collect_msd_positions}
  suggest_stride={suggest_msd_frame_stride}
  compute_label="Compute MSD"
  recollect_label="Recollect positions"
  {default_dt}
  {default_time_unit}
  time_unit_fallback="ps"
  on_clear={() => (result = undefined)}
  {...pane_options}
>
  {#snippet controls()}
    <label>
      Max lag
      <input type="number" min="0.05" max="1" step="0.05" bind:value={max_lag_fraction} />
      <span>× length</span>
    </label>
    <label>
      Fit window
      <input type="number" min="0" max="1" step="0.05" bind:value={fit_start_fraction} />
      <input type="number" min="0" max="1" step="0.05" bind:value={fit_end_fraction} />
    </label>
  {/snippet}
  {#snippet children({ input, has_valid_dt, dt_collected, time_unit })}
    <MsdPlot
      positions={input}
      msd_options={msd_options(has_valid_dt, dt_collected, time_unit)}
      bind:result
      bind:loading={plotting}
      bind:error_msg
    />
  {/snippet}
</TrajectoryAnalysisPane>
