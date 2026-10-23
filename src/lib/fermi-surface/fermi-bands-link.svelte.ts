// Links a Fermi surface to the band structure of the same calculation, bands matched by absolute
// index (band_indices, e.g. BXSF `BAND: n` → n − 1). Hovering a band point previews the surface
// at its energy and marks its k-point and branch on the 3D k-path (and vice versa); a click
// pins the energy as mu and isolates the band's sheet (click again for all). Band lines take
// their sheet's colour, and where they cross E_F (and the shown energy) is dotted on the bands
// (BandCrossings) and on the 3D k-path, where the path pierces the surface. Shared by
// FermiSurfaceBands and ElectronicStructure; without a band grid (no Fermi data, or a
// pre-meshed surface) only the k-path link remains.
import { css_var_names, resolve_color_token } from '#lib/colors/backdrop.svelte.js'
import type { Matrix3x3, Vec2 } from '#lib/math.js'
import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
import { DEFAULTS } from '#lib/settings.js'
import { band_point_meta, create_band_path_link } from '#lib/spectral/band-path-link.svelte.js'
import { band_crossings, band_line_style, BANDS_CSS_COLORS } from '#lib/spectral/helpers.js'
import type { BandsSpinMode, BaseBandStructure, LineKwargs } from '#lib/spectral/types.js'
import { watch_theme_changes } from '#lib/theme/index.js'
import { sheet_color } from './constants'
import type { BandGridJson, FermiSurfaceJson } from './parse'
import type {
  BandGridData,
  ColorProperty,
  FermiHoverData,
  FermiSurfaceData,
  SpinChannel,
} from './types'

export type BandCrossing = ReturnType<typeof band_crossings>[number] & {
  energy: number
  level: `fermi` | `reference`
}

export interface FermiBandsLinkInputs {
  band_data: () => BandGridData | BandGridJson | undefined
  surface: () => FermiSurfaceData | FermiSurfaceJson | undefined // FermiSurface's extracted one
  band_struct: () => BaseBandStructure | undefined // the one whose k-path the zone draws
  k_lattice: () => Matrix3x3 | undefined // the zone's reciprocal lattice (incl. 2π)
  mu: { get: () => number; set: (mu: number) => void }
  selected_bands: { get: () => number[] | undefined; set: (bands?: number[]) => void }
  band_spin_mode: () => BandsSpinMode | undefined // the caller's initial spin mode
  color_property: () => ColorProperty | undefined // the caller's initial colouring
  line_kwargs: () => LineKwargs | undefined // the caller's band styles
}

// Construct during a component's init. Hosts bind the fields (bind:mu={link.mu} etc.) and hand
// the handlers to FermiSurface's on_point_hover and Bands' on_point_hover / on_plot_click.
// Bands hover/click radius both hosts use: band lines are thin targets for previewing a surface
export const LINK_HOVER_CONFIG = { threshold_px: 50, click_threshold_px: 50 }

export class FermiBandsLink {
  // Bands' x_positions and the node its crossing dots render in (see BandCrossings)
  x_positions = $state.raw<Record<string, Vec2>>({})
  crossings_svg = $state<SVGSVGElement>()
  private hovered_band = $state<number | null>(null)
  // energy of the band (or DOS) point under the pointer, previewed until the pointer leaves
  hovered_energy = $state<number | null>(null)
  // The isolated band overrides the shown bands while set, so the controls' band syncing (on
  // every mu change) can neither end it nor write it into selected_bands; new data resets it
  private clicked_band = $derived.by((): number | null => {
    void this.inputs.band_data()
    return null
  })
  // Bands' spin control writes this; a hidden channel gets no crossings or sheets either
  band_spin_mode = $derived.by((): BandsSpinMode => this.inputs.band_spin_mode() ?? `overlay`)
  color_property = $derived.by(
    (): ColorProperty => this.inputs.color_property() ?? DEFAULTS.fermi.color_property,
  )
  readonly path = create_band_path_link({
    band_struct: () => this.inputs.band_struct(),
    k_lattice: () => this.inputs.k_lattice(),
    x_positions: () => this.x_positions,
  })
  // three.js parses neither var() nor light-dark(), so the 3D markers take Bands' E_F and
  // reference line colours resolved where the 2D dots resolve them (inside Bands, so a
  // caller's bands style applies to both), re-read on theme changes
  private level_rgb = $state({ fermi: `#e74c3c`, reference: `#d48860` })

