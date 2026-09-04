<script lang="ts" generics="Input">
  // Chrome shared by every whole-trajectory analysis pane (MSD, VACF, structure-id, ...):
  // the ViewerPane shell, indexed-trajectory warnings, frame-stride and timestep controls, the
  // size estimate, the collect button with progress, and the stale-state bookkeeping each pane
  // used to copy. The module supplies the collector, its own option controls and the plot.
  //
  // Contract: `collect` gathers `Input` from the run (progress via `on_progress`); the
  // pane stores it in the bindable `input` and the module's `children` snippet turns it into a
  // plot. Whenever the pane drops its input (trajectory swapped, collect failed) it also calls
  // `on_clear` so the module drops its result — otherwise stale curves hide the new message.
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import { ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import type { ParseProgress, TrajectoryRun } from '$lib/trajectory'
  import type { AnalysisCollectOptions, AnalysisPaneContext } from '$lib/trajectory/analysis'
  import { analysis_pane_setup, no_full_pass_message } from '$lib/trajectory/analysis'
  import { format_bytes, to_error } from '$lib/utils'
  import { type Snippet, untrack } from 'svelte'
  import { Graph, type IconData } from 'svelte-widgets/icons'

  let {
    run,
    pane_open = $bindable(false),
    input = $bindable(),
    error_msg = $bindable(),
    busy = false,
    title,
    pane_name,
    class_prefix,
    icon = Graph,
    analysis_name,
    collect,
    unavailable_reason = null,
    suggest_stride,
    compute_label,
    recollect_label,
    collecting_label = `Reading frames…`,
    bytes_per_atom_frame = 24,
    default_dt = null,
    default_time_unit,
    time_unit_fallback,
    on_clear,
    controls,
    hint,
    children,
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    // What `collect` last produced; cleared on trajectory swap and on a failed collect
    input?: Input
    // Collect failures land here; the module's plot binds it too so compute errors share the slot
    error_msg?: string
    // Disables the collect button while the module's downstream compute is still running
    busy?: boolean
    title: string
    pane_name: string
    class_prefix: string
    icon?: IconData
    // Short name for the indexed-trajectory warning, e.g. `MSD`
    analysis_name: string
    collect: (run: TrajectoryRun, options: AnalysisCollectOptions) => Promise<Input>
    // Visible explanation for a disabled compute button.
    unavailable_reason?: string | null
    // Stride that keeps the collected buffer inside the memory budget. Supplying it also
    // renders the frame-stride control; panes that read frames one at a time omit it.
    suggest_stride?: (run: TrajectoryRun) => number | null
    compute_label: string
    recollect_label: string
    // Button text while `collect` runs
    collecting_label?: string
    // Size of one atom-frame in the collected buffer for the estimate line (3 × f64 = 24)
    bytes_per_atom_frame?: number
    // Time between two SOURCE frames as recorded in the file, seeded into the timestep
    // controls (which only render when `time_unit_fallback` is given) and re-seeded on swap
    default_dt?: number | null
    default_time_unit?: string
    time_unit_fallback?: string
    on_clear?: () => void
    // Module-specific option controls, rendered before the shared ones
    controls?: Snippet<[AnalysisPaneContext<Input>]>
    // Extra text appended to the size-estimate hint line
    hint?: Snippet<[AnalysisPaneContext<Input>]>
    // The plot; rendered unconditionally so it owns the message area for both collect and
    // compute errors and the empty state
    children: Snippet<[AnalysisPaneContext<Input>]>
  } = $props()

  const pane_id = $props.id()
  const unavailable_hint_id = `${pane_id}-unavailable`

  // Control-panel state. dt_source is the time between two SOURCE frames; collecting every
  // Nth frame multiplies it (see dt_collected below). null, not 0, is what
  // <input type="number"> writes back when cleared.
  let dt_source = $state<number | null>(1)
  // Seeded by the effect below whenever timestep controls are enabled
  let time_unit = $state(``)
  let use_dt = $state(false)
  let frame_stride = $state<number | null>(1)
  // Stride the current `input` was collected with. The typed stride can change after a
  // collect without triggering a new one, and the analyses take the time per COLLECTED frame,
  // so dt has to follow the stride that produced the buffer, not the one in the box.
  let collected_stride = $state<number | null>(null)
  let collecting = $state(false)
  let progress = $state<ParseProgress | null>(null)

  let { total_frames, n_atoms, safe_stride, collected_frames, suggested_stride, can_collect } =
    $derived(analysis_pane_setup(run, suggest_stride, frame_stride))
  let estimated_bytes = $derived(collected_frames * n_atoms * bytes_per_atom_frame)

  const clear = () => {
    input = undefined
    collected_stride = null
    error_msg = undefined
    on_clear?.()
  }

  // Drop stale input whenever the underlying run is swapped out, and re-seed the
  // timestep from the file rather than carrying the previous one over. Seeding also keys on
  // the defaults so metadata that only becomes known later still lands. Mount is not a swap:
  // an `input` the caller supplied alongside the trajectory must survive it (seeding still
  // runs on mount because `seeded_dt` starts out undefined).
  let analysed_run = untrack(() => run)
  let seeded_dt: number | null | undefined
  let seeded_time_unit: string | undefined
  $effect(() => {
    const run_changed = run !== analysed_run
    if (run_changed) {
      analysed_run = run
      clear()
      // a collect still running for the old trajectory may no longer report here
      progress = null
      abort_collect()
    }
    if (
      time_unit_fallback &&
      (run_changed || default_dt !== seeded_dt || default_time_unit !== seeded_time_unit)
    ) {
      seeded_dt = default_dt
      seeded_time_unit = default_time_unit
      const has_default_timestep =
        default_dt !== null &&
        Number.isFinite(default_dt) &&
        default_dt > 0 &&
        Boolean(default_time_unit)
      dt_source = has_default_timestep ? default_dt : 1
      time_unit = (has_default_timestep && default_time_unit) || time_unit_fallback
      use_dt = has_default_timestep
    }
  })

  // Analyses take the time per COLLECTED frame, so striding has to be folded in here:
  // entering the real MD timestep with stride 5 would otherwise report D five times too large
  // (MSD) or put every VDOS peak at five times its frequency, with correct-looking units.
  // Before a collect (or for an input the caller supplied) the typed stride is the best guess.
  let dt_collected = $derived((dt_source ?? 1) * (collected_stride ?? safe_stride))
  let has_valid_dt = $derived(
    use_dt &&
      dt_source !== null &&
      Number.isFinite(dt_source) &&
      dt_source > 0 &&
      time_unit.length > 0,
  )
  // Getters rather than one $derived object: a single object would change identity on every
  // field (a stride keystroke, a progress tick), re-running every snippet expression that
  // touched any of it and with it the module's compute on identical options.
  const context: AnalysisPaneContext<Input> = {
    get input() {
      return input
    },
    get has_valid_dt() {
      return has_valid_dt
    },
    get dt_collected() {
      return dt_collected
    },
    get time_unit() {
      return time_unit
    },
    get collected_frames() {
      return collected_frames
    },
    get n_atoms() {
      return n_atoms
    },
    get collecting() {
      return collecting
    },
  }

  // A sweep outlives a trajectory swap; its result belongs to the run that is no longer on
  // screen, so only the request for the current trajectory may write back. A newer request
  // on the same trajectory likewise supersedes an older one.
  let request_id = 0
  // Aborted whenever a collect's answer can no longer be used, so a collector that honours
  // the signal stops reading frames (and posting worker jobs) instead of running to the end
  let collect_controller: AbortController | undefined
  const abort_collect = (): void => {
    collect_controller?.abort()
    collect_controller = undefined
  }
  // Unmount: invalidate first so the abort rejection is not reported as a collect error
  $effect(() => () => {
    request_id++
    abort_collect()
  })
  async function run_collect() {
    if (!run || unavailable_reason) return
    const requested = run
    const this_request = ++request_id
    const is_current = () => run === requested && this_request === request_id
    abort_collect()
    const controller = new AbortController()
    collect_controller = controller
    collecting = true
    error_msg = undefined
    progress = null
    const requested_stride = safe_stride
    try {
      const collected = await collect(requested, {
        frame_stride: requested_stride,
        signal: controller.signal,
        on_progress: (parse_progress) => {
          if (is_current()) progress = parse_progress
        },
      })
      if (is_current()) {
        input = collected
        collected_stride = requested_stride
      }
    } catch (exc) {
      if (!is_current()) return
      clear()
      error_msg = to_error(exc).message
    } finally {
      if (collect_controller === controller) collect_controller = undefined
      // the button must re-enable even when the answer was discarded
      if (this_request === request_id) {
        collecting = false
        progress = null
      }
    }
  }
</script>

<ViewerPane
  bind:open={pane_open}
  {pane_name}
  {class_prefix}
  max_width="34em"
  closed_icon={icon}
  {...pane_options}
>
  <h4 style="margin-top: 0">{title}</h4>

  {#if !run}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    {#if unavailable_reason}
      <small id={unavailable_hint_id}>{unavailable_reason}</small>
    {:else if suggest_stride && !can_collect && run}
      <StatusMessage
        type="warning"
        message={no_full_pass_message(run, analysis_name)}
        style="font-size: 0.8em"
      />
    {/if}

    <div class="analysis-controls {class_prefix}-controls">
      {@render controls?.(context)}
      {#if suggest_stride}
        <label>
          Frame stride
          <input type="number" min="1" step="1" bind:value={frame_stride} />
          {#if suggested_stride && suggested_stride > safe_stride}
            <span class="hint">needs ≥ {suggested_stride}</span>
          {/if}
        </label>
      {/if}
      {#if time_unit_fallback}
        <label>
          <input type="checkbox" bind:checked={use_dt} />
          Time per source frame
          <input
            type="number"
            min="0"
            step="0.001"
            bind:value={dt_source}
            disabled={!use_dt}
          />
          <input
            type="text"
            bind:value={time_unit}
            disabled={!use_dt}
            style="width: 4em"
            aria-label="Time unit"
          />
        </label>
      {/if}
      {#if suggest_stride || time_unit_fallback || hint}
        <p class="hint">
          {#if suggest_stride}
            {collected_frames} frames × {n_atoms} atoms ≈ {format_bytes(estimated_bytes)}
          {/if}
          {#if time_unit_fallback}
            {#if has_valid_dt}
              · {format_num(dt_collected, `.4~g`)} {time_unit} per collected frame
            {:else}
              · no valid timestep is available: lag axis in frames
            {/if}
          {/if}
          {@render hint?.(context)}
        </p>
      {/if}
      <button
        onclick={run_collect}
        disabled={collecting ||
          busy ||
          Boolean(unavailable_reason) ||
          (suggest_stride && !can_collect)}
        title={unavailable_reason ?? undefined}
        aria-describedby={unavailable_reason ? unavailable_hint_id : undefined}
      >
        {collecting ? collecting_label : input ? recollect_label : compute_label}
      </button>
      {#if progress}<span class="hint">{progress.stage}</span>{/if}
    </div>

    {@render children(context)}
  {/if}
</ViewerPane>

<style>
  /* descendants are :global because the controls / hint snippets render inside this div
     from the analysis panes' own component scopes */
  .analysis-controls {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    font-size: 0.85em;
    :global(label) {
      display: flex;
      align-items: center;
      gap: 4pt;
    }
    :global(input:is([type='number'], [type='text'])) {
      width: 5em;
      text-align: center;
    }
    :global(button) {
      align-self: flex-start;
      padding: 2pt 8pt;
    }
    :global(.hint) {
      opacity: 0.7;
      font-size: 0.9em;
      margin: 0;
    }
  }
</style>
