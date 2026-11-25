<script lang="ts">
  // Equilibrium crystal shape viewer: computes the Wulff shape of a lattice (or crystal) from
  // per-family surface energies and renders it in 3D with a family legend, hover tooltips,
  // display settings, an info pane and PNG/JSON/STL/GLB export. Edit `facets` or `delta_mu`
  // (e.g. with WulffFacetEditor) and the shape follows live.
  import { InformationOutline } from 'svelte-widgets/icons'
  import ColorInput from 'svelte-widgets/ColorInput.svelte'
  import { format_num } from 'svelte-widgets/format'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import { to_error } from 'svelte-widgets/utils'
  import { css_color_to_hex } from '#lib/colors/index.js'
  import { normalize_show_controls, track_settings } from '#lib/controls.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { canvas_sources, json_source } from '#lib/io/export.js'
  import type { FileSaver } from '#lib/io/file-export.svelte.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import type { Matrix3x3 } from '#lib/math.js'
  import type { InfoPaneCard } from '#lib/overlays/index.js'
  import { ControlPane, ViewerPane } from '#lib/overlays/index.js'
  import InfoPaneCards from '#lib/overlays/InfoPaneCards.svelte'
  import { PlotTooltip } from '#lib/plot/index.js'
  import { reset_scene_cameras } from '#lib/scene/camera-reset.js'
  import { export_scene_as } from '#lib/scene/export.js'
  import CameraSection from '#lib/scene/CameraSection.svelte'
  import {
    create_renderer,
    key_walk_root,
    wheel_zoom_gate,
    webgpu_available,
  } from '#lib/scene/index.js'
  import { shortcut_attrs, viewer_keys } from '#lib/shortcuts.js'
  import type { Crystal } from '#lib/structure/index.js'
  import type { SymmetryDataset } from '#lib/symmetry/index.js'
  import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/index.js'
  import { mark_pin } from '#lib/tooltip/pin.svelte.js'
  import { Canvas } from '@threlte/core'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { compute_wulff_shape } from './compute'
  import { wulff_model } from './export'
  import { family_colors, family_label, format_fraction, plane_label } from './format'
  import type {
    WulffDisplaySettings,
    WulffFacetInput,
    WulffHover,
    WulffShapeData,
  } from './types'
  import { WULFF_DEFAULTS as defaults } from './types'
  import WulffScene from './WulffScene.svelte'

  let {
    facets,
    lattice,
    structure,
    delta_mu = 0,
    wulff_data = $bindable(),
    opacity = $bindable(defaults.opacity),
    edge_color = $bindable(defaults.edge_color),
    edge_width = $bindable(defaults.edge_width),
    show_axes = $bindable(defaults.show_axes),
    show_legend = $bindable(defaults.show_legend),
    camera_projection = $bindable(defaults.camera_projection),
    ...rest
  }: Partial<WulffDisplaySettings> & {
    // Surface energy (J/m²) per Miller family; each is expanded to its symmetry-equivalent planes
    facets: WulffFacetInput[]
    // Rows a, b, c in Å; expands families with the lattice holohedry (pymatgen's choice)
    lattice?: Matrix3x3
    // Crystal (instead of `lattice`) whose own point group, found with moyo, expands the
    // families, so a polar crystal keeps (hkl) and (h̄k̄l̄) apart
    structure?: Crystal
    // eV, the chemical potential of families with a slope: γ = energy + slope·delta_mu
    delta_mu?: number
    // Output: the computed shape, null while there is none (no lattice, invalid input)
    wulff_data?: WulffShapeData | null
  } & HTMLAttributes<HTMLDivElement> = $props()

  const cell = $derived(structure?.lattice?.matrix ?? lattice)
  let wrapper = $state<HTMLDivElement>()
  let [width, height] = $state([0, 0])
  let [controls_open, info_pane_open, export_pane_open] = $state([false, false, false])

  // The structure's point group; a result for a replaced structure never lands
  let symmetry = $state.raw<{ data?: SymmetryDataset; error?: unknown; of?: Crystal }>({})
  $effect(() => {
    symmetry = {}
    const of = structure
    if (!of?.lattice) return
    // aborting drops a superseded worker job; its rejection then never lands
    const controller = new AbortController()
    analyze_structure_symmetry(of, {}, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) symmetry = { data, of }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) symmetry = { error, of }
      },
    )
    return () => controller.abort()
  })

  // rotations undefined: compute_wulff_shape finds the lattice holohedry (inside its try)
  type PointGroupSource = { rotations?: Matrix3x3[]; label: string }
  const point_group_source = $derived.by((): PointGroupSource | { error: string } | null => {
    if (lattice && structure) return { error: `Pass either lattice or structure, not both` }
    if (!cell) return { error: `Wulff shape needs a lattice, or a structure with one` }
    if (!structure) return { label: `lattice holohedry` }
    if (`error` in symmetry) {
      return { error: `Symmetry analysis failed: ${to_error(symmetry.error).message}` }
    }
    if (!symmetry.data || symmetry.of !== structure) return null // still analyzing
    const { operations, hm_symbol, number } = symmetry.data
    return {
      // integer rotations of the structure's fractional coordinates, as compute_wulff_shape takes
      rotations: point_group_rotations(operations),
      label: `of space group ${hm_symbol.replaceAll(` `, ``)} (${number})`,
    }
  })

  const result = $derived.by((): { data?: WulffShapeData; error?: string } => {
    if (point_group_source && `error` in point_group_source) return point_group_source
    if (!point_group_source || !cell) return {}
    try {
      return {
        data: compute_wulff_shape(cell, facets, {
          point_group: point_group_source.rotations,
          delta_mu,
        }),
      }
    } catch (err) {
      return { error: to_error(err).message }
    }
  })
  $effect(() => {
    wulff_data = result.data ?? null
  })

  const colors = $derived(family_colors(facets))
  const pin = mark_pin<WulffHover>()
  let hovered = $state.raw<WulffHover | null>(null)
  const shown_hover = $derived(pin.shown(hovered))
  // another crystal's pin would name a plane of this one, at a stale screen position
  $effect(() => {
    void cell
    untrack(() => {
      hovered = null
      pin.unpin()
    })
  })
  // the hovered plane's facet in the current shape: gone once energies push it off the shape
  const shown_facet = $derived.by(() => {
    const miller = shown_hover?.miller.join(`,`)
    return result.data?.facets.find((facet) => facet.miller.join(`,`) === miller) ?? null
  })

  const info_cards = $derived.by((): InfoPaneCard[] => {
    const wulff = result.data
    if (!wulff || !point_group_source || `error` in point_group_source) return []
    const fmt = (val: number) => format_num(val, `.4~f`)
    return [
      {
        title: `Wulff shape`,
        rows: [
          { label: `γ̄ (area-weighted)`, value: `${fmt(wulff.weighted_surface_energy)} J/m²` },
          { label: `Shape factor`, value: fmt(wulff.shape_factor) },
          { label: `Anisotropy`, value: fmt(wulff.anisotropy) },
          {
            label: `Facets / Edges / Vertices`,
            value: `${wulff.facets.length} / ${wulff.edges.length} / ${wulff.vertices.length}`,
          },
          {
            label: `Point group`,
            value: `${point_group_source.label}, ${wulff.point_group.length} ops`,
          },
        ],
      },
      {
        title: `Families`,
        columns: [{ label: `γ (J/m²)` }, { label: `planes` }, { label: `area` }],
        rows: wulff.families.map((family) => ({
          label: family_label(family.miller),
          value: [
            fmt(family.energy),
            `${family.n_facets}/${family.multiplicity}`,
            format_num(family.area_fraction, `.2~%`),
          ],
        })),
      },
    ]
  })

  const display = track_settings(
    () => ({ opacity, show_axes, show_legend, edge_color, edge_width }),
    defaults,
  )
  const export_sources = $derived({
    ...canvas_sources(() => wrapper?.querySelector(`canvas`)),
    ...(result.data && {
      json: json_source(() => ({ lattice: cell, input: facets, ...result.data })),
    }),
  })
  // the shape alone (no edges or axes) as a 3D model
  const export_sections = [
    {
      title: `3D model`,
      items: (
        [
          [`STL`, `stl`, `3D printing`],
          [`GLB`, `glb`, `web/AR`],
        ] as const
      ).map(([label, format, hint]) => ({
        label,
        hint,
        on_download: ({ filename, save }: { filename: string; save: FileSaver }) =>
          result.data &&
          export_scene_as(wulff_model(result.data, colors), format, filename, save),
      })),
    },
  ]
  const keys = viewer_keys(() => ({
    i: () => {
      info_pane_open = !info_pane_open
    },
    r: () => reset_scene_cameras(wrapper),
    Escape: pin.unpin,
  }))
  const key_walk = key_walk_root() // the shape's facets, by keyboard (see KeyWalk)
  const wheel_gate = wheel_zoom_gate()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class:active={info_pane_open || controls_open || export_pane_open}
  role="application"
  tabindex="0"
  aria-label="Wulff shape viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`wulff-shape`, rest.class]}
  {@attach keys}
  {@attach key_walk.attach}
  {@attach wheel_gate}
