<script lang="ts">
  // A Fermi surface beside the band structure of the same calculation, bands matched by absolute
  // index (band_indices, e.g. BXSF `BAND: n` → n − 1). Hovering a band point previews the surface
  // at its energy and marks its k-point and branch on the 3D k-path (and vice versa); a click
  // pins the energy as mu and isolates the band's sheet (click again for all). Band lines take
  // their sheet's colour, and where they cross E_F (and the shown energy) is dotted on the bands
  // and on the 3D k-path, where the path pierces the surface.
  import PanelsFullscreenButton from '#lib/layout/PanelsFullscreenButton.svelte'
  import Bands from '#lib/spectral/Bands.svelte'
  import {
    band_point_meta,
    create_band_path_link,
  } from '#lib/spectral/band-path-link.svelte.js'
  import { band_crossings, band_line_style, BANDS_CSS_COLORS } from '#lib/spectral/helpers.js'
  import type { BandsSpinMode, BaseBandStructure, LineKwargs } from '#lib/spectral/types.js'
  import { resolve_color_token, watch_css_color } from '#lib/colors/backdrop.svelte.js'
  import { in_range } from '#lib/math.js'
  import type { Vec2 } from '#lib/math.js'
  import { DEFAULTS } from '#lib/settings.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { sheet_color } from './constants'
  import FermiSurface from './FermiSurface.svelte'
  import { vertex_property } from './geometry'
  import type { BandGridJson } from './parse'
  import type { BandGridData, FermiSurfaceData } from './types'

  let {
    band_data,
    band_struct,
    mu = $bindable(0),
    selected_bands = $bindable(),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    fermi_props = {},
    bands_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_data: BandGridData | BandGridJson
    band_struct: BaseBandStructure
    mu?: number
    selected_bands?: number[] // bands whose Fermi sheets are shown (all when unset)
    fullscreen?: boolean // both views fullscreen together (one button, in the bands' header)
    fullscreen_toggle?: boolean // also hidden by bands_props.show_controls
    // per-view extras; linked props (bands, mu, fermi_level, highlights, k-path) override them
    fermi_props?: ComponentProps<typeof FermiSurface>
    bands_props?: Partial<ComponentProps<typeof Bands>>
  } = $props()

  // the band structure's k-path in the grid's reciprocal space (same calculation and lattice)
  const link = create_band_path_link({
    band_struct: () => band_struct,
    k_lattice: () => band_data.k_lattice,
  })
  // bands the grid holds: only these have a Fermi surface to preview, pin or isolate
  const grid_bands = $derived(
    new Set(band_data.band_indices ?? band_data.energies[0].map((_, band_idx) => band_idx)),
  )

  let hovered_band = $state<number | null>(null)
  // energy of the band point under the pointer, previewed until the pointer leaves the bands
  let hovered_energy = $state<number | null>(null)
  const shown_mu = $derived(
    hovered_energy === null ? mu : hovered_energy - band_data.fermi_energy,
  )
  // The isolated band overrides the shown bands while set, so the controls' band syncing (on
  // every mu change) can neither end it nor write it into selected_bands; new data resets it
  let clicked_band = $derived.by((): number | null => {
    void band_data
    return null
  })
  const shown_bands = $derived(clicked_band === null ? selected_bands : [clicked_band])
  // Bands' spin control writes this; the hidden channel gets no crossings either
  let band_spin_mode = $derived<BandsSpinMode>(bands_props.band_spin_mode ?? `overlay`)
  let surface = $state.raw<FermiSurfaceData>()
  let wrapper = $state<HTMLDivElement>()
  let color_property = $derived(fermi_props.color_property ?? DEFAULTS.fermi.color_property)
  let x_positions = $state.raw<Record<string, Vec2>>({})

  // Property mode colours a sheet by vertex only where it carries a property, else the scene
  // keeps its flat sheet colour (which the band lines then take)
  const vertex_colored = $derived(
    color_property === `property` &&
      (surface?.isosurfaces ?? []).some((iso) =>
        Object.keys(iso.properties ?? {}).some((name) => vertex_property(iso, name)),
      ),
  )
  // Each band line in its sheet's colour over the caller's style (grid bands only, the rest
  // muted unless the caller colours them), unless the sheets are coloured by a property.
  // Electronic bands take a per-mode (acoustic/optical) style's `optical`.
  const line_kwargs = $derived.by((): LineKwargs | undefined => {
    const { line_kwargs: kwargs = {} } = bands_props
    if (vertex_colored) return bands_props.line_kwargs
    const sheet_spin = (spin: `up` | `down`) => (band_data.n_spins === 2 ? spin : null)
    return (band_idx, spin) => {
      const style = band_line_style(kwargs, band_idx, spin, false)
      return {
        ...style,
        stroke: grid_bands.has(band_idx)
          ? sheet_color(band_idx, sheet_spin(spin), color_property)
          : (style.stroke ?? BANDS_CSS_COLORS.muted),
      }
    }
  })
  // three.js parses neither var() nor light-dark(), so the 3D markers take Bands' E_F and
  // reference line colours resolved on the wrapper, re-read on theme changes
  let level_rgb = $state({ fermi: `#e74c3c`, reference: `#d48860` })
  $effect(() => {
    const node = wrapper
    if (!node) return
    const read = () => {
      level_rgb = {
        fermi: resolve_color_token(node, BANDS_CSS_COLORS.fermi),
        reference: resolve_color_token(node, BANDS_CSS_COLORS.reference),
      }
    }
    read()
    return watch_css_color(node, read)
  })
  // Where the shown sheets' bands (in the shown spin channels) cross E_F and the shown
  // surface's energy (if another), coloured like the bands plot's line at that energy: dots on
  // the bands, markers on the 3D k-path
  const crossings = $derived.by(() => {
    const k_points = link.k_path?.points
    if (!k_points) return []
    const levels: [number, `fermi` | `reference`][] = [[band_data.fermi_energy, `fermi`]]
    if (shown_mu !== 0) levels.push([band_data.fermi_energy + shown_mu, `reference`])
    const hidden_spin =
      band_spin_mode === `up_only` ? `down` : band_spin_mode === `down_only` ? `up` : null
    const include = (band_idx: number, spin: `up` | `down`) =>
      grid_bands.has(band_idx) &&
      (shown_bands?.includes(band_idx) ?? true) &&
      spin !== hidden_spin
    return levels.flatMap(([energy, level]) =>
      band_crossings(band_struct, energy, k_points, x_positions, include).map((crossing) => ({
        ...crossing,
        energy,
        level,
      })),
    )
  })
