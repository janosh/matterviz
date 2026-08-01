<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { WINDOW_TYPES, type WindowType } from '$lib/fft'
  import { format_bytes, format_num } from '$lib/labels'
  import { has_all_frames_in_memory, trajectory_total_frames } from '$lib/msd'
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import { collect_vacf_input, suggest_vacf_frame_stride } from './collect'
  import { TIME_UNIT_TO_THZ, VACF_FREQUENCY_UNITS } from './index'
  import type { VacfFrequencyUnit, VacfInput, VacfOptions, VacfResult } from './index'
  import VacfPlot from './VacfPlot.svelte'

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
    result?: VacfResult
    // Time between source frames as recorded in the file. Without it the VDOS axis can
    // only be labelled in inverse frames, so a file that knows its timestep should say so.
    default_dt?: number | null
    default_time_unit?: string
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // Control-panel state. dt_source is the time between two SOURCE frames; collecting every
  // Nth frame multiplies it (see dt_collected below).
  // Seeded from default_dt by the effect below, which also re-seeds on trajectory swap
  let dt_source = $state(1)
  let time_unit = $state(`fs`)
  let use_dt = $state(false)
  let max_lag_fraction = $state(0.5)
  let window_type = $state<WindowType>(`hann`)
  let frequency_unit = $state<VacfFrequencyUnit>(`THz`)
  let panel = $state<`vacf` | `vdos` | `both`>(`both`)
  // null, not 0, is what <input type="number"> writes back when cleared
  let frame_stride = $state<number | null>(1)

  let input = $state<VacfInput | undefined>(undefined)
  let collecting = $state(false)
  let plotting = $state(false)
  let error_msg = $state<string | undefined>(undefined)
  let progress = $state<ParseProgress | null>(null)

  // trajectory_total_frames throws for an indexed trajectory that reports no total_frames,
  // and the other two route through it. The message rides back with the values because
  // writing to state from inside a $derived is state_unsafe_mutation.
  let { total_frames, is_lazy, suggested_stride, setup_error } = $derived.by(() => {
    const blank = { total_frames: 0, is_lazy: false, suggested_stride: null }
    if (!trajectory) return { ...blank, setup_error: undefined }
    try {
      return {
        total_frames: trajectory_total_frames(trajectory),
        is_lazy: !has_all_frames_in_memory(trajectory),
        suggested_stride: suggest_vacf_frame_stride(trajectory),
        setup_error: undefined,
      }
    } catch (exc) {
      return { ...blank, setup_error: to_error(exc).message }
    }
  })
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
  // Positions plus, once collected, the velocity buffer if the file stored one
  let buffers = $derived(input?.velocities ? 2 : 1)
  let estimated_bytes = $derived(collected_frames * n_atoms * 3 * 8 * buffers)

  // Drop stale input/curves whenever the underlying trajectory is swapped out, and re-seed
  // the timestep from the file rather than carrying the previous one over. Seeding also
  // keys on default_dt so a timestep that only becomes known later still lands.
  let analysed_trajectory: TrajectoryType | undefined
  let seeded_dt: number | null | undefined
  $effect(() => {
    const trajectory_changed = trajectory !== analysed_trajectory
    if (trajectory_changed) {
      analysed_trajectory = trajectory
      input = undefined
      result = undefined
      error_msg = undefined
    }
    if (trajectory_changed || default_dt !== seeded_dt) {
      seeded_dt = default_dt
      dt_source = default_dt ?? 1
      time_unit = default_time_unit ?? `fs`
      use_dt = default_dt !== null
    }
  })

  // VacfOptions.dt is time per COLLECTED frame, so striding has to be folded in here —
  // otherwise entering the real MD timestep with stride 5 puts every VDOS peak at five
  // times its true frequency with correct-looking units.
  let dt_collected = $derived(dt_source * safe_stride)
  // Without a dt the only honest frequency axis is inverse frames; calc_vacf throws rather
  // than inventing a THz scale, so don't ask it to.
  let effective_frequency_unit = $derived<VacfFrequencyUnit>(
    use_dt && TIME_UNIT_TO_THZ[time_unit] !== undefined ? frequency_unit : `1/frame`,
  )
  let vacf_options = $derived<VacfOptions>({
    ...(use_dt ? { dt: dt_collected, time_unit } : {}),
    max_lag_fraction,
    vdos: { window: window_type, frequency_unit: effective_frequency_unit },
  })

  async function collect() {
    if (!trajectory) return
    collecting = true
    error_msg = undefined
    progress = null
    try {
      input = await collect_vacf_input(trajectory, {
        raw_data,
        frame_stride: safe_stride,
        on_progress: (parse_progress) => (progress = parse_progress),
      })
    } catch (exc) {
      // clearing only `input` would leave VacfPlot's effect early-returning on the missing
      // input, so the previous curves stay up and hide this error
      input = undefined
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
    title: pane_open ? `` : `Velocity autocorrelation and vibrational DOS`,
    ...toggle_props,
    class: `trajectory-vacf-toggle ${toggle_props?.class ?? ``}`,
  }}
  pane_props={{ ...pane_props, class: `trajectory-vacf-pane ${pane_props?.class ?? ``}` }}
  open_icon="Cross"
  closed_icon="Graph"
  {...rest}
