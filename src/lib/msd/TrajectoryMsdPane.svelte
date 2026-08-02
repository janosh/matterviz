<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_bytes, format_num } from '$lib/labels'
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import {
    analysis_pane_setup,
    collect_msd_positions,
    suggest_msd_frame_stride,
  } from './collect'
  import type { MsdOptions, MsdPositions, MsdResult } from './index'
  import MsdPlot from './MsdPlot.svelte'

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    default_dt = null,
    default_time_unit,
    toggle_props,
    pane_props,
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    trajectory?: TrajectoryType
    // Raw file bytes from Trajectory.svelte's orig_data. Required for indexed
    // trajectories, whose `frames` array holds only the first few frames.
    raw_data?: string | ArrayBuffer | null
    pane_open?: boolean
    result?: MsdResult
    // Time between source frames as recorded in the file. When present the pane starts
    // with a real time axis instead of lags in frames; the user can still override it.
    default_dt?: number | null
    default_time_unit?: string
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // Control-panel state. dt_source is the time between two SOURCE frames; collecting
  // every Nth frame multiplies it (see dt_collected below).
  // Seeded from complete timestep metadata below, and re-seeded on trajectory swap
  let dt_source = $state<number | null>(1)
  let time_unit = $state(`ps`)
  let use_dt = $state(false)
  let max_lag_fraction = $state(0.5)
  let fit_start_fraction = $state(0.2)
  let fit_end_fraction = $state(0.8)
  // null, not 0, is what <input type="number"> writes back when cleared
  let frame_stride = $state<number | null>(1)

  let positions = $state<MsdPositions | undefined>(undefined)
  let collecting = $state(false)
  let plotting = $state(false)
  let error_msg = $state<string | undefined>(undefined)
  let progress = $state<ParseProgress | null>(null)

  let { total_frames, is_lazy, suggested_stride, setup_error } = $derived(
    analysis_pane_setup(trajectory, suggest_msd_frame_stride),
  )
  let loaded_frames = $derived(trajectory?.frames.length ?? 0)
  let n_atoms = $derived(trajectory?.frames[0]?.structure.sites.length ?? 0)
  // accumulate_positions rejects a non-integer stride outright, so normalise once here.
  // Number.isFinite also catches the Infinity a `1e999` entry produces.
  let safe_stride = $derived(
    frame_stride !== null && Number.isFinite(frame_stride) && frame_stride >= 1
      ? Math.floor(frame_stride)
      : 1,
  )
  let collected_frames = $derived(Math.ceil(total_frames / safe_stride))
  let estimated_bytes = $derived(collected_frames * n_atoms * 3 * 8)

  // Drop stale positions/curves whenever the underlying trajectory is swapped out, and
  // re-seed the timestep from the file rather than carrying the previous one over. Seeding
  // also keys on the defaults so metadata that only becomes known later still lands.
  let analysed_trajectory: TrajectoryType | undefined
  let seeded_dt: number | null | undefined
  let seeded_time_unit: string | undefined
  $effect(() => {
    const trajectory_changed = trajectory !== analysed_trajectory
    if (trajectory_changed) {
      analysed_trajectory = trajectory
      positions = undefined
      result = undefined
      error_msg = undefined
    }
    if (
      trajectory_changed ||
      default_dt !== seeded_dt ||
      default_time_unit !== seeded_time_unit
    ) {
      seeded_dt = default_dt
      seeded_time_unit = default_time_unit
      const has_default_timestep =
        default_dt !== null &&
        Number.isFinite(default_dt) &&
        default_dt > 0 &&
        Boolean(default_time_unit)
      dt_source = has_default_timestep ? default_dt : 1
      time_unit = has_default_timestep && default_time_unit ? default_time_unit : `ps`
      use_dt = has_default_timestep
    }
  })

  // MsdOptions.dt is time per COLLECTED frame, so striding has to be folded in here —
  // otherwise entering the real MD timestep with stride 5 reports D five times too large
  // with correct-looking units.
  let dt_collected = $derived((dt_source ?? 1) * safe_stride)
  let has_valid_dt = $derived(
    use_dt &&
      dt_source !== null &&
      Number.isFinite(dt_source) &&
      dt_source > 0 &&
      time_unit.length > 0,
  )
  let msd_options = $derived<MsdOptions>({
    ...(has_valid_dt ? { dt: dt_collected, time_unit } : {}),
    max_lag_fraction,
    fit: { start_fraction: fit_start_fraction, end_fraction: fit_end_fraction },
  })

  async function collect() {
    if (!trajectory) return
    collecting = true
    error_msg = undefined
    progress = null
    try {
      positions = await collect_msd_positions(trajectory, {
        raw_data,
        frame_stride: safe_stride,
        on_progress: (parse_progress) => (progress = parse_progress),
      })
    } catch (exc) {
      // clearing only `positions` would leave MsdPlot's effect early-returning on the
      // missing input, so the previous curves stay up and hide this error
      positions = undefined
      result = undefined
      error_msg = to_error(exc).message
    } finally {
      collecting = false
      progress = null
    }
  }
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="34em"
  toggle_props={{
    title: pane_open ? `` : `Mean squared displacement`,
    ...toggle_props,
    class: `trajectory-msd-toggle ${toggle_props?.class ?? ``}`,
  }}
  pane_props={{ ...pane_props, class: `trajectory-msd-pane ${pane_props?.class ?? ``}` }}
  open_icon="Cross"
  closed_icon="Graph"
  {...rest}
