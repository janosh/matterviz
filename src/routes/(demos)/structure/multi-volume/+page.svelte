<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { DragOverlay, StatusMessage } from '$lib/feedback'
  import FilePicker from '$lib/FilePicker.svelte'
  import { load_from_url } from '$lib/io'
  import { auto_color_config } from '$lib/isosurface/coloring'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import type {
    IsosurfaceLayer,
    IsosurfaceSettings,
    VolumetricData,
    VolumetricFileData,
  } from '$lib/isosurface/types'
  import {
    auto_volume_layer,
    DEFAULT_ISOSURFACE_SETTINGS,
    label_file_volumes,
    lattices_match,
    materialize_layers,
    merge_imported_volumes,
  } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import { volumetric_files } from '$site/isosurfaces'
  import type { AnyStructure } from 'matterviz'
  import { Structure } from 'matterviz'
  import { untrack } from 'svelte'
  import { to_error } from '$lib/utils'

  let structure = $state<AnyStructure | undefined>()
  let volumetric_data = $state.raw<VolumetricData[] | undefined>()
  let isosurface_settings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let active_volume_idx = $state(0)
  let supercell_scaling = $state(`1x1x1`)
  let active_scenario = $state<string | undefined>()
  let loading = $state(false)
  let error_msg = $state<string | undefined>()
  let load_time_ms = $state<number | undefined>()
  let dragover_hint = $state(false)

  const decode = (content: string | ArrayBuffer): string =>
    content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content

  // Monotonic token so a stale async load can never overwrite a newer selection
  let load_counter = 0
  const replace_url = (url: string) =>
    goto(url, { replaceState: true, keepFocus: true, noScroll: true })

  // Fetch and parse one demo file from /isosurfaces/<name>
  async function fetch_volumetric(name: string): Promise<VolumetricFileData> {
    const file = volumetric_files.find((entry) => entry.name === name)
    if (!file) throw new Error(`Unknown demo file ${name}`)
    let parsed: VolumetricFileData | null = null
    await load_from_url(file.url, (content, filename) => {
      parsed = parse_volumetric_file(decode(content), filename)
    })
    if (!parsed) throw new Error(`Failed to parse ${name}`)
    return parsed
  }

  // Load several files into one scene: first file provides the structure, all
  // volumes are appended with filename-derived labels + source ids
  async function load_files(
    names: string[],
  ): Promise<{ struct: AnyStructure; volumes: VolumetricData[] }> {
    const results = await Promise.all(names.map(fetch_volumetric))
    const volumes = results.flatMap((result, file_idx) =>
      label_file_volumes(result.volumes, names[file_idx]),
    )
    return { struct: results[0].structure as AnyStructure, volumes }
  }

  interface Scenario {
    id: string
    title: string
    description: string
    files: string[]
    supercell?: string
    // Fractional display range for surfaces (independent of the atom supercell)
    display_range?: IsosurfaceSettings[`display_range`]
    // Build explicit layers once volumes are loaded (volume order follows files)
    layers: (volumes: VolumetricData[]) => IsosurfaceLayer[]
  }

  // Convenience: surface of volume `volume_idx` colored by volume `color_idx`.
  // The colormap is auto-picked from the color volume's data; color_range stays
  // unset so the renderer fits it to the values sampled on the surface.
  const colored_layer = (
    volumes: VolumetricData[],
    volume_idx: number,
    color_idx: number,
    overrides: Partial<IsosurfaceLayer> = {},
  ): IsosurfaceLayer => ({
    isovalue: volumes[volume_idx].data_range.abs_max * 0.2,
    color: `#9ca3af`,
    opacity: 0.85,
    visible: true,
    show_negative: false,
    negative_color: `#ef4444`,
    volume_idx,
    color_volume_idx: color_idx,
    colormap: auto_color_config(volumes[color_idx].data_range).colormap,
    ...overrides,
  })

  const scenarios: Scenario[] = [
    {
      id: `glycine-esp`,
      title: `Density × ESP (glycine)`,
      description: `Glycine electron-density surface colored by ESP: red = nucleophilic (carboxyl O), blue = electrophilic (amine/hydroxyl H). The ESP cube renders no surface of its own — it's purely a color source.`,
      files: [`glycine-density.cube.gz`, `glycine-esp.cube.gz`],
      layers: (volumes) => [
        colored_layer(volumes, 0, 1, {
          isovalue: volumes[0].data_range.abs_max * 0.12,
          opacity: 0.85,
        }),
      ],
    },
    {
      id: `caffeine-homo-lumo`,
      title: `HOMO + LUMO together (caffeine)`,
      description: `Two real Psi4 orbital cubes at once: HOMO in blue/red, LUMO in green/purple, each with ± lobes — four transparent surfaces from independent volumes in one scene.`,
      files: [`caffeine-HOMO.cube.gz`, `caffeine-LUMO.cube.gz`],
      layers: () => [
        {
          isovalue: 0.02,
          color: `#3b82f6`,
          opacity: 0.75,
          visible: true,
          show_negative: true,
          negative_color: `#ef4444`,
          volume_idx: 0,
        },
        {
          isovalue: 0.02,
          color: `#22c55e`,
          opacity: 0.75,
          visible: true,
          show_negative: true,
          negative_color: `#a855f7`,
          volume_idx: 1,
        },
      ],
    },
    {
      id: `fe-spin`,
      title: `Charge × magnetization (Fe BCC)`,
      description: `Spin-polarized CHGCAR (two volumes in one file): the charge surface is colored by magnetization density, in a 2×2×2 supercell with colors continuous across cell boundaries.`,
      files: [`Fe-spin-CHGCAR.gz`],
      supercell: `2x2x2`,
      layers: (volumes) => [
        colored_layer(volumes, 0, 1, {
          isovalue: volumes[0].data_range.abs_max * 0.18,
          opacity: 1,
        }),
      ],
    },
    {
      id: `si-potential`,
      title: `Density × potential (Si diamond)`,
      description: `Si diamond CHGCAR colored by a matching LOCPOT on two 80×80×96 grids (~614k points each). Drag isovalue vs colormap-range to compare mesh rebuild vs recolor cost.`,
      files: [`large-grid-CHGCAR.gz`, `large-grid-LOCPOT.gz`],
      layers: (volumes) => [
        colored_layer(volumes, 0, 1, {
          isovalue: volumes[0].data_range.abs_max * 0.25,
          opacity: 0.9,
          colormap: `interpolateTurbo`,
        }),
      ],
    },
    {
      id: `hbn-elf`,
      title: `Density × ELF, non-orthogonal (hBN)`,
      description: `hBN with two density surfaces: an outer shell colored by ELF from a second file plus an inner solid shell — world-coordinate sampling on a non-orthogonal lattice, 3×3×1.`,
      files: [`hBN-CHGCAR.gz`, `hBN-ELFCAR.gz`],
      supercell: `3x3x1`,
      layers: (volumes) => [
        colored_layer(volumes, 0, 1, {
          isovalue: volumes[0].data_range.abs_max * 0.12,
          opacity: 0.65,
        }),
        {
          isovalue: volumes[0].data_range.abs_max * 0.45,
          color: `#f97316`,
          opacity: 1,
          visible: true,
          show_negative: false,
          negative_color: `#ef4444`,
          volume_idx: 0,
        },
      ],
    },
    {
      id: `fractional-range`,
      title: `Fractional display range (hBN)`,
      description: `VESTA-style non-integer supercell: the surface spans a, b ∈ [−0.15, 2.15], clipped exactly at those fractional bounds, while atoms keep an independent 2×2×1 supercell. Tune live under Isosurface → Range.`,
      files: [`hBN-CHGCAR.gz`, `hBN-ELFCAR.gz`],
      supercell: `2x2x1`,
      display_range: [
        [-0.15, 2.15],
        [-0.15, 2.15],
        [0, 1],
      ],
      layers: (volumes) => [
        colored_layer(volumes, 0, 1, {
          isovalue: volumes[0].data_range.abs_max * 0.12,
          opacity: 0.85,
        }),
      ],
    },
  ]

  // Run an async load with stale-load protection: bumps the shared counter and
  // hands the task an is_current() check; error/loading state only update while
  // this load is still the latest, so a newer selection can't be overwritten.
  async function run_load(task: (is_current: () => boolean) => Promise<void>) {
    const load_id = ++load_counter
    const is_current = () => load_id === load_counter
    loading = true
    error_msg = undefined
    try {
      await task(is_current)
    } catch (exc) {
      if (is_current()) error_msg = to_error(exc).message
    } finally {
      if (is_current()) loading = false
    }
  }

  const load_scenario = (scenario: Scenario) =>
    run_load(async (is_current) => {
      load_time_ms = undefined
      active_scenario = scenario.id
      structure = undefined
      volumetric_data = undefined
      active_volume_idx = 0

      const start = performance.now()
      const { struct, volumes } = await load_files(scenario.files)
      if (!is_current()) return // stale load — a newer one took over
      structure = struct
      volumetric_data = volumes
      isosurface_settings = {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: scenario.layers(volumes),
        display_range: scenario.display_range,
      }
      supercell_scaling = scenario.supercell ?? `1x1x1`
      load_time_ms = Math.round(performance.now() - start)
      if (browser) replace_url(`${globalThis.location.pathname}?scenario=${scenario.id}`)
    })

  // Leave preset-scenario mode after the user modifies the scene: hide the
  // overlay label and drop the ?scenario param so the URL effect can't reload
  // the stale scenario over the user's changes.
  function clear_scenario() {
    active_scenario = undefined
    if (browser && page.url.searchParams.has(`scenario`)) {
      replace_url(globalThis.location.pathname)
    }
  }

  // Clicking a file appends its volumes when the lattice matches the current
  // scene (same physical cell → overlay another field); otherwise it replaces.
  // Uses the same merge helpers as Structure.svelte's drag-and-drop import.
  const add_or_replace_file = (name: string) =>
    run_load(async (is_current) => {
      const parsed = await fetch_volumetric(name)
      if (!is_current()) return // stale load — a newer one took over
      const incoming = label_file_volumes(parsed.volumes, name)
      const current_lattice =
        structure && `lattice` in structure ? structure.lattice.matrix : undefined

      if (
        volumetric_data?.length &&
        lattices_match(current_lattice, parsed.structure.lattice?.matrix)
      ) {
        const merged = merge_imported_volumes(
          volumetric_data,
          materialize_layers(isosurface_settings, active_volume_idx),
          incoming,
          active_volume_idx,
        )
        volumetric_data = merged.volumes
        isosurface_settings = { ...isosurface_settings, layers: merged.layers }
        active_volume_idx = merged.first_touched_idx
      } else {
        structure = parsed.structure as AnyStructure
        volumetric_data = incoming
        isosurface_settings = {
          ...DEFAULT_ISOSURFACE_SETTINGS,
          layers: incoming.map((vol, idx) => auto_volume_layer(vol, idx, idx)),
        }
        active_volume_idx = 0
        supercell_scaling = `1x1x1`
      }
      clear_scenario()
    })

  let total_points = $derived(
    (volumetric_data ?? []).reduce(
      (sum, vol) => sum + vol.grid_dims[0] * vol.grid_dims[1] * vol.grid_dims[2],
      0,
    ),
  )
  let n_surfaces = $derived(
    (isosurface_settings.layers ?? []).reduce(
      (sum, layer) => sum + (layer.visible ? (layer.show_negative ? 2 : 1) : 0),
      0,
    ),
  )

  // Load the scenario from the URL param (reacts to client-side navigation too;
  // load_scenario's replaceState goto writes the same param so no loop occurs).
  // Only the URL is tracked: card clicks set active_scenario before goto runs,
  // and tracking it would rerun this effect against the stale URL, reloading
  // the previous scenario and discarding the click as a stale load.
  // An unknown or absent param falls back to the first scenario only while
  // nothing is loaded (fresh mount / bad link) — clear_scenario() drops the
  // param after user imports, and reloading a preset then would wipe the
  // user's custom scene.
  $effect(() => {
    const param = page.url.searchParams.get(`scenario`)
    untrack(() => {
      const target = scenarios.find((scenario) => scenario.id === param)
      if (target) {
        if (target.id !== active_scenario) load_scenario(target)
      } else if (!volumetric_data?.length && !loading) {
        load_scenario(scenarios[0])
      }
    })
  })
