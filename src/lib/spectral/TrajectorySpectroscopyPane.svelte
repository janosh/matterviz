<script lang="ts">
  import { Spinner, StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import { info_pane_icon, ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import type { ParseProgress, TrajectoryRun } from '$lib/trajectory'
  import {
    DEFAULT_POSITION_STREAM_MAX_BYTES,
    suggest_frame_stride,
  } from '$lib/trajectory/runs/accumulate'
  import { to_error } from '$lib/utils'
  import { Graph } from 'svelte-widgets/icons'
  import {
    collect_trajectory_spectroscopy_input,
    INFRARED_SIGNAL_KEYS,
    infrared_kind_from_key,
    RAMAN_SIGNAL_KEYS,
    spectroscopy_stream_channels,
    trajectory_signal_keys,
  } from './spectroscopy-collect'
  import { compute_trajectory_spectroscopy_async } from './trajectory-spectroscopy-async.svelte'
  import type {
    SpectroscopyPreprocessing,
    TrajectorySpectroscopyInput,
    TrajectorySpectroscopyOptions,
    TrajectorySpectroscopyResult,
  } from './trajectory-spectroscopy'
  import TrajectorySpectrumPlot from './TrajectorySpectrumPlot.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    inline = false,
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: TrajectorySpectroscopyResult
    inline?: boolean
  } = $props()

  let infrared_key = $state(``)
  let infrared_kind = $state<`dipole` | `polarization` | `current`>(`dipole`)
  let polarization_branch_continuous = $state(false)
  let raman_key = $state(``)
  let preprocessing = $state<SpectroscopyPreprocessing>(`body_fixed`)
  let analysis_time_step = $state<number>()
  let analysis_time_unit = $state(`fs`)
  let calculation_phase = $state<`idle` | `collecting` | `computing`>(`idle`)
  let details_open = $state(false)
  let calculation_busy = $derived(calculation_phase !== `idle`)
  let calculation_label = $derived(
    calculation_phase === `collecting`
      ? `Collecting trajectory signals…`
      : calculation_phase === `computing`
        ? `Computing spectra…`
        : result
          ? `Recompute spectroscopy`
          : `Compute spectroscopy`,
  )
  let progress = $state<ParseProgress | null>(null)
  let error_msg = $state<string>()

  let infrared_keys = $derived(trajectory_signal_keys(run, [3]))
  let raman_keys = $derived(trajectory_signal_keys(run, [3, 3]))
  let has_physical_time = $derived(
    Boolean(analysis_time_step && analysis_time_step > 0 && analysis_time_unit.trim()),
  )
  // Positions plus the channels the collector will stream (site velocities, frame signals)
  // are budgeted like every other sweep: a run too large for the buffer is sub-sampled rather
  // than refused. The strided steps carry their own spacing, so the frequency axis stays
  // right; only the position Nyquist drops, which the peak table reports per mode.
  let frame_stride = $derived(
    run
      ? suggest_frame_stride(
          run.frame_count,
          run.preview.structure.sites.length,
          DEFAULT_POSITION_STREAM_MAX_BYTES,
          spectroscopy_stream_channels(run, {
            infrared_key: infrared_key || null,
            raman_key: raman_key || null,
          }),
        )
      : 1,
  )
  let options = $derived<TrajectorySpectroscopyOptions>({
    frequency_unit: has_physical_time ? `cm^-1` : `1/step`,
    preprocessing,
  })
  const settings_snapshot = () => ({
    infrared_key,
    infrared_kind,
    polarization_branch_continuous,
    raman_key,
    time_step: has_physical_time ? analysis_time_step : undefined,
    time_unit: has_physical_time ? analysis_time_unit.trim() : undefined,
    options: $state.snapshot(options),
  })
  let completed_settings = $state.raw<ReturnType<typeof settings_snapshot> | undefined>(
    undefined,
  )
  const settings_key = (settings: ReturnType<typeof settings_snapshot>): string =>
    JSON.stringify(settings)
  let current_settings_key = $derived(settings_key(settings_snapshot()))
  let settings_dirty = $derived(
    Boolean(
      result &&
      completed_settings &&
      settings_key(completed_settings) !== current_settings_key,
    ),
  )

  let previous_run: TrajectoryRun | undefined
  let auto_calculation_owner: TrajectoryRun | undefined
  // Aborts the in-flight collect AND compute of the superseded request; a request whose
  // signal is aborted is exactly one whose result nobody will read
  let request_controller: AbortController | undefined
  $effect(() => {
    if (run === previous_run) return
    previous_run = run
    request_controller?.abort()
    result = undefined
    auto_calculation_owner = undefined
    error_msg = undefined
    completed_settings = undefined
    calculation_phase = `idle`
    progress = null
    details_open = false
    const default_ir = INFRARED_SIGNAL_KEYS.find((key) => infrared_keys.includes(key)) ?? ``
    infrared_key = default_ir
    infrared_kind = default_ir ? infrared_kind_from_key(default_ir) : `dipole`
    polarization_branch_continuous = false
    raman_key = RAMAN_SIGNAL_KEYS.find((key) => raman_keys.includes(key)) ?? ``
    analysis_time_step = run?.time_step?.value
    analysis_time_unit = run?.time_step?.unit ?? `fs`
    const first_structure = run?.preview.structure
    preprocessing =
      first_structure &&
      `lattice` in first_structure &&
      first_structure.lattice.pbc.some(Boolean)
        ? `remove_com`
        : `body_fixed`
  })

  $effect(() => {
    infrared_kind = infrared_key ? infrared_kind_from_key(infrared_key) : `dipole`
    polarization_branch_continuous = false
  })

  async function calculate(): Promise<void> {
    if (!run) return
    const request_run = run
    const request_settings = settings_snapshot()
    request_controller?.abort()
    const controller = new AbortController()
    request_controller = controller
    const request_is_current = () => !controller.signal.aborted
    calculation_phase = `collecting`
    error_msg = undefined
    progress = null
    try {
      const collected_input = await collect_trajectory_spectroscopy_input(request_run, {
        frame_stride,
        infrared_key: request_settings.infrared_key || null,
        infrared_kind: request_settings.infrared_kind,
        polarization_branch_continuous: request_settings.polarization_branch_continuous,
        raman_key: request_settings.raman_key || null,
        preprocessing: request_settings.options.preprocessing,
        signal: controller.signal,
        on_progress: (next_progress) => {
          if (request_is_current()) progress = next_progress
        },
      })
      if (!request_is_current()) return
      const calculation_input: TrajectorySpectroscopyInput = {
        ...collected_input,
        time_step: request_settings.time_step,
        time_unit: request_settings.time_unit,
      }
      calculation_phase = `computing`
      const calculation_result = await compute_trajectory_spectroscopy_async(
        calculation_input,
        request_settings.options,
        { signal: controller.signal },
      )
      if (request_is_current()) {
        result = calculation_result
        completed_settings = request_settings
      }
    } catch (error) {
      if (request_is_current()) {
        result = undefined
        error_msg = to_error(error).message
      }
    } finally {
      if (request_controller === controller) request_controller = undefined
      if (request_is_current()) {
        calculation_phase = `idle`
        progress = null
      }
    }
  }

  // Unmount: abort this pane's request, then release the worker (the client pre-warms a
  // replacement after every abort, which nothing would use once the pane is gone). Not
  // `cancel()`: the client is shared, so another mounted pane's request must survive.
  $effect(() => () => {
    request_controller?.abort()
    compute_trajectory_spectroscopy_async.release()
  })

  // The inline trajectory analysis is ready on first entry. Remember attempted owners so
  // invalid data reports once instead of retrying after the handled error clears busy state.
  $effect(() => {
    if (
      !inline ||
      !pane_open ||
      !run ||
      result ||
      calculation_busy ||
      auto_calculation_owner === run
    ) {
      return
    }
    auto_calculation_owner = run
    void calculate()
  })
</script>

{#snippet settings_content()}
  <h4 style="margin-top: 0">Spectroscopy analysis settings</h4>
  {#if !run}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    <fieldset class="spectroscopy-controls" disabled={calculation_busy}>
      <label
        >IR response
        <select bind:value={infrared_key}>
          <option value="">none</option>
          {#each infrared_keys as key (key)}<option value={key}>{key}</option>{/each}
        </select>
      </label>
      {#if infrared_key}
        <label
          >IR signal type
          <select bind:value={infrared_kind}>
            <option value="dipole">dipole</option><option value="polarization"
              >polarization</option
            ><option value="current">current</option>
          </select>
        </label>
      {/if}
      {#if infrared_kind === `polarization` && infrared_key}
        <label
          ><input type="checkbox" bind:checked={polarization_branch_continuous} /> Branch-continuous
          polarization</label
        >
      {/if}
      <label
        >Raman tensor
        <select bind:value={raman_key}>
          <option value="">none</option>
          {#each raman_keys as key (key)}<option value={key}>{key}</option>{/each}
        </select>
      </label>
      <label
        >Preprocessing
        <select bind:value={preprocessing}
          ><option value="body_fixed">molecular body frame</option><option value="remove_com"
            >remove COM drift</option
          ><option value="raw">raw laboratory frame</option></select
        >
      </label>
      <label
        >Timestep <span class="compact-inputs"
          ><input
            aria-label="Simulation timestep"
            type="number"
            min="0"
            step="any"
            bind:value={analysis_time_step}
          /><input aria-label="Simulation time unit" bind:value={analysis_time_unit} /></span
        ></label
      >
    </fieldset>
    <p class="provenance">
      {run.frame_count} total frames{frame_stride > 1
        ? ` · positions sampled 1 in ${frame_stride} to fit the memory budget`
        : ``} · timestep {has_physical_time
        ? `${format_num(analysis_time_step ?? 0, `.5~g`)} ${analysis_time_unit}`
        : `not recorded`} · raw spectra remain unsmoothed and independently normalized only for display
    </p>
    <button onclick={calculate} disabled={calculation_busy}>{calculation_label}</button>
    {#if progress}<span class="progress">{progress.stage}</span>{/if}
    {#if error_msg}<StatusMessage type="error" message={error_msg} />{/if}
  {/if}
{/snippet}

{#snippet details_content()}
  <h4 style="margin-top: 0">Spectroscopy details</h4>
  <p>
    VDOS is derived from atomic velocities; IR spectra use the selected dipole, polarization,
    or current signal.
  </p>
  <p>Choose preprocessing and response channels in the plot controls, then recompute.</p>
{/snippet}

{#snippet header_controls()}
  <ViewerPane
    bind:open={details_open}
    pane_name="spectroscopy details"
    class_prefix="spectroscopy-details"
    closed_icon={info_pane_icon}
    max_width="min(32em, 90cqw)"
    toggle_props={{ 'aria-label': `Spectroscopy details` }}
    pane_props={{ style: `--pane-z-index: 21` }}
  >
    {@render details_content()}
  </ViewerPane>
{/snippet}

{#snippet result_content()}
  {#if result}
    {#if settings_dirty}
      <StatusMessage
        type="warning"
        message="Spectroscopy settings changed. Recompute to update the displayed result."
        class="settings-dirty"
      />
    {/if}
    <TrajectorySpectrumPlot
      {result}
      controls_extra={inline ? settings_content : undefined}
      {header_controls}
      show_summary={false}
      style="height: 100%; min-height: 0"
    />
  {:else if error_msg}
    <StatusMessage type="error" message={error_msg} />
  {:else if run && calculation_busy}
    <div class="analysis-status">
      <Spinner text={calculation_label} style="--spinner-margin: 0" />
    </div>
  {/if}
{/snippet}

{#if inline}
  <section
    class="trajectory-spectroscopy-inline"
    hidden={!pane_open}
    aria-label="Trajectory IR, Raman, and vibrational DOS analysis"
  >
    {@render result_content()}
  </section>
{:else}
  <ViewerPane
    bind:open={pane_open}
    pane_name="trajectory IR, Raman, and vibrational DOS"
    class_prefix="trajectory-spectroscopy"
    max_width="min(96vw, 78em)"
    closed_icon={Graph}
    {...pane_options}
  >
    {@render settings_content()}
    {@render result_content()}
  </ViewerPane>
{/if}

<style>
  .trajectory-spectroscopy-inline {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0.75rem 1ex 0;
    overflow: visible;
    container-type: inline-size;
    box-sizing: border-box;
    background: var(--plot-bg, var(--surface-bg));
    &[hidden] {
      display: none;
    }
  }
  .spectroscopy-controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18em), 1fr));
    gap: 0.65em 1.25em;
    font-size: 1em;
    margin: 0;
    padding: 0;
    min-width: 0;
    border: 0;
  }
  .spectroscopy-controls > label {
    display: grid;
    grid-template-columns: minmax(8.5em, max-content) minmax(7.5em, 1fr);
    align-items: center;
    gap: 0.65em;
  }
  .spectroscopy-controls > label:has(> input[type='checkbox']) {
    grid-template-columns: auto 1fr;
    justify-content: start;
  }
  .spectroscopy-controls > label > :is(select, input:not([type='checkbox']), span) {
    width: 100%;
    min-width: 0;
    max-width: none;
    font: inherit;
  }
  .compact-inputs {
    display: flex;
    align-items: center;
    gap: 0.35em;
  }
  .compact-inputs input {
    min-width: 0;
    width: 100%;
    font: inherit;
  }
  .provenance,
  .progress,
  .analysis-status {
    font-size: 0.9em;
    opacity: 0.75;
  }
  h4 {
    font-size: 1.05em;
  }
  button {
    font-size: 1em;
  }
  .analysis-status {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
  }
</style>
