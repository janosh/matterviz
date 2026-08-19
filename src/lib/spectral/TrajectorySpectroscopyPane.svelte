<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import { info_pane_icon, ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
  import { to_error } from '$lib/utils'
  import { Graph } from 'svelte-widgets/icons'
  import {
    collect_trajectory_spectroscopy_input,
    infrared_kind_from_key,
    trajectory_signal_keys,
  } from './spectroscopy-collect'
  import { create_trajectory_spectroscopy_async_runner } from './trajectory-spectroscopy-async.svelte'
  import type {
    SpectroscopyPreprocessing,
    TrajectorySpectroscopyInput,
    TrajectorySpectroscopyOptions,
    TrajectorySpectroscopyResult,
  } from './trajectory-spectroscopy'
  import TrajectorySpectrumPlot from './TrajectorySpectrumPlot.svelte'

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    inline = false,
    ...pane_options
  }: ViewerPaneOptions & {
    trajectory?: TrajectoryType
    raw_data?: string | ArrayBuffer | null
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
  let progress = $state<ParseProgress | null>(null)
  let error_msg = $state<string>()

  const spectroscopy_runner = create_trajectory_spectroscopy_async_runner()

  let infrared_keys = $derived(trajectory_signal_keys(trajectory, [3]))
  let raman_keys = $derived(trajectory_signal_keys(trajectory, [3, 3]))
  let has_physical_time = $derived(
    Boolean(analysis_time_step && analysis_time_step > 0 && analysis_time_unit.trim()),
  )
  let options = $derived<TrajectorySpectroscopyOptions>({
    frequency_unit: has_physical_time ? `cm^-1` : `1/frame`,
    preprocessing,
    // Raman requires an explicit geometry for periodic trajectories. Powder averaging is the
    // only geometry the enclosing trajectory viewer can meaningfully configure.
    raman_geometry: { kind: `powder` },
  })
  const settings_snapshot = () => ({
    raw_data,
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
  const settings_key = ({
    raw_data: _raw_data,
    ...settings
  }: ReturnType<typeof settings_snapshot>): string => JSON.stringify(settings)
  let current_settings_key = $derived(settings_key(settings_snapshot()))
  let settings_dirty = $derived(
    Boolean(
      result &&
      completed_settings &&
      (settings_key(completed_settings) !== current_settings_key ||
        completed_settings.raw_data !== raw_data),
    ),
  )

  let previous_trajectory: TrajectoryType | undefined
  let auto_calculation_owner: TrajectoryType | undefined
  let request_generation = 0
  $effect(() => {
    if (trajectory === previous_trajectory) return
    previous_trajectory = trajectory
    request_generation++
    spectroscopy_runner.cancel(`Trajectory spectroscopy superseded by a new trajectory`)
    result = undefined
    auto_calculation_owner = undefined
    error_msg = undefined
    completed_settings = undefined
    calculation_phase = `idle`
    progress = null
    details_open = false
    const default_ir =
      [`dipole`, `polarization`, `current`].find((key) => infrared_keys.includes(key)) ?? ``
    infrared_key = default_ir
    infrared_kind = default_ir ? infrared_kind_from_key(default_ir) : `dipole`
    polarization_branch_continuous = false
    raman_key = raman_keys.includes(`polarizability`) ? `polarizability` : ``
    analysis_time_step = trajectory?.time_step
    analysis_time_unit = trajectory?.time_unit ?? `fs`
    const first_structure = trajectory?.frames[0]?.structure
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
    if (!trajectory) return
    const generation = ++request_generation
    const request_trajectory = trajectory
    const request_settings = settings_snapshot()
    const request_is_current = () => generation === request_generation
    spectroscopy_runner.cancel(`Trajectory spectroscopy superseded by a newer request`)
    calculation_phase = `collecting`
    error_msg = undefined
    progress = null
    try {
      const collected_input = await collect_trajectory_spectroscopy_input(request_trajectory, {
        raw_data: request_settings.raw_data,
        infrared_key: request_settings.infrared_key || null,
        infrared_kind: request_settings.infrared_kind,
        polarization_branch_continuous: request_settings.polarization_branch_continuous,
        raman_key: request_settings.raman_key || null,
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
      const calculation_result = await spectroscopy_runner.compute(
        calculation_input,
        request_settings.options,
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
      if (request_is_current()) {
        calculation_phase = `idle`
        progress = null
      }
    }
  }

  $effect(() => () => spectroscopy_runner.cancel(`Trajectory spectroscopy pane closed`))

  // The inline trajectory analysis is ready on first entry. Remember attempted owners so
  // invalid data reports once instead of retrying after the handled error clears busy state.
  $effect(() => {
    if (
      !inline ||
      !pane_open ||
      !trajectory ||
      result ||
      calculation_busy ||
      auto_calculation_owner === trajectory
    ) {
      return
    }
    auto_calculation_owner = trajectory
    void calculate()
  })
</script>

{#snippet settings_content()}
  <h4 style="margin-top: 0">Spectroscopy analysis settings</h4>
  {#if !trajectory}
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
      {trajectory.frames.length} loaded frames · timestep {has_physical_time
        ? `${format_num(analysis_time_step ?? 0, `.5~g`)} ${analysis_time_unit}`
        : `not recorded`} · raw spectra remain unsmoothed and independently normalized only for display
    </p>
    <button onclick={calculate} disabled={calculation_busy}>
      {calculation_phase === `collecting`
        ? `Collecting trajectory signals…`
        : calculation_phase === `computing`
          ? `Computing spectra…`
          : result
            ? `Recompute spectroscopy`
            : `Compute spectroscopy`}
    </button>
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
  {:else if trajectory && calculation_busy}
    <p class="analysis-status">
      {calculation_phase === `collecting`
        ? `Collecting trajectory signals…`
        : `Computing spectra…`}
    </p>
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
    padding: var(--viewer-buttons-top, 1ex) 1ex 0;
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
    place-self: center;
  }
</style>