>
  <h4 style="margin-top: 0">Mean Squared Displacement</h4>

  {#if !trajectory}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    {#if setup_error}
      <StatusMessage type="error" message={setup_error} style="font-size: 0.8em" />
    {:else if is_lazy}
      <StatusMessage
        type="warning"
        message="Indexed trajectory: {loaded_frames} of {total_frames} frames are in memory. MSD streams the full payload{raw_data
          ? ``
          : `, but the raw file bytes are unavailable here`}."
        style="font-size: 0.8em"
      />
    {/if}

    <div class="msd-controls">
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
      <label>
        Frame stride
        <input type="number" min="1" step="1" bind:value={frame_stride} />
        {#if suggested_stride && suggested_stride > safe_stride}
          <span class="hint">needs ≥ {suggested_stride}</span>
        {/if}
      </label>
      <label>
        <input type="checkbox" bind:checked={use_dt} />
        Time per source frame
        <input type="number" min="0" step="0.001" bind:value={dt_source} disabled={!use_dt} />
        <input
          type="text"
          bind:value={time_unit}
          disabled={!use_dt}
          style="width: 4em"
          aria-label="Time unit"
        />
      </label>
      <p class="hint">
        {collected_frames} frames × {n_atoms} atoms ≈ {format_bytes(estimated_bytes)}
        {#if has_valid_dt}· {format_num(dt_collected, `.4~g`)} {time_unit} per collected frame
        {:else}· lag axis in frames (no valid timestep is available){/if}
      </p>
      <button onclick={collect} disabled={collecting || plotting}>
        {collecting ? `Reading frames…` : positions ? `Recollect positions` : `Compute MSD`}
      </button>
      {#if progress}<span class="hint">{progress.stage}</span>{/if}
    </div>

    <!-- Rendered unconditionally so MsdPlot stays the single owner of the message area:
    collect errors land in the same slot as compute errors and the empty state -->
    <MsdPlot {positions} {msd_options} bind:result bind:loading={plotting} bind:error_msg />
  {/if}
</DraggablePane>

<style>
  .msd-controls {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    font-size: 0.85em;
    label {
      display: flex;
      align-items: center;
      gap: 4pt;
    }
    input[type='number'],
    input[type='text'] {
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