>
  <h4 style="margin-top: 0">Velocity Autocorrelation &amp; Vibrational DOS</h4>

  {#if !trajectory}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    {#if setup_error}
      <StatusMessage type="error" message={setup_error} style="font-size: 0.8em" />
    {:else if is_lazy}
      <StatusMessage
        type="warning"
        message="Indexed trajectory: {loaded_frames} of {total_frames} frames are in memory. VACF streams the full payload{raw_data
          ? ``
          : `, but the raw file bytes are unavailable here`}."
        style="font-size: 0.8em"
      />
    {/if}

    <div class="vacf-controls">
      <label>
        Max lag
        <input type="number" min="0.05" max="1" step="0.05" bind:value={max_lag_fraction} />
        <span>× length</span>
      </label>
      <label>
        Frame stride
        <input type="number" min="1" step="1" bind:value={frame_stride} />
        {#if suggested_stride && suggested_stride > safe_stride}
          <span class="hint">needs ≥ {suggested_stride}</span>
        {/if}
      </label>
      <label>
        Window
        <select bind:value={window_type}>
          {#each WINDOW_TYPES as choice (choice)}<option value={choice}>{choice}</option
            >{/each}
        </select>
        <span class="hint">applied to the VACF before transforming</span>
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
      <label>
        Frequency axis
        <select bind:value={frequency_unit} disabled={effective_frequency_unit === `1/frame`}>
          {#each VACF_FREQUENCY_UNITS.filter((unit) => unit !== `1/frame`) as unit (unit)}
            <option value={unit}>{unit}</option>
          {/each}
        </select>
        <span class="hint">{effective_frequency_unit}</span>
      </label>
      <label>
        Show
        <select bind:value={panel}>
          {#each [`both`, `vacf`, `vdos`] as choice (choice)}
            <option value={choice}>{choice}</option>
          {/each}
        </select>
      </label>
      <p class="hint">
        {collected_frames} frames × {n_atoms} atoms ≈ {format_bytes(estimated_bytes)}
        {#if use_dt && TIME_UNIT_TO_THZ[time_unit] !== undefined}
          · {format_num(dt_collected, `.4~g`)} {time_unit} per collected frame
        {:else if use_dt}
          · {time_unit} is not one of {Object.keys(TIME_UNIT_TO_THZ).join(`, `)}, so the VDOS
          axis stays in inverse frames
        {:else}
          · no timestep is recorded in the file, so the lag axis is in frames and the VDOS axis
          in inverse frames
        {/if}
      </p>
      <button onclick={collect} disabled={collecting || plotting}>
        {collecting ? `Reading frames…` : input ? `Recollect velocities` : `Compute VACF`}
      </button>
      {#if progress}<span class="hint">{progress.stage}</span>{/if}
    </div>

    <!-- Rendered unconditionally so VacfPlot stays the single owner of the message area:
    collect errors land in the same slot as compute errors and the empty state -->
    <VacfPlot
      {input}
      {vacf_options}
      {panel}
      bind:result
      bind:loading={plotting}
      bind:error_msg
    />
  {/if}
</DraggablePane>

<style>
  .vacf-controls {
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