  // bands the grid holds: only these have a Fermi surface to preview, pin or isolate
  private readonly grid_bands = $derived.by((): Set<number> => {
    const grid = this.inputs.band_data()
    return new Set(
      grid ? (grid.band_indices ?? grid.energies[0].map((_, band_idx) => band_idx)) : [],
    )
  })
  readonly fermi_energy = $derived.by(() => this.inputs.band_data()?.fermi_energy)
  private readonly shown_mu = $derived.by(() =>
    this.hovered_energy === null || this.fermi_energy === undefined
      ? this.inputs.mu.get()
      : this.hovered_energy - this.fermi_energy,
  )
  private readonly shown_bands = $derived.by(() =>
    this.clicked_band === null ? this.inputs.selected_bands.get() : [this.clicked_band],
  )
  private readonly only_spin = $derived.by((): `up` | `down` | null => {
    const mode = this.band_spin_mode
    return mode === `up_only` ? `up` : mode === `down_only` ? `down` : null
  })
  readonly selected_spins = $derived.by((): SpinChannel[] | undefined =>
    this.inputs.band_data()?.n_spins === 2 && this.only_spin ? [this.only_spin] : undefined,
  )
  // energy of the shown surface when it is not E_F, marked on the bands
  readonly reference_frequency = $derived(
    this.shown_mu === 0 || this.fermi_energy === undefined
      ? null
      : this.fermi_energy + this.shown_mu,
  )
  // the band emphasised on the plot: hovered (in either view), else isolated
  readonly highlighted_band = $derived(this.hovered_band ?? this.clicked_band)

  // Property mode colours sheets by vertex where the grid carries properties (every sheet
  // samples all of them), else the scene keeps flat sheet colours (which the band lines then
  // take). Read off the grid, not the shown surface, so previewing an energy without sheets
  // does not flip the band colours.
  readonly line_kwargs = $derived.by((): LineKwargs | undefined => {
    const grid = this.inputs.band_data()
    const kwargs = this.inputs.line_kwargs()
    const { color_property, grid_bands } = this
    const vertex_colored =
      color_property === `property` && Object.keys(grid?.properties ?? {}).length > 0
    if (!grid || vertex_colored) return kwargs
    const sheet_spin = (spin: `up` | `down`) => (grid.n_spins === 2 ? spin : null)
    // Each band line in its sheet's colour over the caller's style (grid bands only, the rest
    // muted unless the caller colours them). Electronic bands take a per-mode
    // (acoustic/optical) style's `optical`.
    return (band_idx, spin, structure) => {
      const style = band_line_style(kwargs ?? {}, band_idx, spin, false, structure)
      return {
        ...style,
        stroke: grid_bands.has(band_idx)
          ? sheet_color(band_idx, sheet_spin(spin), color_property)
          : (style.stroke ?? BANDS_CSS_COLORS.muted),
      }
    }
  })

