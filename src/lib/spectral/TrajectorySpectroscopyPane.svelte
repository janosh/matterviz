<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { WINDOW_TYPES, type WindowType } from '$lib/fft'
  import { format_num } from '$lib/labels'
  import { ControlPane, ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import type { ParseProgress, TrajectoryType } from '$lib/trajectory'
  import { parse_frame_signal } from '$lib/trajectory/frame-reader'
  import { to_error } from '$lib/utils'
  import { Graph } from 'svelte-widgets/icons'
  import { SvelteSet } from 'svelte/reactivity'
  import { BUILTIN_VIBRATIONAL_REFERENCES } from './spectroscopy-reference'
  import type { FrequencyComparisonMode } from './spectroscopy-benchmark'
  import {
    collect_trajectory_spectroscopy_input,
    infrared_kind_from_key,
    type SpectroscopyCollectOptions,
  } from './spectroscopy-collect'
  import type { PhononModeData } from './types'
  import { create_trajectory_spectroscopy_async_runner } from './trajectory-spectroscopy-async.svelte'
  import type {
    RamanChannel,
    SpectroscopyPreprocessing,
    SpectroscopyVelocitySource,
    TrajectoryFrequencyUnit,
    TrajectorySpectroscopyInput,
    TrajectorySpectroscopyOptions,
    TrajectorySpectroscopyResult,
  } from './trajectory-spectroscopy'
  import TrajectorySpectroscopyExplorer from './TrajectorySpectroscopyExplorer.svelte'

  const response_keys = (
    value: TrajectoryType | undefined,
    expected_shape: number[],
  ): string[] => {
    if (!value) return []
    const shape_matches = (shape: number[] | null | undefined): boolean =>
      shape?.length === expected_shape.length &&
      shape.every((size, idx) => size === expected_shape[idx])
    const keys = new SvelteSet<string>()
    for (const [key, signal] of Object.entries(value.signals ?? {})) {
      if (shape_matches(signal.sample_shape)) keys.add(key)
    }
    const n_atoms = value.frames[0]?.structure.sites.length ?? 0
    for (const [key, metadata_value] of Object.entries(value.frames[0]?.metadata ?? {})) {
      if (shape_matches(parse_frame_signal(metadata_value, key, n_atoms)?.sample_shape)) {
        keys.add(key)
      }
    }
    return [...keys].toSorted()
  }

  let {
    trajectory,
    raw_data = null,
    pane_open = $bindable(false),
    result = $bindable(),
    mode_trajectory = $bindable(null),
    harmonic_modes,
    inline = false,
    ...pane_options
  }: ViewerPaneOptions & {
    trajectory?: TrajectoryType
    raw_data?: string | ArrayBuffer | null
    pane_open?: boolean
    result?: TrajectorySpectroscopyResult
    mode_trajectory?: TrajectoryType | null
    harmonic_modes?: PhononModeData
    inline?: boolean
  } = $props()

  let infrared_key = $state(``)
  let infrared_kind = $state<`dipole` | `polarization` | `current`>(`dipole`)
  let polarization_branch_continuous = $state(false)
  let raman_key = $state(``)
  let mass_source = $state<SpectroscopyCollectOptions[`mass_source`]>(`auto`)
  let preprocessing = $state<SpectroscopyPreprocessing>(`body_fixed`)
  let velocity_source = $state<SpectroscopyVelocitySource>(`auto`)
  let frequency_unit = $state<TrajectoryFrequencyUnit>(`cm^-1`)
  let window = $state<WindowType>(`hann`)
  let zero_pad_factor = $state(4)
  let peak_prominence = $state(0.02)
  let activity_relative_threshold = $state(0.01)
  let activity_snr = $state(6)
  let raman_channel = $state<RamanChannel>(`unpolarized`)
  let raman_geometry_kind = $state<`powder` | `polarized`>(`powder`)
  let incident_polarization = $state<[number, number, number]>([1, 0, 0])
  let scattered_polarization = $state<[number, number, number]>([1, 0, 0])
  let analysis_time_step = $state<number>()
  let analysis_time_unit = $state(`fs`)
  let reference_id = $state(``)
  let comparison = $state<FrequencyComparisonMode>(`absolute`)
  let scale_factor = $state(1)
  let frequency_range = $state<[number, number]>([0, 0])
  let settings_open = $state(false)
  let calculation_phase = $state<`idle` | `collecting` | `computing`>(`idle`)
  let calculation_busy = $derived(calculation_phase !== `idle`)
  let progress = $state<ParseProgress | null>(null)
  let error_msg = $state<string>()
  let completed_settings_key = $state<string>()

  const spectroscopy_runner = create_trajectory_spectroscopy_async_runner()

  let infrared_keys = $derived(response_keys(trajectory, [3]))
  let raman_keys = $derived(response_keys(trajectory, [3, 3]))
  let has_physical_time = $derived(
    Boolean(analysis_time_step && analysis_time_step > 0 && analysis_time_unit.trim()),
  )
  let reference = $derived(
    BUILTIN_VIBRATIONAL_REFERENCES.find(({ id }) => id === reference_id),
  )
  let options = $derived<TrajectorySpectroscopyOptions>({
    frequency_unit: has_physical_time ? frequency_unit : `1/frame`,
    preprocessing,
    velocity_source,
    window,
    zero_pad_factor,
    peak_prominence,
    activity_relative_threshold,
    activity_snr,
    raman_geometry:
      raman_geometry_kind === `polarized`
        ? {
            kind: `polarized`,
            incident: [...incident_polarization],
            scattered: [...scattered_polarization],
          }
        : {
            kind: `powder`,
            channel: raman_channel === `polarized` ? `unpolarized` : raman_channel,
          },
  })
  const settings_snapshot = () => ({
    raw_data,
    infrared_key,
    infrared_kind,
    polarization_branch_continuous,
    raman_key,
    mass_source,
    time_step: has_physical_time ? analysis_time_step : undefined,
    time_unit: has_physical_time ? analysis_time_unit.trim() : undefined,
    options: $state.snapshot(options),
  })
  const settings_key = (settings: ReturnType<typeof settings_snapshot>): string =>
    JSON.stringify({
      ...settings,
      raw_data: settings.raw_data === null ? null : typeof settings.raw_data,
    })
  let current_settings_key = $derived(settings_key(settings_snapshot()))
  let settings_dirty = $derived(
    Boolean(
      result && completed_settings_key && completed_settings_key !== current_settings_key,
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
    mode_trajectory = null
    auto_calculation_owner = undefined
    error_msg = undefined
    completed_settings_key = undefined
    calculation_phase = `idle`
    progress = null
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
    frequency_unit = trajectory?.time_step && trajectory.time_unit ? `cm^-1` : `1/frame`
    reference_id = ``
    comparison = `absolute`
    scale_factor = 1
    frequency_range = [0, 0]
    settings_open = false
  })

  $effect(() => {
    infrared_kind = infrared_key ? infrared_kind_from_key(infrared_key) : `dipole`
    polarization_branch_continuous = false
  })

  $effect(() => {
    if (raman_geometry_kind !== `polarized` && raman_channel === `polarized`) {
      raman_channel = `unpolarized`
    }
  })

  async function calculate(): Promise<void> {
    if (!trajectory) return
    const generation = ++request_generation
    const request_trajectory = trajectory
    const request_settings = settings_snapshot()
    const request_settings_key = settings_key(request_settings)
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
        mass_source: request_settings.mass_source,
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
      if (request_settings.options.raman_geometry?.kind === `polarized`) {
        raman_channel = `polarized`
      }
      const calculation_result = await spectroscopy_runner.compute(
        calculation_input,
        request_settings.options,
      )
      if (request_is_current()) {
        result = calculation_result
        completed_settings_key = request_settings_key
      }
    } catch (error) {
      if (request_is_current()) {
        result = undefined
        mode_trajectory = null
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
        >Masses
        <select bind:value={mass_source}
          ><option value="auto">recorded, else standard</option><option value="recorded"
            >recorded only</option
          ><option value="standard">standard isotope average</option></select
        >
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
        >Velocities
        <select bind:value={velocity_source}
          ><option value="auto">stored, else central difference</option><option value="stored"
            >stored only</option
          ><option value="central_difference">central difference</option></select
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
      <label
        >Frequency
        <select bind:value={frequency_unit} disabled={!has_physical_time}
          ><option value="cm^-1">cm<sup>−1</sup></option><option value="THz">THz</option
          ><option value="1/frame">1/frame</option></select
        >
      </label>
      <label
        >Window
        <select bind:value={window}
          >{#each WINDOW_TYPES as choice (choice)}<option value={choice}>{choice}</option
            >{/each}</select
        >
      </label>
      <label
        >Zero padding <input
          type="number"
          min="1"
          step="1"
          bind:value={zero_pad_factor}
        /></label
      >
      <label
        >Peak prominence <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          bind:value={peak_prominence}
        /></label
      >
      <label
        >Activity floor <input
          type="number"
          min="0"
          max="1"
          step="0.005"
          bind:value={activity_relative_threshold}
        /></label
      >
      <label
        >Activity MAD <input type="number" min="0" step="1" bind:value={activity_snr} /></label
      >
      <label
        >Raman geometry
        <select bind:value={raman_geometry_kind}
          ><option value="powder">powder average</option><option value="polarized"
            >polarized vectors</option
          ></select
        >
      </label>
      {#if raman_geometry_kind === `polarized`}
        <label
          >Incident polarization <span class="vector-inputs"
            >{#each [0, 1, 2] as axis (axis)}<input
                aria-label={`Incident polarization ${axis}`}
                type="number"
                step="any"
                bind:value={incident_polarization[axis]}
              />{/each}</span
          ></label
        >
        <label
          >Scattered polarization <span class="vector-inputs"
            >{#each [0, 1, 2] as axis (axis)}<input
                aria-label={`Scattered polarization ${axis}`}
                type="number"
                step="any"
                bind:value={scattered_polarization[axis]}
              />{/each}</span
          ></label
        >
      {/if}
      <label
        >Raman view
        <select bind:value={raman_channel}
          ><option value="unpolarized">unpolarized</option><option value="vv">VV</option
          ><option value="vh">VH</option><option value="isotropic">isotropic</option><option
            value="anisotropic">anisotropic</option
          >{#if raman_geometry_kind === `polarized`}<option value="polarized">polarized</option
            >{/if}</select
        >
      </label>
      <label
        >Reference catalog
        <select bind:value={reference_id}>
          <option value="">none</option>
          {#each BUILTIN_VIBRATIONAL_REFERENCES as entry (entry.id)}<option value={entry.id}
              >{entry.formula} · {entry.isotopologue} · {entry.phase}</option
            >{/each}
        </select>
      </label>
      {#if result && reference}
        <label
          >Comparison
          <select bind:value={comparison}>
            <option value="absolute">raw absolute</option>
            <option value="spacing">shift-independent spacing</option>
            <option value="scaled">explicitly scaled</option>
          </select>
        </label>
        {#if comparison === `scaled`}
          <label
            >Scale <input
              type="number"
              min="0.01"
              step="0.001"
              bind:value={scale_factor}
            /></label
          >
        {/if}
      {/if}
      {#if result}
        <label
          >Frequency range
          <span class="compact-inputs"
            ><input type="number" bind:value={frequency_range[0]} />–<input
              type="number"
              bind:value={frequency_range[1]}
            />
            {result.frequency_unit}</span
          >
        </label>
      {/if}
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

{#snippet result_content()}
  {#if result}
    {#if settings_dirty}
      <StatusMessage
        type="warning"
        message="Spectroscopy settings changed. Recompute to update the displayed result."
        class="settings-dirty"
      />
    {/if}
    <TrajectorySpectroscopyExplorer
      {result}
      {reference}
      {harmonic_modes}
      show_controls={false}
      bind:mode_trajectory
      bind:raman_channel
      bind:comparison
      bind:scale_factor
      bind:frequency_range
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
    <div class="spectroscopy-analysis-surface">
      <ControlPane
        bind:controls_open={settings_open}
        controls_name="spectroscopy-analysis"
        toggle_title="spectroscopy analysis"
        toggle_props={{ 'aria-label': `Spectroscopy analysis settings` }}
        max_width="min(64em, 94cqw)"
        toggle_style="position: absolute; top: 4pt; right: 0.65em; z-index: 20; width: 1.8em; height: 1.8em; padding: 0.14em; font-size: 1.2em"
        pane_style="--pane-width: min(64em, 94cqw); --pane-padding: 16px; --pane-gap: 8px; max-height: calc(100% - 2ex); overflow: auto; z-index: 21"
      >
        {@render settings_content()}
      </ControlPane>
      {@render result_content()}
    </div>
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
    overflow: hidden;
    container-type: inline-size;
    box-sizing: border-box;
    background: var(--plot-bg, var(--surface-bg));
    &[hidden] {
      display: none;
    }
  }
  .spectroscopy-analysis-surface {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
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
  .compact-inputs,
  .vector-inputs {
    display: flex;
    align-items: center;
    gap: 0.35em;
  }
  .compact-inputs input,
  .vector-inputs input {
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