</script>

<div {...rest} bind:this={wrapper} class={[`fermi-surface-bands`, rest.class]}>
  <!-- caller props first: the link's handlers chain the caller's instead of being replaced -->
  <FermiSurface
    {...fermi_props}
    {band_data}
    fullscreen_toggle={false}
    bind:fermi_data={surface}
    bind:color_property
    wigner_seitz
    previewing={hovered_energy !== null}
    bind:mu={() => shown_mu, (value) => (mu = value)}
    bind:selected_bands={
      () => shown_bands,
      (bands) => {
        if (clicked_band === null) selected_bands = bands
      }
    }
    k_marker={link.hovered_k_point}
    k_path={link.k_path && {
      path: link.k_path,
      hovered_qpoint_index: link.active_qpoint,
      highlighted_qpoint_range: link.highlighted_qpoint_range,
      on_kpath_hover: link.hover_path,
      k_markers: crossings.map(({ k, level }) => ({ position: k, color: level_rgb[level] })),
    }}
    on_point_hover={(hover) => {
      hovered_band = hover?.band_index ?? null
      fermi_props.on_point_hover?.(hover)
    }}
  />
  <Bands
    {...bands_props}
    band_structs={{ bands: band_struct }}
    fullscreen_toggle={false}
    fermi_level={band_data.fermi_energy}
    {line_kwargs}
    bind:band_spin_mode
    bind:x_positions
    highlighted_band_index={hovered_band ?? clicked_band}
    highlighted_qpoint_index={link.active_qpoint}
    highlighted_qpoint_range={link.highlighted_qpoint_range}
    reference_frequency={shown_mu === 0 ? null : band_data.fermi_energy + shown_mu}
    hover_config={{ threshold_px: 50, click_threshold_px: 50, ...bands_props.hover_config }}
    on_point_hover={(event) => {
      const point = band_point_meta(event?.point.metadata)
      hovered_band = point?.band_idx ?? null
      // only bands the grid holds have a surface to preview
      const in_grid = event && point && grid_bands.has(point.band_idx) ? event : null
      link.hover_band(in_grid)
      hovered_energy = in_grid ? in_grid.point.y : null
      bands_props.on_point_hover?.(event)
    }}
    on_plot_click={(event) => {
      // plot clicks reach the nearest band point within the tooltip's radius, so Bands keeps
      // plain lines (on_point_click would draw a marker per k-point)
      const point = band_point_meta(event.point.metadata)
      if (point && grid_bands.has(point.band_idx)) {
        const has_sheet = surface?.isosurfaces.some((iso) => iso.band_index === point.band_idx)
        const isolate = clicked_band !== point.band_idx && has_sheet
        clicked_band = isolate ? point.band_idx : null
        mu = event.point.y - band_data.fermi_energy
      }
      bands_props.on_plot_click?.(event)
    }}
  >
    {#snippet children(ctx)}
      {@render bands_props.children?.(ctx)}
      <svg class="band-crossings" width={ctx.width} height={ctx.height}>
        {#each crossings as { x, energy, level }, idx (idx)}
          {#if in_range(x, ctx.x_range) && in_range(energy, ctx.y_range)}
            <circle
              cx={ctx.x_scale_fn(x)}
              cy={ctx.y_scale_fn(energy)}
              r="3"
              fill={BANDS_CSS_COLORS[level]}
              stroke="var(--page-bg, white)"
            />
          {/if}
        {/each}
      </svg>
    {/snippet}
    {#snippet header_controls(dims)}
      {@render bands_props.header_controls?.(dims)}
      <PanelsFullscreenButton
        bind:fullscreen
        toggle={fullscreen_toggle}
        controls={bands_props.show_controls}
        {wrapper}
      />
    {/snippet}
  </Bands>
</div>

<style>
  .band-crossings {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .fermi-surface-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: var(--fermi-bands-gap, 1em);
    &:fullscreen {
      padding: 1em;
      background: var(--fullscreen-bg, var(--page-bg, Canvas));
      > :global(*) {
        height: 100%;
        min-height: 0;
      }
    }
  }
</style>
