<script lang="ts">
  import { untrack } from 'svelte'
  import { ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import { StatusMessage } from 'svelte-widgets'
  import { Graph } from 'svelte-widgets/icons'
  import type { TrajectoryRun } from './run'
  import { create_request_owner } from './async-result.svelte'
  import {
    ENERGY_UNITS,
    VELOCITY_UNITS,
    type HotspotMetric,
    type HotspotOptions,
    type HotspotResult,
  } from './hotspots'
  import HotspotSlice from './HotspotSlice.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    metric = $bindable(`energy`),
    min_atoms = $bindable(10),
    threshold = $bindable(1.25),
    ...pane_props
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: HotspotResult
    metric?: HotspotMetric
    min_atoms?: number
    threshold?: number
  } = $props()
  let start_frame = $state(0)
  let end_frame = $state(1)
  let frame_stride = $state(1)
  let bins = $state(0)
  let source = $state(`velocity`)
  let velocity_key = $state(`velocity`)
  let energy_key = $state(`kinetic_energy`)
  let energy_reference = $state(``)
  let velocity_unit = $state<keyof typeof VELOCITY_UNITS | ``>(``)
  let energy_unit = $state<keyof typeof ENERGY_UNITS | ``>(``)
  let mass_source = $state<`recorded` | `standard`>(`recorded`)
  let mass_unit = $state<`amu` | `kg` | ``>(``)
  let motion = $state<NonNullable<HotspotOptions[`motion`]>>(`device`)
  let coordinates = $state<NonNullable<HotspotOptions[`coordinates`]>>(`device`)
  let selection_key = $state(``)
  let dimensions = $state<2 | 3>(3)
  let dof_per_atom = $derived<number>(dimensions)
  let stored_dof_known = $state(false)
  let busy = $state(false)
  let settings_open = $state(true)
  let progress = $state(0)
  let error = $state(``)
  const requests = create_request_owner()
  const options = $derived<HotspotOptions>({
    start_frame,
    end_frame,
    frame_stride,
    ...(bins && { bins }),
    coordinates,
    motion: source === `energy` ? `device` : motion,
    ...(source === `energy`
      ? {
          energy_key: energy_key.trim(),
          energy_unit: energy_unit || undefined,
          energy_reference,
        }
      : {
          velocity_key: velocity_key.trim(),
          velocity_unit: velocity_unit || undefined,
          mass_source,
          mass_unit: mass_source === `standard` ? `amu` : mass_unit || undefined,
        }),
    selection_key: selection_key || undefined,
    dimensions,
    ...((source === `velocity` || stored_dof_known) && { dof_per_atom }),
  })
  const settings_key = $derived(JSON.stringify(options))
  const stale = $derived(Boolean(result && JSON.stringify(result.options) !== settings_key))
  $effect(() => {
    const next = run
    untrack(() => {
      requests.cancel()
      busy = false
      settings_open = true
      result = undefined
      error = ``
      start_frame = 0
      end_frame = next?.frame_count ?? 1
      source = `velocity`
      velocity_key = `velocity`
      energy_key = `kinetic_energy`
      energy_reference = ``
      selection_key = ``
      mass_source = `recorded`
      mass_unit = ``
      dimensions = 3
      dof_per_atom = 3
      stored_dof_known = false
      const unit = next?.signals?.velocity?.unit
      velocity_unit =
        unit && unit in VELOCITY_UNITS ? (unit as keyof typeof VELOCITY_UNITS) : ``
      energy_unit = ``
    })
  })
  $effect(() => () => requests.cancel())
  async function calculate(): Promise<void> {
    const active = run
    const compute = active?.compute_hotspots
    if (!compute) return
    const signal = requests.start()
    const snapshot = $state.snapshot(options)
    busy = true
    progress = 0
    error = ``
    try {
      const computed = await compute({
        ...snapshot,
        retained_bytes: result ? result.energy.length * 36 : 0,
        signal,
        on_progress: ({ current, total }) => {
          if (!signal.aborted) progress = current / total
        },
      })
      if (signal.aborted || active !== run) return
      result = computed
      settings_open = false
      if (!computed.dof.some((value) => value > 0)) metric = `energy`
    } catch (failure) {
      if (!signal.aborted && active === run)
        error = failure instanceof Error ? failure.message : String(failure)
    } finally {
      if (!signal.aborted && active === run) busy = false
    }
  }
</script>

<ViewerPane
  {...pane_props}
  closed_icon={Graph}
  pane_name="hotspots"
  class_prefix="hotspots"
  bind:open={pane_open}
