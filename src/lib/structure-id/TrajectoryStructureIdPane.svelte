<script lang="ts">
  import { display_idx, format_num, from_display_idx } from '#lib/labels.js'
  import type { ViewerPaneOptions } from '#lib/overlays/index.js'
  import type { TrajectoryRun } from '#lib/trajectory/index.js'
  import { positive_int, sweep_progress, window_sweep_plan } from '#lib/trajectory/analysis.js'
  import type { AnalysisCollectOptions } from '#lib/trajectory/analysis.js'
  import TrajectoryAnalysisPane from '#lib/trajectory/TrajectoryAnalysisPane.svelte'
  import { cna_type_source_atoms } from '#lib/trajectory/linked-sites.js'
  import { Lattice } from 'svelte-widgets/icons'
  import type { CnaTypeName } from './calc-cna'
  import { CNA_TYPES } from './calc-cna'
  import type { StructureIdSweep } from './collect'
  import { collect_structure_id_sweep, DEFAULT_MAX_SWEEP_FRAMES } from './collect'
  import StructureTypePlot from './StructureTypePlot.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    current_frame_idx = null,
    on_frame_select,
    on_atoms_hover,
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: StructureIdSweep
    current_frame_idx?: number | null // marked on the plot with a playhead line
    on_frame_select?: (frame_idx: number) => void // the analysed frame nearest a plot click
    // Atoms of the hovered structure type, classified in the analysed frame nearest the one on
    // display (`frame_number`); null once the pointer leaves
    on_atoms_hover?: (hover: { atom_indices: number[]; frame_number: number } | null) => void
  } = $props()

  // null, not 0, is what <input type="number"> writes back when cleared
  let max_frames = $state<number | null>(DEFAULT_MAX_SWEEP_FRAMES)
  let normalize = $state(false)
  let error_msg = $state<string | undefined>(undefined)
  // Frame the hovered type's atoms were classified in, flagged when it is not the one shown
  let hover_frame = $state<number | null>(null)

  const hover_type = (type: CnaTypeName | null): void => {
    const hover =
      type && result && current_frame_idx !== null
        ? cna_type_source_atoms(result, current_frame_idx, CNA_TYPES[type])
        : null
    hover_frame = hover?.frame_number ?? null
    on_atoms_hover?.(hover)
  }

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
  <!-- with no stride control, collected_frames is the selected frame window's count -->
  {#snippet controls({ collected_frames: window_frames, n_atoms })}
    {@const plan = window_sweep_plan(window_frames, safe_max_frames)}
    <label>
      Max frames
      <input type="number" min="1" step="1" bind:value={max_frames} />
    </label>
    <label>
      <input type="checkbox" bind:checked={normalize} />
      Plot fraction of atoms
    </label>
    <p class="hint">
      {plan.frame_numbers.length} of {window_frames} frames
      {#if plan.frame_stride > 1}(every {plan.frame_stride}){/if}
      <!-- a-CNA measured at ~9-14 µs/atom; the upper end is what a user should plan for -->
      × {n_atoms} atoms ≈ {format_num(plan.frame_numbers.length * n_atoms * 14e-6, `.2~g`)} s
    </p>
  {/snippet}
  {#snippet children({ input, collecting })}
    <!-- results come from the sweep, so there is nothing a dropped file could add. The Frame
    axis counts from 1 like the step input; seeks hand back the 0-based index -->
    <StructureTypePlot
      id_results={input?.results ?? []}
      frame_labels={input?.frame_numbers.map(display_idx)}
      layout="over_frames"
      {normalize}
      loading={collecting}
      {error_msg}
      allow_file_drop={false}
      current_frame={current_frame_idx === null ? null : display_idx(current_frame_idx)}
      on_frame_click={on_frame_select &&
        ((frame_number) => on_frame_select(from_display_idx(frame_number)))}
      on_type_hover={on_atoms_hover && hover_type}
    />
    {#if hover_frame !== null && hover_frame !== current_frame_idx}
      <p class="hint">
        Highlighted atoms are classified in frame {display_idx(hover_frame)}, the analysed
        frame nearest the one shown
      </p>
    {/if}
  {/snippet}
</TrajectoryAnalysisPane>
