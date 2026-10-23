<script lang="ts">
  // One viewer fusing a material's crystal structure, Fermi surface, band structure and DOS, as
  // Trajectory fuses a structure and its plots: one frame, control row, fullscreen and file
  // drop. The 3D scenes sit on top (side by side or stacked by their row's shape), the spectra
  // below on one shared energy axis, every split at a draggable divider, and the pane menu
  // shows any subset (default: the panes with data). The views are linked:
  // - Real and reciprocal lattice share one Cartesian frame (b_i · a_j = 2π δ_ij), so orbiting
  //   either scene turns the other alike (sync_rotation), each keeping its own zoom.
  // - Bands ↔ Fermi surface: hover previews, click pins and isolates a sheet (FermiBandsLink).
  // - Bands ↔ DOS share zoom and hover lines on the energy axis; hovering the DOS previews the
  //   Fermi surface at that energy too.
  // A dropped file replaces the data of the panes it fills (structure, band grid or Fermi
  // surface, band structure or DOS JSON, vaspout.h5 bands/DOS).
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import { create_material_loader } from '#lib/file-viewer/material-loader.svelte.js'
  import type { OpenedMaterial } from '#lib/file-viewer/open.js'
  import BandCrossings from '#lib/fermi-surface/BandCrossings.svelte'
  import {
    FermiBandsLink,
    LINK_HOVER_CONFIG,
  } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
  import type { BandGridJson, FermiSurfaceJson } from '#lib/fermi-surface/parse.js'
  import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
  import { is_fermi_surface_data } from '#lib/fermi-surface/types.js'
  import { pick_pane_orientation } from '#lib/layout/pane-orientation.js'
  import ViewerChrome from '#lib/layout/ViewerChrome.svelte'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { reciprocal_lattice } from '#lib/math.js'
  import { SHORTCUTS } from '#lib/shortcuts.js'
  import { ToolbarMenu } from '#lib/overlays/index.js'
  import { link_orbits } from '#lib/scene/orbit-link.svelte.js'
  import type { Crystal } from '#lib/structure/index.js'
  import Structure from '#lib/structure/Structure.svelte'
  import { is_crystal } from '#lib/structure/validation.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Icon from 'svelte-widgets/Icon.svelte'
  import {
    Atom,
    BandStructure,
    DensityOfStates,
    FermiSurface as FermiSurfaceIcon,
    Grid2x2,
    LinkOff,
    LinkVariant,
  } from 'svelte-widgets/icons'
  import SplitPane from 'svelte-widgets/SplitPane.svelte'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { normalize_band_structure, normalize_dos } from './helpers'
  import { create_bands_dos_sync } from './synced-axes.svelte'
  import type { Sides } from '#lib/plot/core/layout.js'
  import type { BaseBandStructure, DosData, ElectronicPane, FrequencyUnit } from './types'

  const PANES = [
    { pane: `structure`, icon: Atom, label: `Structure` },
    { pane: `fermi`, icon: FermiSurfaceIcon, label: `Fermi surface` },
    { pane: `bands`, icon: BandStructure, label: `Band structure` },
    { pane: `dos`, icon: DensityOfStates, label: `Density of states` },
  ] as const
  const PANE_IDS = PANES.map(({ pane }) => pane)
  // Below this row width the DOS stacks under the bands, as in BandsAndDos; beside them, the
  // divider keeps each plot this wide (px), room for its axes
  const MIN_SPECTRA_SIDE_WIDTH = 520
  const [MIN_BANDS_WIDTH, MIN_DOS_WIDTH] = [300, 120]

  let {
    structure = $bindable(),
    fermi_data = $bindable(),
    band_data = $bindable(),
    band_structs = $bindable({}),
    doses = $bindable({}),
    panes = $bindable(),
    units = $bindable(`THz`),
    fermi_level,
    mu = $bindable(0),
    selected_bands = $bindable(),
    layout = `auto`,
    pane_ratio = $bindable(0.5),
    row_ratio = $bindable(0.5),
    spectra_ratio = $bindable(0.78),
    sync_rotation = $bindable(true),
    show_controls,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    allow_file_drop = true,
    loading = $bindable(false),
    error_msg = $bindable(),
    on_file_load,
    on_error,
    structure_props = {},
    fermi_props = {},
    bands_props = {},
    dos_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure?: Crystal // must share the Fermi data's Cartesian frame (same calculation)
    fermi_data?: FermiSurfaceData | FermiSurfaceJson
    band_data?: BandGridData | BandGridJson // band grid: energy previews and band colours
    // the first band structure's k-path is drawn through the Fermi surface's zone
    band_structs?: Record<string, BaseBandStructure>
    doses?: Record<string, DosData>
    panes?: ElectronicPane[] // shown panes, default: those with data
    units?: FrequencyUnit // phonon frequency unit of bands and DOS
    fermi_level?: number // bands' and DOS' E_F, default: the band grid's, else the data's
    mu?: number // Fermi surface energy relative to E_F
    selected_bands?: number[] // bands whose Fermi sheets are shown (all when unset)
    layout?: `auto` | `horizontal` | `vertical` // the 3D scenes' split, auto by their row's shape
    pane_ratio?: number // the structure's share of the scenes' row
    row_ratio?: number // the scenes' share of the viewer height above the spectra
    spectra_ratio?: number // the bands' share of the spectra's row beside the DOS
    sync_rotation?: boolean // orbiting one scene turns the other alike
    // the viewer's row; `never` also hides the panes' own controls
    show_controls?: ShowControlsProp<`panes` | `sync-rotation` | `fullscreen`>
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    allow_file_drop?: boolean // one drop zone for all panes: theirs are off
    loading?: boolean
    error_msg?: string
    on_file_load?: (data: { filename: string; panes: ElectronicPane[] }) => void // panes filled
    on_error?: (data: { error_msg: string; filename?: string }) => void
    // per-pane extras; the fused props (data, links, drop, fullscreen) override them
    structure_props?: Partial<ComponentProps<typeof Structure>>
    fermi_props?: Partial<ComponentProps<typeof FermiSurface>>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
  } = $props()

  link_orbits(() => sync_rotation)

  let wrapper = $state<HTMLDivElement>()
  let dragover = $state(false)
  let chrome_height = $state(0)
  let scenes_size = $state({ width: 0, height: 0 })
  let spectra_width = $state(0)
  // Left padding the DOS settled on beside the bands (its tick labels and their margin), which
  // the bands mirror on their right (room for the E_F label), centring the divider in the gap
  let dos_left_padding = $state<number>()

  const controls_config = $derived(normalize_show_controls(show_controls))
  const pane_controls = <Prop>(prop: Prop): Prop | false =>
    controls_config.mode === `never` ? false : prop

  // === panes and layout ===
  const has_data = $derived<Record<ElectronicPane, boolean>>({
    structure: Boolean(structure),
    fermi: Boolean(fermi_data || band_data),
    bands: Object.keys(band_structs).length > 0,
    dos: Object.keys(doses).length > 0,
  })
  const shown = $derived.by((): Set<ElectronicPane> => {
    if (panes) return new Set(panes)
    const with_data = PANE_IDS.filter((pane) => has_data[pane])
    // nothing loaded yet: the two scenes' empty states invite a drop
    return new Set(with_data.length ? with_data : [`structure`, `fermi`])
  })
  const toggle_pane = (pane: ElectronicPane): void => {
    const next = PANE_IDS.filter((id) => shown.has(id) !== (id === pane))
    if (next.length > 0) panes = next
  }
  const show_scenes = $derived(shown.has(`structure`) || shown.has(`fermi`))
  const show_spectra = $derived(shown.has(`bands`) || shown.has(`dos`))
  const scenes_split = $derived(shown.has(`structure`) && shown.has(`fermi`))
  const spectra_split = $derived(shown.has(`bands`) && shown.has(`dos`))
  const scene_orientation = $derived.by(() => {
    if (layout !== `auto`) return layout
    return pick_pane_orientation(scenes_size.width, scenes_size.height)
  })
  const spectra_side = $derived(spectra_split && spectra_width >= MIN_SPECTRA_SIDE_WIDTH)
  // The pane in the viewer's top-right corner puts its own controls below the viewer's
  const corner_pane = $derived.by((): ElectronicPane => {
    const [first, second] = show_scenes
      ? ([`structure`, `fermi`] as const)
      : ([`bands`, `dos`] as const)
    if (!shown.has(first) || !shown.has(second)) return shown.has(first) ? first : second
    return (show_scenes ? scene_orientation === `horizontal` : spectra_side) ? second : first
  })
  const pane_style = (pane: ElectronicPane): string | undefined => {
    if (pane !== corner_pane || chrome_height === 0) return undefined
    const top = `calc(2ex + ${chrome_height}px)`
    return `--viewer-buttons-top: ${top}; --ctrl-btn-top: ${top}`
  }

  // === links ===
  const first_band_struct = $derived(Object.values(band_structs)[0])
  // the zone the k-path runs through: the Fermi data's, else the structure's
  const k_lattice = $derived(
    band_data?.k_lattice ??
      fermi_data?.k_lattice ??
      (structure && reciprocal_lattice(structure.lattice.matrix, { two_pi: true })),
  )
  const link = new FermiBandsLink({
    band_data: () => band_data,
    surface: () => fermi_data,
    band_struct: () => first_band_struct,
    k_lattice: () => k_lattice,
    mu: { get: () => mu, set: (value) => (mu = value) },
    selected_bands: { get: () => selected_bands, set: (bands) => (selected_bands = bands) },
    band_spin_mode: () => bands_props.band_spin_mode,
    color_property: () => fermi_props.color_property,
    line_kwargs: () => bands_props.line_kwargs,
  })
  const sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    doses: () => doses,
    units: () => units,
    fermi_level: () => fermi_level ?? link.fermi_energy,
    bands_props: () => bands_props,
    dos_props: () => dos_props,
    side_by_side: () => spectra_side,
    base_padding: { t: 20, b: 50 },
  })
  // the energy marked on both spectra: the previewed surface's, else the hovered one
  const reference_energy = $derived(link.reference_frequency ?? sync.hovered_frequency)

  // === file drop ===
  const report_error = (message: string, filename?: string): void => {
    error_msg = message
    on_error?.({ error_msg: message, filename })
  }
  // Fill the panes a parsed file has data for, else say why it fills none
  const fill = (opened: OpenedMaterial): ElectronicPane[] | string => {
    const { filename } = opened
    if (opened.type === `structure`) {
      if (!is_crystal(opened.data))
        return `${filename} holds no periodic structure: its Fermi surface needs a lattice`
      structure = opened.data
      return [`structure`]
    }
    if (opened.type === `fermi_surface`) {
      if (is_fermi_surface_data(opened.data))
        [fermi_data, band_data] = [opened.data, undefined]
      else [band_data, fermi_data] = [opened.data, undefined]
      return [`fermi`]
    }
    const vasp = opened.type === `vaspout_electronic` ? opened.data : null
    const json = opened.type === `json_browser` ? opened.data : null
    const bands = vasp ? vasp.bands : normalize_band_structure(json)
    const dos = vasp ? vasp.dos : bands ? null : normalize_dos(json)
    if (bands) band_structs = { [filename]: bands }
    if (dos) doses = { [filename]: dos }
    if (bands || dos) return bands && dos ? [`bands`, `dos`] : [bands ? `bands` : `dos`]
    const kind = opened.type.replaceAll(`_`, ` `)
    return `${filename} is ${kind} data, not a structure, Fermi surface, band structure or DOS`
  }
  const drop_zone = create_material_loader<unknown>({
    source: () => undefined,
    current_value: () => undefined,
    allow_file_drop: () => allow_file_drop,
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    set_dragover: (over) => (dragover = over),
    report_error: (message, metadata) => report_error(message, metadata?.filename),
    commit: (opened) => {
      const filled = fill(opened)
      if (typeof filled === `string`) return report_error(filled, opened.filename)
      // a pane the file filled shows even when the caller's pane list left it out
      if (panes && filled.some((pane) => !panes?.includes(pane)))
        panes = PANE_IDS.filter((pane) => panes?.includes(pane) || filled.includes(pane))
      on_file_load?.({ filename: opened.filename, panes: filled })
    },
  })
  const measure_chrome = (node: HTMLElement) => {
    const observer = new ResizeObserver(() => (chrome_height = node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }
</script>

<div
  bind:this={wrapper}
  role="group"
  aria-label="Electronic structure viewer"
  aria-keyshortcuts={SHORTCUTS.fullscreen.keys}
  {...rest}
  class={[
    `electronic-structure`,
    show_scenes && show_spectra ? `two-rows` : `one-row`,
    { dragover },
    rest.class,
  ]}
  {@attach drop_zone}
>
  <ViewerChrome
    {controls_config}
    bind:fullscreen
    {fullscreen_toggle}
    {wrapper}
    fullscreen_bg_css_var="--electronic-bg-fullscreen"
    {@attach measure_chrome}
  >
    {#if scenes_split && controls_config.visible(`sync-rotation`)}
      <button
        type="button"
        class="sync-rotation-toggle"
        aria-pressed={sync_rotation}
        title={sync_rotation ? `Unlink the scenes' rotations` : `Link the scenes' rotations`}
        onclick={() => (sync_rotation = !sync_rotation)}
      >
        <Icon icon={sync_rotation ? LinkVariant : LinkOff} />
      </button>
    {/if}
    {#if controls_config.visible(`panes`)}
      <ToolbarMenu label="Shown panes" class="panes-menu">
        {#snippet button()}
          <Icon icon={Grid2x2} />
        {/snippet}
        {#each PANES as { pane, icon, label } (pane)}
          <button
            class={[`view-mode-option`, { selected: shown.has(pane) }]}
            aria-pressed={shown.has(pane)}
            disabled={shown.size === 1 && shown.has(pane)}
            title={has_data[pane] ? undefined : `No ${label.toLowerCase()} data loaded`}
            onclick={() => toggle_pane(pane)}
          >
            <Icon {icon} />
            <span>{label}</span>
          </button>
        {/each}
      </ToolbarMenu>
    {/if}
  </ViewerChrome>

  {#if show_scenes}
    <div
      class={[`row scenes`, scenes_split ? scene_orientation : `single`]}
      bind:clientWidth={scenes_size.width}
      bind:clientHeight={scenes_size.height}
    >
      {#if shown.has(`structure`)}
        <div class="pane" data-pane="structure" style={pane_style(`structure`)}>
          <Structure
            {...structure_props}
            bind:structure
            show_controls={pane_controls(structure_props.show_controls)}
            allow_file_drop={false}
            fullscreen_toggle={false}
          />
        </div>
      {/if}
      {#if scenes_split}
        <SplitPane
          orientation={scene_orientation}
          bind:ratio={pane_ratio}
          aria-label="Resize structure and Fermi surface panes"
        />
      {/if}
      {#if shown.has(`fermi`)}
        <div class="pane" data-pane="fermi" style={pane_style(`fermi`)}>
          <FermiSurface
            {...fermi_props}
            bind:fermi_data
            bind:band_data
            show_controls={pane_controls(fermi_props.show_controls)}
            allow_file_drop={false}
            fullscreen_toggle={false}
            wigner_seitz={fermi_props.wigner_seitz ?? Boolean(first_band_struct)}
            selected_spins={link.selected_spins}
            previewing={link.hovered_energy !== null}
            bind:color_property={link.color_property}
            bind:mu={link.mu}
            bind:selected_bands={link.selected_bands}
            k_marker={link.path.hovered_k_point}
            k_path={link.k_path}
            on_point_hover={chain_callbacks(link.fermi_hover, fermi_props.on_point_hover)}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if show_scenes && show_spectra}
    <SplitPane
      orientation="vertical"
      bind:ratio={row_ratio}
      aria-label="Resize 3D scenes and spectra"
    />
  {/if}

  {#if show_spectra}
    <div
      class={[`row spectra`, spectra_split ? (spectra_side ? `side` : `stacked`) : `single`]}
      bind:clientWidth={spectra_width}
    >
      {#if shown.has(`bands`)}
        <div class="pane" data-pane="bands" style={pane_style(`bands`)}>
          <Bands
            {...bands_props}
            {band_structs}
            bind:units
            fermi_level={sync.fermi_level}
            show_controls={pane_controls(bands_props.show_controls)}
            fullscreen_toggle={false}
            padding={{
              r: spectra_side ? (dos_left_padding ?? 20) : 5,
              ...bands_props.padding,
              ...sync.shared_padding,
            }}
            y_axis={sync.y_axes[0]}
            bind:view={sync.views[0]}
            bind:resolved_padding={() => undefined, sync.raise_padding}
            bind:hovered_frequency={sync.hovered.bands}
            reference_frequency={reference_energy}
            line_kwargs={link.line_kwargs}
            bind:band_spin_mode={link.band_spin_mode}
            bind:x_positions={link.x_positions}
            highlighted_band_index={link.highlighted_band}
            highlighted_qpoint_index={link.path.active_qpoint}
            highlighted_qpoint_range={link.path.highlighted_qpoint_range}
            hover_config={{ ...LINK_HOVER_CONFIG, ...bands_props.hover_config }}
            on_point_hover={chain_callbacks(link.band_hover, bands_props.on_point_hover)}
            on_plot_click={chain_callbacks(link.band_click, bands_props.on_plot_click)}
          >
            {#snippet children(ctx)}
              {@render bands_props.children?.(ctx)}
              <BandCrossings {ctx} crossings={link.crossings} bind:node={link.crossings_svg} />
            {/snippet}
          </Bands>
        </div>
      {/if}
      {#if shown.has(`dos`)}
        {#if spectra_side}
          <SplitPane
            bind:ratio={spectra_ratio}
            min_px={MIN_BANDS_WIDTH}
            second_min_px={MIN_DOS_WIDTH}
            aria-label="Resize band structure and DOS"
          />
        {/if}
        <div class="pane" data-pane="dos" style={pane_style(`dos`)}>
          <Dos
            {...dos_props}
            {doses}
            bind:units
            fermi_level={sync.fermi_level}
            show_controls={pane_controls(dos_props.show_controls)}
            fullscreen_toggle={false}
            orientation={spectra_side ? `horizontal` : `vertical`}
            x_axis={sync.dos_x_axis}
            y_axis={sync.y_axes[1]}
            bind:view={sync.views[1]}
            bind:resolved_padding={
              () => undefined,
              (padding: Required<Sides> | undefined) => {
                sync.raise_padding(padding)
                dos_left_padding = padding?.l
              }
            }
            bind:hovered_frequency={
              () => sync.hovered.dos,
              (energy) => {
                sync.hovered.dos = energy
                link.hovered_energy = energy
              }
            }
            reference_frequency={reference_energy}
            padding={{ ...dos_props.padding, ...sync.shared_padding }}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <TaskStatus overlay spinner label="Loading file..." />
  {/if}
  <ViewerError bind:message={error_msg} dismissible />
</div>

<style>
  /* One frame and background for all panes, theirs transparent and filling their cells
     (Structure's root is display: contents, so its viewer sizes through its variables). The
     rows and panes split at --split-pane-size, which each SplitPane sets on its parent. */
  .electronic-structure {
    position: relative;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    width: var(--electronic-width, 100%);
    height: var(--electronic-height, 500px);
    border-radius: var(--electronic-border-radius, 0);
    background: var(--electronic-bg, var(--struct-bg));
    --struct-bg-override: transparent;
    --fermi-bg: transparent;
    --struct-height: 100%;
    --struct-min-width: 0;
    --fermi-height: 100%;
    --scatter-min-height: 0;
    &.two-rows {
      height: var(--electronic-height, 860px);
      grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
    &.dragover {
      background: var(--electronic-dragover-bg, var(--dragover-bg));
      outline: var(--electronic-dragover-border, var(--dragover-border));
    }
    &:fullscreen {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
      background: var(--electronic-bg-fullscreen, var(--electronic-bg, var(--struct-bg)));
    }
  }
  .row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    &.horizontal {
      grid-template-columns: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
    &.vertical {
      grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
    &.side {
      grid-template-columns: minmax(0, var(--split-pane-size, 78%)) minmax(0, 1fr);
    }
    &.stacked {
      grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    }
  }
  .pane {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    > :global(:not(.structure-fullscreen-root)) {
      height: 100%;
    }
  }
</style>