>
  <h3>Thermal hotspots</h3>
  <details bind:open={settings_open}>
    <summary>Analysis settings</summary>
    <div class="hotspot-controls">
      <label
        >Source <select bind:value={source}
          ><option value="velocity">Velocities and masses</option><option value="energy"
            >Recorded kinetic energy</option
          ></select
        ></label
      >
      {#if source === `velocity`}
        <label>Velocity property <input bind:value={velocity_key} /></label>
        <label
          >Velocity units <select bind:value={velocity_unit}
            ><option value="">Select units</option
            >{#each Object.keys(VELOCITY_UNITS) as unit}<option value={unit}>{unit}</option
              >{/each}</select
          ></label
        >
        <label
          >Masses <select bind:value={mass_source}
            ><option value="recorded">Recorded</option><option value="standard"
              >Standard elemental masses (amu)</option
            ></select
          ></label
        >
        {#if mass_source === `recorded`}<label
            >Mass units <select bind:value={mass_unit}
              ><option value="">Select units</option><option value="amu">amu</option><option
                value="kg">kg</option
              ></select
            ></label
          >{/if}
        <label
          >Motion <select bind:value={motion}
            ><option value="device">Stationary device</option><option value="translation"
              >Selected in-grid population COM removed</option
            ><option value="local">Per-bin COM removed</option></select
          ></label
        >
      {:else}
        <label>Energy property <input bind:value={energy_key} /></label>
        <label
          >Stored energy reference <input
            placeholder="e.g. device frame, mobile-group COM removed"
            bind:value={energy_reference}
          /></label
        >
        <label
          >Energy units <select bind:value={energy_unit}
            ><option value="">Select units</option
            >{#each Object.keys(ENERGY_UNITS) as unit}<option value={unit}>{unit}</option
              >{/each}</select
          ></label
        >
      {/if}
      <label
        >Start frame (inclusive) <input
          type="number"
          min="0"
          max={(run?.frame_count ?? 1) - 1}
          bind:value={start_frame}
        /></label
      >
      <label
        >End frame (exclusive) <input
          type="number"
          min="1"
          max={run?.frame_count ?? 1}
          bind:value={end_frame}
        /></label
      >
      <label
        >Frame stride <input type="number" min="1" step="1" bind:value={frame_stride} /></label
      >
      <label
        >Grid resolution (0 = automatic) <input
          type="number"
          min="0"
          max="128"
          step="1"
          bind:value={bins}
        /></label
      >
      <label
        >Grid frame <select bind:value={coordinates}
          ><option value="device">Fixed device</option><option value="cell"
            >Follow simulation cell</option
          ></select
        ></label
      >
      <label
        >Mobile-atom selection property <input
          placeholder="Optional boolean / 0–1 property"
          bind:value={selection_key}
        /></label
      >
      <label
        >Dimensions <select bind:value={dimensions}
          ><option value={3}>3D</option><option value={2}>2D (x/y velocities)</option></select
        ></label
      >
      {#if source === `energy`}<label
          ><input type="checkbox" bind:checked={stored_dof_known} /> Specify post-reference DOF for
          Kelvin</label
        >{/if}
      {#if source === `velocity` || stored_dof_known}<label
          >Degrees of freedom per atom <input
            type="number"
            min="0.01"
            max={dimensions}
            step="0.01"
            bind:value={dof_per_atom}
          /></label
        >{/if}
    </div>
    <details>
      <summary>Definition, weighting and temperature</summary>
      <p>
        Atom-exposure average: integrated kinetic energy divided by integrated population. This
        average does not measure persistence. Exclude fixed atoms with a selection property.
        COM removal uses the mass-weighted mean of selected atoms inside the grid; velocity
        gradients within bins remain.
      </p>
      <p>
        Trapezoidal weighting uses recorded timestamps when available, otherwise MD steps. It
        spans the first through last selected sample, including gaps, with half intervals at
        the endpoints. Empty bins add zero energy and population. A single frame has unit
        weight. Velocity corrections subtract COM degrees of freedom; constrained models need
        an appropriate effective value. For stored energies, Kelvin requires explicit
        post-reference degrees of freedom; the reference label does not infer a correction.
      </p>
    </details>
  </details>
  <button
    onclick={calculate}
    disabled={busy ||
      !run?.compute_hotspots ||
      (source === `energy`
        ? !energy_unit || !energy_key.trim() || !energy_reference.trim()
        : !velocity_unit ||
          !velocity_key.trim() ||
          (mass_source === `recorded` && !mass_unit))}>Calculate hotspots</button
  >
  {#if busy}
    <progress value={progress} max="1" aria-label="Hotspot analysis progress"></progress>
    <button
      onclick={() => {
        requests.cancel()
        busy = false
      }}>Cancel</button
    >
  {/if}
  {#if !run?.compute_hotspots}<StatusMessage
      message="This trajectory source does not provide numeric atom analysis."
    />{/if}
  {#if error}<StatusMessage message={error} type="error" />{/if}
  {#if stale}<StatusMessage message="Settings changed. Recalculate to update this map." />{/if}
  {#if result}
    <div class="hotspot-controls">
      <label
        >Display <select bind:value={metric}
          ><option value="energy">Kinetic energy (eV/atom)</option><option
            value="temperature"
            disabled={!result.dof.some((value) => value > 0)}>Kinetic temperature (K)</option
          ></select
        ></label
      >
      <label
        >Minimum average atoms/bin <input
          type="number"
          min="0"
          bind:value={min_atoms}
        /></label
      >
      <label
        >Hotspot threshold × mean <input
          type="number"
          min="0"
          step="0.05"
          bind:value={threshold}
        /></label
      >
    </div>
    <HotspotSlice {result} {metric} {min_atoms} {threshold} />
    <p>
      {result.frames} frames, steps {result.first_step}–{result.last_step}; grid {result.grid.dims.join(
        `×`,
      )}. {result.excluded_atoms} atom samples outside the grid. Coverage measures sampling, not
      independent statistical confidence.
    </p>
  {/if}
</ViewerPane>

<style>
  .hotspot-controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13em, 1fr));
    gap: 0.5em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2em;
  }
  p {
    font-size: 0.85em;
  }
</style>
