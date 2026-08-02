<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import { has_all_frames_in_memory, trajectory_total_frames } from '$lib/msd/collect'
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { TrajectoryType } from '$lib/trajectory'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import {
    collect_structure_id_sweep,
    DEFAULT_MAX_SWEEP_FRAMES,
    type StructureIdSweep,
    sweep_frame_plan,
  } from './collect'
  import StructureTypePlot from './StructureTypePlot.svelte'

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    toggle_props,
    pane_props,
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    trajectory?: TrajectoryType
    // Raw file bytes from Trajectory.svelte's orig_data. Required for indexed
    // trajectories, whose `frames` array holds only the first few frames.
    raw_data?: string | ArrayBuffer | null
    pane_open?: boolean
    result?: StructureIdSweep
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // null, not 0, is what <input type="number"> writes back when cleared
  let max_frames = $state<number | null>(DEFAULT_MAX_SWEEP_FRAMES)
  let normalize = $state(false)
  let computing = $state(false)
  let error_msg = $state<string | undefined>(undefined)
  let progress = $state<{ done: number; total: number } | null>(null)

  // trajectory_total_frames throws for an indexed trajectory that reports no total_frames,
  // and has_all_frames_in_memory routes through it. The message rides back with the values
  // because writing to state from inside a $derived is state_unsafe_mutation.
  let { total_frames, is_lazy, setup_error } = $derived.by(() => {
    const blank = { total_frames: 0, is_lazy: false }
    if (!trajectory) return { ...blank, setup_error: undefined }
    try {
      return {
        total_frames: trajectory_total_frames(trajectory),
        is_lazy: !has_all_frames_in_memory(trajectory),
        setup_error: undefined,
      }
    } catch (exc) {
      return { ...blank, setup_error: to_error(exc).message }
    }
  })
  let loaded_frames = $derived(trajectory?.frames.length ?? 0)
  let n_atoms = $derived(trajectory?.frames[0]?.structure.sites.length ?? 0)
  // sweep_frame_plan rejects a non-integer or sub-1 cap outright, so normalise once here.
  // Number.isFinite also catches the Infinity a `1e999` entry produces.
  let safe_max_frames = $derived(
    max_frames !== null && Number.isFinite(max_frames) && max_frames >= 1
      ? Math.floor(max_frames)
      : DEFAULT_MAX_SWEEP_FRAMES,
  )
  let plan = $derived(
    total_frames > 0
      ? sweep_frame_plan(total_frames, safe_max_frames)
      : { frame_numbers: [], frame_stride: 1 },
  )
  // a-CNA measured at ~9-14 µs/atom; the upper end is what a user should plan for
  let estimated_seconds = $derived(plan.frame_numbers.length * n_atoms * 14e-6)

  // Drop a stale sweep whenever the underlying trajectory is swapped out — its frame
  // numbers and atom count belong to a run that is no longer on screen
  let analysed_trajectory: TrajectoryType | undefined
  $effect(() => {
    if (trajectory === analysed_trajectory) return
    analysed_trajectory = trajectory
    result = undefined
    error_msg = undefined
  })

  async function compute() {
    if (!trajectory) return
    computing = true
    error_msg = undefined
    try {
      result = await collect_structure_id_sweep(trajectory, {
        raw_data,
        max_frames: safe_max_frames,
        // CSP is not plotted here, and skipping it drops the second neighbor pass per frame
        options: { skip_csp: true },
        on_progress: (done, total) => (progress = { done, total }),
      })
    } catch (exc) {
      // clearing the result too, else the previous curves stay up and hide this error
      result = undefined
      error_msg = to_error(exc).message
    } finally {
      computing = false
      progress = null
    }
  }
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="34em"
  toggle_props={{
    title: pane_open ? `` : `Structure type identification`,
    ...toggle_props,
    class: `trajectory-structure-id-toggle ${toggle_props?.class ?? ``}`,
  }}
  pane_props={{
    ...pane_props,
    class: `trajectory-structure-id-pane ${pane_props?.class ?? ``}`,
  }}
  open_icon="Cross"
  closed_icon="Lattice"
  {...rest}
>
  <h4 style="margin-top: 0">Structure Type Identification</h4>

  {#if !trajectory}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    {#if setup_error}
      <StatusMessage type="error" message={setup_error} style="font-size: 0.8em" />
    {:else if is_lazy}
      <StatusMessage
        type="warning"
        message="Indexed trajectory: {loaded_frames} of {total_frames} frames are in memory. Sampled frames are loaded on demand{raw_data
          ? ``
          : `, but the raw file bytes are unavailable here`}."
        style="font-size: 0.8em"
      />
    {/if}

    <div class="structure-id-controls">
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
        × {n_atoms} atoms ≈ {format_num(estimated_seconds, `.2~g`)} s
      </p>
      <button onclick={compute} disabled={computing}>
        {computing ? `Identifying…` : result ? `Recompute` : `Identify structure types`}
      </button>
      {#if progress}
        <span class="hint">frame {progress.done} of {progress.total}</span>
      {/if}
    </div>

    <!-- Rendered unconditionally so StructureTypePlot stays the single owner of the message
    area: collect errors land in the same slot as its empty state -->
    <StructureTypePlot
      id_results={result?.results ?? []}
      frame_labels={result?.frame_numbers}
      layout="over_frames"
      {normalize}
      loading={computing}
      {error_msg}
    />
  {/if}
</DraggablePane>

<style>
  .structure-id-controls {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    font-size: 0.85em;
    label {
      display: flex;
      align-items: center;
      gap: 4pt;
    }
    input[type='number'] {
      width: 5em;
      text-align: center;
    }
    button {
      align-self: flex-start;
      padding: 2pt 8pt;
    }
  }
  .hint {
    opacity: 0.7;
    font-size: 0.9em;
    margin: 0;
  }
</style>
