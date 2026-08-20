<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { ViewerPaneOptions } from '$lib/overlays'
  import type { TrajectoryType } from '$lib/trajectory'
  import type { AnalysisCollectOptions } from '$lib/trajectory/analysis-pane'
  import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
  import { Lattice } from 'svelte-widgets/icons'
  import type { StructureIdSweep } from './collect'
  import {
    collect_structure_id_sweep,
    DEFAULT_MAX_SWEEP_FRAMES,
    sweep_frame_plan,
  } from './collect'
  import StructureTypePlot from './StructureTypePlot.svelte'

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    ...pane_options
  }: ViewerPaneOptions & {
    trajectory?: TrajectoryType
    // Raw file bytes from Trajectory.svelte's orig_data for source-dependent loaders.
    raw_data?: string | ArrayBuffer | null
    pane_open?: boolean
    result?: StructureIdSweep
  } = $props()

  // null, not 0, is what <input type="number"> writes back when cleared
  let max_frames = $state<number | null>(DEFAULT_MAX_SWEEP_FRAMES)
  let normalize = $state(false)
  let error_msg = $state<string | undefined>(undefined)

  // sweep_frame_plan rejects a non-integer or sub-1 cap outright, so normalise once here.
  // Number.isFinite also catches the Infinity a `1e999` entry produces.
  let safe_max_frames = $derived(
    max_frames !== null && Number.isFinite(max_frames) && max_frames >= 1
      ? Math.floor(max_frames)
      : DEFAULT_MAX_SWEEP_FRAMES,
  )

  // The sweep loads one frame at a time, so there is no position buffer to stride: the
  // shared pane's frame-stride control stays hidden and `max_frames` caps the sample instead.
  const collect = (
    target: TrajectoryType,
    { raw_data: bytes, on_progress }: AnalysisCollectOptions,
  ): Promise<StructureIdSweep> =>
    collect_structure_id_sweep(target, {
      raw_data: bytes,
      max_frames: safe_max_frames,
      // CSP is not plotted here, and skipping it drops the second neighbor pass per frame
      options: { skip_csp: true },
      on_progress: (done, total) =>
        on_progress({ current: done, total, stage: `frame ${done} of ${total}` }),
    })
</script>

<TrajectoryAnalysisPane
  {trajectory}
  {raw_data}
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
  {#snippet children({ input })}
    <StructureTypePlot
      id_results={input?.results ?? []}
      frame_labels={input?.frame_numbers}
      layout="over_frames"
      {normalize}
      {error_msg}
    />
  {/snippet}
</TrajectoryAnalysisPane>