  // E_F's own, so hovering (which previews other energies) neither recomputes nor replaces them
  private readonly fermi_crossings = $derived.by(() =>
    this.fermi_energy === undefined ? [] : this.crossings_at(this.fermi_energy, `fermi`),
  )
  readonly crossings = $derived(
    this.reference_frequency === null
      ? this.fermi_crossings
      : [...this.fermi_crossings, ...this.crossings_at(this.reference_frequency, `reference`)],
  )
  private readonly k_markers = $derived(
    this.crossings.map(({ k, level }) => ({ position: k, color: this.level_rgb[level] })),
  )
  // One object per path whose hover state are getters: a new object per hover would re-run
  // every KPath prop read, path-derived state included
  readonly k_path = $derived.by(() => {
    const { path } = this
    const k_markers = () => this.k_markers
    return (
      path.k_path && {
        path: path.k_path,
        get hovered_qpoint_index() {
          return path.active_qpoint
        },
        get highlighted_qpoint_range() {
          return path.highlighted_qpoint_range
        },
        on_kpath_hover: path.hover_path,
        get k_markers() {
          return k_markers()
        },
      }
    )
  })

  constructor(private readonly inputs: FermiBandsLinkInputs) {
    $effect(() => {
      const node = this.crossings_svg
      if (!node) return undefined
      const read = () => {
        this.level_rgb = {
          fermi: resolve_color_token(node, BANDS_CSS_COLORS.fermi),
          reference: resolve_color_token(node, BANDS_CSS_COLORS.reference),
        }
      }
      read()
      return watch_theme_changes(node, read, [
        ...css_var_names(BANDS_CSS_COLORS.fermi),
        ...css_var_names(BANDS_CSS_COLORS.reference),
      ])
    })
  }

  // FermiSurface's mu and selected_bands: the preview and the isolated band override what
  // the caller set, writes go to the caller (selected_bands unless a band is isolated)
  get mu(): number {
    return this.shown_mu
  }
  set mu(value: number) {
    this.inputs.mu.set(value)
  }
  get selected_bands(): number[] | undefined {
    return this.shown_bands
  }
  set selected_bands(bands: number[] | undefined) {
    if (this.clicked_band === null) this.inputs.selected_bands.set(bands)
  }

  // Where the shown sheets' bands (in the shown spin channels) cross `energy`
  private crossings_at(energy: number, level: BandCrossing[`level`]): BandCrossing[] {
    const k_points = this.path.k_path?.points
    const band_struct = this.inputs.band_struct()
    if (!k_points || !band_struct) return []
    const { grid_bands, shown_bands, only_spin } = this
    const include = (band_idx: number, spin: `up` | `down`) =>
      grid_bands.has(band_idx) &&
      (shown_bands?.includes(band_idx) ?? true) &&
      (only_spin ?? spin) === spin
    return band_crossings(band_struct, energy, k_points, this.x_positions, include).map(
      (crossing) => ({ ...crossing, energy, level }),
    )
  }

  readonly fermi_hover = (hover: FermiHoverData | null): void => {
    this.hovered_band = hover?.band_index ?? null
  }
  readonly band_hover = (event: ScatterHandlerEvent | null): void => {
    const point = band_point_meta(event?.point.metadata)
    this.hovered_band = point?.band_idx ?? null
    // only bands the grid holds have a surface to preview
    const in_grid = event && point && this.grid_bands.has(point.band_idx) ? event : null
    // without a grid the hovered k-point still shows on the path
    this.path.hover_band(this.grid_bands.size > 0 ? in_grid : event)
    this.hovered_energy = in_grid ? in_grid.point.y : null
  }
  // plot clicks reach the nearest band point within the tooltip's radius, so Bands keeps
  // plain lines (on_point_click would draw a marker per k-point)
  readonly band_click = (event: ScatterHandlerEvent): void => {
    const point = band_point_meta(event.point.metadata)
    const { fermi_energy } = this
    if (!point || !this.grid_bands.has(point.band_idx) || fermi_energy === undefined) return
    const has_sheet = this.inputs
      .surface()
      ?.isosurfaces.some((iso) => iso.band_index === point.band_idx)
    this.clicked_band =
      this.clicked_band !== point.band_idx && has_sheet ? point.band_idx : null
    this.inputs.mu.set(event.point.y - fermi_energy)
  }
}
