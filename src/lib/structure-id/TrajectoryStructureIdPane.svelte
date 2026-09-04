<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { ViewerPaneOptions } from '$lib/overlays'
  import type { TrajectoryRun } from '$lib/trajectory'
  import { positive_int, sweep_frame_plan, sweep_progress } from '$lib/trajectory/analysis'
  import type { AnalysisCollectOptions } from '$lib/trajectory/analysis'
  import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
  import { Lattice } from 'svelte-widgets/icons'
  import type { StructureIdSweep } from './collect'
  import { collect_structure_id_sweep, DEFAULT_MAX_SWEEP_FRAMES } from './collect'
  import StructureTypePlot from './StructureTypePlot.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: StructureIdSweep
  } = $props()

  // null, not 0, is what <input type="number"> writes back when cleared
  let max_frames = $state<number | null>(DEFAULT_MAX_SWEEP_FRAMES)
  let normalize = $state(false)
  let error_msg = $state<string | undefined>(undefined)

  let safe_max_frames = $derived(positive_int(max_frames, DEFAULT_MAX_SWEEP_FRAMES))

  // The sweep loads one frame at a time, so there is no position buffer to stride: the
  // shared pane's frame-stride control stays hidden and `max_frames` caps the sample instead.
  const collect = (
    target: TrajectoryRun,
    { on_progress, signal, start_frame, end_frame }: AnalysisCollectOptions,
  ): Promise<StructureIdSweep> =>
    collect_structure_id_sweep(target, {
      signal,
      start_frame,
      end_frame,
      max_frames: safe_max_frames,
      // CSP is not plotted here, and skipping it drops the second neighbor pass per frame
      options: { skip_csp: true },
      on_progress: sweep_progress(on_progress),
    })
</script>

<TrajectoryAnalysisPane
  {run}
  bind:pane_open
  bind:input={result}
  bind:error_msg
  title="Structure Type Identification"
  pane_name="structure type identification"
  class_prefix="trajectory-structure-id"
  icon={Lattice}
  analysis_name="Structure identification"
  {collect}
  compute_label="Identify structure types"
  recollect_label="Recompute"
  collecting_label="Identifying…"
  {...pane_options}
>
  <!-- with no stride control, collected_frames is the trajectory's total frame count -->
  {#snippet controls({ collected_frames: total_frames, n_atoms })}
    {@const plan =
      total_frames > 0
        ? sweep_frame_plan(total_frames, safe_max_frames)
        : { frame_numbers: [], frame_stride: 1 }}
    <label>
      Max frames
      <input type="number" min="1" step="1" bind:value={max_frames} />
    </label>
    <label>
      <input type="checkbox" bind:checked={normalize} />
      Plot fraction of atoms
    </label>
    <p class="hint">
      {plan.frame_numbers.length} of {total_frames} frames
      {#if plan.frame_stride > 1}(every {plan.frame_stride}){/if}
      <!-- a-CNA measured at ~9-14 µs/atom; the upper end is what a user should plan for -->
      × {n_atoms} atoms ≈ {format_num(plan.frame_numbers.length * n_atoms * 14e-6, `.2~g`)} s
    </p>
  {/snippet}
  {#snippet children({ input, collecting })}
    <!-- results come from the sweep, so there is nothing a dropped file could add -->
    <StructureTypePlot
      id_results={input?.results ?? []}
      frame_labels={input?.frame_numbers}
      layout="over_frames"
      {normalize}
      loading={collecting}
      {error_msg}
      allow_file_drop={false}
    />
  {/snippet}
</TrajectoryAnalysisPane>