</script>

<svelte:head>
  <title>Multi-Volume Isosurfaces | MatterViz</title>
</svelte:head>

<h1>Multi-Volume Isosurfaces</h1>

<p>
  Load several volumetric datasets into one scene, render isosurfaces from each simultaneously,
  and color any surface by sampling another volume's scalar field at its vertices (e.g. an
  electron-density surface colored by electrostatic potential). Drop multiple <code>.cube</code
  >/<code>CHGCAR</code>-family files onto the viewer at once — files describing the same cell
  are appended as extra volumes rather than replacing the scene.
</p>

<section class="scenarios">
  {#each scenarios as scenario (scenario.id)}
    <button
      type="button"
      class="scenario-card"
      class:active={active_scenario === scenario.id}
      onclick={() => load_scenario(scenario)}
    >
      <strong>{scenario.title}</strong>
      <span>{scenario.description}</span>
    </button>
  {/each}
</section>

<h3 class="picker-heading">Mix your own (same-cell files append as extra volumes)</h3>
<FilePicker
  files={volumetric_files}
  active_files={[
    ...new Set(volumetric_data?.flatMap(({ source_filename }) => source_filename || []) ?? []),
  ]}
  on_click={(file) => add_or_replace_file(file.name)}
  style="margin-bottom: 0.5em"
/>

<div
  class="viewer-container"
  class:dragover-hint={dragover_hint}
  role="region"
  aria-label="Multi-volume isosurface viewer - drop volumetric files here"
  ondragenter={(event: DragEvent) => {
    event.preventDefault()
    dragover_hint = true
  }}
  ondragleave={(event: DragEvent & { currentTarget: HTMLElement }) => {
    const related = event.relatedTarget
    if (!(related instanceof Node) || !event.currentTarget.contains(related)) {
      dragover_hint = false
    }
  }}
  ondrop={() => (dragover_hint = false)}
>
  <DragOverlay
    visible={dragover_hint}
    message="Drop one or more volumetric files (same-cell files append as extra volumes)"
  />
  <div class="viewer-pane">
    <Structure
      bind:structure
      bind:volumetric_data
      bind:isosurface_settings
      bind:active_volume_idx
      bind:supercell_scaling
      bind:loading
      bind:error_msg
      show_controls="always"
      on_file_load={clear_scenario}
    >
      {#if active_scenario}
        <p class="scenario-label">
          {scenarios.find((entry) => entry.id === active_scenario)?.title}
        </p>
      {/if}
    </Structure>
  </div>
</div>

{#if error_msg}
  <StatusMessage message={error_msg} type="error" />
{/if}

{#if volumetric_data?.length}
  <div class="stats-bar">
    <span title="Number of loaded volumes">Volumes: {volumetric_data.length}</span>
    {#each volumetric_data as vol, idx (idx)}
      <span title="Grid dimensions and value range">
        {vol.label ?? `Volume ${idx + 1}`}: {vol.grid_dims.join(`×`)}
        [{format_num(vol.data_range.min, `.3~g`)}, {format_num(vol.data_range.max, `.3~g`)}]
      </span>
    {/each}
    <span title="Total grid points across all volumes">
      Points: {format_num(total_points)}
    </span>
    <span title="Visible surfaces (negative lobes count separately)">
      Surfaces: {n_surfaces}
    </span>
    {#if load_time_ms !== undefined}
      <span title="Fetch + decompress + parse time">Load: {load_time_ms} ms</span>
    {/if}
  </div>
{/if}

<section class="features">
  <h2>What this demonstrates</h2>
  <ul>
    <li>
      <strong>Multi-volume registration</strong> &ndash; several cube/CHGCAR files coexist as independent
      volumes in one scene
    </li>
    <li>
      <strong>Simultaneous surfaces</strong> &ndash; every volume can show isosurfaces at once; switching
      the edited volume hides nothing
    </li>
    <li>
      <strong>Cross-volume coloring</strong> &ndash; each surface can sample any loaded volume for
      per-vertex colors with a configurable colormap and value range
    </li>
    <li>
      <strong>Hidden color sources</strong> &ndash; a volume with no surfaces of its own still colors
      other surfaces
    </li>
    <li>
      <strong>Grid compatibility checks</strong> &ndash; strictly matching grids sample exactly;
      mismatched grids resample in shared coordinates with a ⚠ diagnostic
    </li>
    <li>
      <strong>Periodic continuity</strong> &ndash; colors wrap seamlessly across cell boundaries
      and supercell tiles
    </li>
    <li>
      <strong>Fractional display ranges</strong> &ndash; VESTA-style non-integer supercells repeat
      surfaces periodically and clip them exactly at fractional bounds
    </li>
    <li>
      <strong>Fast recolor</strong> &ndash; changing colormap or range remaps cached vertex scalars
      without rerunning marching cubes
    </li>
    <li>
      <strong>Multi-file import</strong> &ndash; drop several files at once; same-cell files append,
      new systems replace
    </li>
  </ul>
</section>

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  p {
    margin-bottom: 1em;
    max-width: 60em;
  }
  .scenarios {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.6em;
    margin-bottom: 1em;
  }
  .scenario-card {
    display: flex;
    flex-direction: column;
    gap: 0.35em;
    padding: 0.7em 0.85em;
    text-align: left;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 6px;
    background: light-dark(rgba(0, 0, 0, 0.02), rgba(255, 255, 255, 0.06));
    cursor: pointer;
    transition: all 0.15s ease;
    font: inherit;
    color: inherit;
    user-select: text; /* buttons suppress text selection by default */
  }
  .scenario-card:hover {
    border-color: var(--accent-color, #007acc);
    background: light-dark(rgba(0, 122, 204, 0.08), rgba(0, 122, 204, 0.18));
  }
  .scenario-card.active {
    border-color: var(--success-color, #00c853);
    background: light-dark(rgba(0, 200, 83, 0.08), rgba(0, 200, 83, 0.15));
  }
  .scenario-card strong {
    font-size: 0.9em;
  }
  .scenario-card span {
    font-size: 0.72em;
    opacity: 0.75;
    line-height: 1.35;
  }
  .picker-heading {
    margin: 0.5em 0 0.3em;
    font-size: 0.9rem;
    opacity: 0.85;
  }
  .viewer-container {
    position: relative;
    min-height: 550px;
  }
  .viewer-pane {
    position: relative;
    height: 550px;
    :global(.matterviz-structure) {
      height: 100%;
    }
  }
  .scenario-label {
    position: absolute;
    top: 4px;
    left: 0;
    margin: 1ex 1em;
    font-family: monospace;
    z-index: 1;
    background: light-dark(rgba(220, 224, 230, 0.9), rgba(0, 0, 0, 0.5));
    color: light-dark(#222, white);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.85em;
  }
  .stats-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em 1.2em;
    padding: 0.5em 0.8em;
    margin-top: 0.5em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 6px;
    font-size: 0.8em;
    font-family: monospace;
    span {
      white-space: nowrap;
      opacity: 0.85;
    }
  }
  .features {
    margin-top: 1.5em;
    padding: 1em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 6px;
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
    }
    ul {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 0.4rem 1.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.9rem;
    }
  }
</style>