>
  <LiveMessage message={key_walk.message} />
  {#if result.error}
    <ViewerError message={result.error} />
  {:else if !result.data}
    <TaskStatus overlay spinner label="Analyzing symmetry..." />
  {:else}
    {@const wulff = result.data}
    <ViewerChrome controls_config={normalize_show_controls(undefined)} {wrapper}>
      <ViewerPane
        bind:open={info_pane_open}
        pane_name="Wulff shape info"
        class_prefix="wulff-info"
        closed_icon={InformationOutline}
        toggle_props={shortcut_attrs(`info_pane`)}
        shortcut_scopes={[`viewer`, `camera`]}
      >
        <InfoPaneCards cards={info_cards} empty_label="Wulff shape info" />
      </ViewerPane>
      <ExportPane
        filename="wulff-shape"
        bind:export_pane_open
        sources={export_sources}
        sections={export_sections}
        toggle_props={{ title: export_pane_open ? `` : `Export Wulff shape` }}
      />
      <ControlPane
        bind:controls_open
        controls_name="wulff"
        toggle_title="Wulff shape"
        toggle_style=""
        pane_style="--ctrl-label-w: 7.5em; --ctrl-value-w: 3.5em;"
        toggle_props={{ title: `Wulff shape controls` }}
      >
        <SettingsSection
          title="Display"
          changed_keys={display.changed_keys}
          on_reset={() =>
            ({ opacity, show_axes, show_legend, edge_color, edge_width } = defaults)}
          layout="grid"
        >
          <label>
            <span>Opacity</span>
            <span>{format_num(opacity, `.2f`)}</span>
            <input type="range" min="0.1" max="1" step="0.01" bind:value={opacity} />
          </label>
          <label>
            <span>Crystal axes</span>
            <input type="checkbox" bind:checked={show_axes} />
          </label>
          <label>
            <span>Legend</span>
            <input type="checkbox" bind:checked={show_legend} />
          </label>
          <ColorInput
            label="Edge color"
            value={css_color_to_hex(edge_color, defaults.edge_color)}
            labels={{ picker: `Edge color`, hex: `Edge color hex` }}
            on_commit={(color) => (edge_color = color)}
          />
          <label>
            <span>Edge width</span>
            <span>{format_num(edge_width, `.3f`)}</span>
            <input type="range" min="0" max="0.02" step="0.001" bind:value={edge_width} />
          </label>
        </SettingsSection>
        <CameraSection
          bind:camera_projection
          default_projection={defaults.camera_projection}
        />
      </ControlPane>
    </ViewerChrome>

    {#if show_legend}
      {@const n_absent = wulff.families.filter(({ n_facets }) => n_facets === 0).length}
      <!-- families on the shape; absent ones only counted, the info pane lists them -->
      <ul class="legend">
        <!-- largest share of the surface first -->
        {#each wulff.families
          .map((family, idx) => ({ family, idx }))
          .filter(({ family }) => family.n_facets > 0)
          .toSorted((one, two) => two.family.area_fraction - one.family.area_fraction) as { family, idx } (idx)}
          <li>
            <span class="swatch" style:background={colors[idx]}></span>
            {family_label(family.miller)}
            <small>{format_fraction(family.area_fraction)}</small>
          </li>
        {/each}
        {#if n_absent > 0}<li class="absent">+{n_absent} absent</li>{/if}
      </ul>
    {/if}

    {#if webgpu_available()}
      <Canvas createRenderer={create_renderer} shadows={false}>
        <WulffScene
          {wulff}
          {colors}
          lattice={cell}
          {opacity}
          {edge_color}
          {edge_width}
          {show_axes}
          {camera_projection}
          {width}
          {height}
          bind:hovered
          {pin}
        />
      </Canvas>
      {#if shown_hover && shown_facet}
        {@const family = wulff.families[shown_facet.family_idx]}
        <PlotTooltip
          x={shown_hover.screen_position.x}
          y={shown_hover.screen_position.y}
          bg_color={colors[shown_facet.family_idx]}
          pinned={pin.value !== null}
          fixed
          style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1)"
        >
          <strong>{plane_label(shown_facet.miller)}</strong> in {family_label(family.miller)}
          <br />γ = {format_num(family.energy, `.4~f`)} J/m²
          <br />family: {format_num(family.area_fraction, `.2~%`)} of the surface ({family.n_facets}
          of {family.multiplicity} planes)
          <br />this facet: {format_num(shown_facet.area / wulff.surface_area, `.2~%`)}
        </PlotTooltip>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .wulff-shape {
    position: relative;
    container-type: size;
    height: var(--wulff-height, 500px);
    width: var(--wulff-width, 100%);
    background: var(--wulff-bg, var(--surface-bg));
    color: var(--wulff-text-color, var(--text-color));
  }
  .wulff-shape.active {
    z-index: var(--wulff-active-z-index, 2);
  }
  .wulff-shape:has(:global(.draggable-pane.pane-open)) {
    z-index: var(--z-index-viewer-pane-open, 12);
  }
  .wulff-shape:fullscreen {
    background: var(--wulff-bg-fullscreen, var(--surface-bg));
    overflow: hidden;
  }
  .legend {
    position: absolute;
    top: 0.5em;
    left: 0.5em;
    z-index: 1;
    margin: 0;
    padding: 0.3em 0.5em;
    list-style: none;
    font-size: 0.8em;
    line-height: 1.5;
    border-radius: 4px;
    background: var(--wulff-legend-bg, color-mix(in srgb, var(--surface-bg) 75%, transparent));
    pointer-events: none;
    li {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }
    li.absent {
      opacity: 0.45;
    }
    /* fixed-width digits in a fixed box, so the legend keeps its size while energies change */
    small {
      margin-left: auto;
      min-width: 3.4em;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .swatch {
      width: 0.8em;
      height: 0.8em;
      border-radius: 2px;
    }
  }
</style>
