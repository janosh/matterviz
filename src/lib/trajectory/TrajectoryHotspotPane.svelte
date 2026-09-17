<script lang="ts">
  import { untrack } from 'svelte'
  import { ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import { ColorInput, StatusMessage } from 'svelte-widgets'
  import { DEFAULT_HOTSPOT_CLOUD, type HotspotCloudSettings } from './hotspot-colors'
  import { Graph } from 'svelte-widgets/icons'
  import { format_num } from '$lib/labels'
  import type { TrajectoryRun } from './run'
  import { create_request_owner } from './async-result.svelte'
  import {
    ENERGY_UNITS,
    VELOCITY_UNITS,
    infer_mass_unit,
    type HotspotMetric,
    type HotspotOptions,
    type HotspotResult,
    type HotspotCoverage,
  } from './hotspots'
  import HotspotSlice from './HotspotSlice.svelte'

  let {
    run,
    current_frame_idx = 0,
    pane_open = $bindable(false),
    result = $bindable(),
    coverage = $bindable(),
    metric = $bindable(`energy`),
    min_atoms = $bindable(10),
    threshold = $bindable(1.25),
    show_heatmap = $bindable(true),
    cloud = $bindable({ ...DEFAULT_HOTSPOT_CLOUD }),
    ...pane_props
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    current_frame_idx?: number
    pane_open?: boolean
    result?: HotspotResult
    coverage?: HotspotCoverage
    metric?: HotspotMetric
    min_atoms?: number
    threshold?: number
    show_heatmap?: boolean
    cloud?: HotspotCloudSettings
  } = $props()
  let preview_frame = $state<number>()
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
  const recorded_masses = $derived(
    run?.atom_masses ??
      run?.preview.structure.sites
        .slice(0, 64)
        .map((site) => site.properties?.mass)
        .filter((mass) => mass !== undefined) ??
      [],
  )
  const detected_mass_unit = $derived(
    infer_mass_unit(recorded_masses, run?.metadata.mass_unit),
  )
  let motion = $state<NonNullable<HotspotOptions[`motion`]>>(`device`)
  let coordinates = $state<NonNullable<HotspotOptions[`coordinates`]>>(`device`)
  let selection_key = $state(``)
  let dimensions = $state<2 | 3>(3)
  let dof_per_atom = $derived<number>(dimensions)
  let stored_dof_known = $state(false)
  const busy = $derived(coverage?.busy ?? false)
  let settings_open = $state(true)
  let progress = $state(0)
  let eta_seconds = $state<number>()
  const eta = $derived(
    eta_seconds === undefined
      ? `estimating…`
      : eta_seconds >= 60
        ? `${Math.floor(eta_seconds / 60)}m ${eta_seconds % 60}s`
        : `${eta_seconds}s`,
  )
  let error = $state(``)
  let analyzed_options_json = $state(``)
  const requirements_id = $props.id()
  const disabled_reason = $derived.by(() => {
    if (!run?.compute_hotspots)
      return `Hotspot analysis is unavailable for this trajectory reader. Open a local file with per-atom velocities or kinetic energies.`
    const missing =
      source === `energy`
        ? [
            !energy_key.trim() && `Enter the energy property.`,
            !energy_unit && `Select energy units.`,
            !energy_reference.trim() && `Describe the stored energy reference.`,
          ]
        : [
            !velocity_key.trim() && `Enter the velocity property.`,
            !velocity_unit && `Select velocity units.`,
            mass_source === `recorded` &&
              !mass_unit &&
              `Select mass units for recorded masses, or choose standard elemental masses.`,
          ]
    return missing.filter(Boolean).join(` `)
  })
  const requests = create_request_owner()
  const cancel = (): void => {
    requests.cancel()
    if (coverage) coverage.busy = false
  }
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
  const options_json = $derived(JSON.stringify(options))
  $effect(() => {
    const next = run
    untrack(() => {
      cancel()
      settings_open = true
      result = undefined
      coverage = undefined
      preview_frame = undefined
      analyzed_options_json = ``
      error = ``
      start_frame = 0
      end_frame = next?.frame_count ?? 1
      source = `velocity`
      velocity_key = `velocity`
      energy_key = `kinetic_energy`
      energy_reference = ``
      selection_key = ``
      mass_source = recorded_masses.length ? `recorded` : `standard`
      mass_unit = detected_mass_unit ?? ``
      dimensions = 3
      dof_per_atom = 3
      stored_dof_known = false
      const unit = next?.signals?.velocity?.unit ?? next?.metadata.velocity_unit
      velocity_unit =
        typeof unit === `string` && unit in VELOCITY_UNITS
          ? (unit as keyof typeof VELOCITY_UNITS)
          : ``
      energy_unit = ``
    })
  })
  $effect(() => cancel)
  async function calculate(): Promise<void> {
    const active = run
    const compute = active?.compute_hotspots
    if (!active || !compute) return
    const signal = requests.start()
    progress = 0
    eta_seconds = undefined
    const started = performance.now()
    error = ``
    const submitted = $state.snapshot(options)
    const submitted_json = options_json
    const initial_frame = current_frame_idx
    const start = submitted.start_frame ?? 0
    const stride = submitted.frame_stride ?? 1
    // Each request owns its status, so a cancelled request cannot clear a newer one.
    const status = $state<HotspotCoverage>({
      start,
      stride,
      total: Math.ceil(((submitted.end_frame ?? active.frame_count) - start) / stride),
      completed: 0,
      busy: true,
    })
    coverage = status
    const publish = (computed: HotspotResult, frame?: number): void => {
      if (signal.aborted || active !== run) return
      result = computed
      preview_frame = frame
      if (frame !== undefined) status.preview_frame = frame
      analyzed_options_json = submitted_json
      settings_open = false
    }
    try {
      const computed = await compute({
        ...submitted,
        preview_frame: initial_frame,
        retained_bytes: result ? result.energy.length * 36 : 0,
        signal,
        on_preview: (preview) => publish(preview, initial_frame),
        on_partial: publish,
        on_progress: ({ current, total, completed }) => {
          if (signal.aborted) return
          status.completed = completed
          progress = Math.min(1, Math.max(0, current / total))
          eta_seconds =
            current > 0
              ? Math.ceil((((performance.now() - started) / 1000) * (1 - progress)) / progress)
              : undefined
        },
      })
      if (signal.aborted || active !== run) return
      publish(computed)
      status.completed = status.total
      if (!computed.dof.some((value) => value > 0)) metric = `energy`
    } catch (failure) {
      if (!signal.aborted && active === run)
        error = failure instanceof Error ? failure.message : String(failure)
    } finally {
      status.busy = false
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
            >{#if mass_unit === detected_mass_unit}<small
                >{run?.metadata.mass_unit
                  ? `From trajectory metadata`
                  : `Inferred from recorded masses`}</small
              >{/if}</label
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
  <div class="hotspot-actions">
    <button
      onclick={calculate}
      disabled={busy || Boolean(disabled_reason)}
      aria-describedby={disabled_reason ? requirements_id : undefined}
      >{busy ? `Calculating hotspots…` : `Calculate hotspots`}</button
    >
    {#if busy}
      <button onclick={cancel}>Cancel</button>
      <div class="hotspot-progress">
        <progress value={progress} max="1" aria-label="Hotspot analysis progress"></progress>
        <span>{format_num(progress * 100, `.1f`)}% · ETA {eta}</span>
      </div>
    {/if}
    {#if disabled_reason}<p id={requirements_id} role="status">{disabled_reason}</p>{/if}
  </div>
  {#if error}<StatusMessage message={error} type="error" />{/if}
  {#if result && analyzed_options_json !== options_json}
    <StatusMessage message="Settings changed. Recalculate to update this map." />
  {/if}
  {#if result}
    <p class="hotspot-map-status" role="status">
      {#if preview_frame !== undefined}
        Frame {preview_frame} preview{busy ? ` · calculating time average…` : ``}
      {:else if coverage && coverage.completed < coverage.total}
        Incomplete time average · {result.frames}/{coverage.total} frames
      {:else}
        Time average · {result.frames} frames
      {/if}
    </p>
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
      <div class="hotspot-toggles">
        <label><input type="checkbox" bind:checked={show_heatmap} /> Heatmap on atoms</label>
        <label><input type="checkbox" bind:checked={cloud.visible} /> Volume cloud</label>
      </div>
    </div>
    {#if cloud.visible}
      <div
        class="hotspot-controls cloud-controls"
        style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 8em), 1fr))"
      >
        <label
          >Cloud opacity · {format_num(cloud.opacity * 100, `.0f`)}%
          <input type="range" min="0" max="1" step="0.01" bind:value={cloud.opacity} />
        </label>
        <ColorInput
          label="Cloud base color"
          bind:value={cloud.base_color}
          labels={{ picker: `Cloud base color`, hex: `Cloud base color hex` }}
        />
        <ColorInput
          label="Hotspot color"
          bind:value={cloud.hot_color}
          labels={{ picker: `Hotspot color`, hex: `Hotspot color hex` }}
        />
      </div>
      <p>
        Faint background, strongest at the hotspot threshold. The translucent cloud shows heat
        through atoms; it smooths the bins for display.
      </p>
    {/if}
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
  h3 {
    margin: 0;
  }
  .hotspot-actions,
  .hotspot-progress {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4em 0.6em;
  }
  .hotspot-actions {
    button {
      flex: none;
    }
    p,
    .hotspot-progress {
      flex: 1 1 14em;
      min-width: 0;
    }
  }
  .hotspot-progress {
    progress {
      flex: 1;
      min-width: 0;
    }
    span {
      white-space: nowrap;
    }
  }
  .hotspot-controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14em), 1fr));
    align-items: start;
    gap: 0.5em;
    label {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 0.2em;
      text-align: left;
    }
    &:not(.cloud-controls) > :is(label, .hotspot-toggles) {
      grid-row: span 3;
    }
    /* Share label, input and help-text rows so wrapped titles cannot stagger controls. */
    &:not(.cloud-controls) > label {
      display: grid;
      grid-template-rows: subgrid;
      align-self: stretch;
      align-items: start;
      > input,
      > select {
        grid-row: 2;
      }
      > small {
        grid-row: 3;
      }
    }
    label:has(input[type='checkbox']) {
      display: flex;
      flex-direction: row;
      align-items: center;
    }
    > label:has(input[type='checkbox']),
    .hotspot-toggles {
      align-self: end;
    }
    :is(select, input:not([type='checkbox'])) {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      margin: 0;
    }
  }
  p {
    font-size: 0.85em;
    margin: 0.25em 0;
  }
</style>
