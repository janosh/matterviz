// One dispatch table from a detected data type to the viewer component that renders it,
// shared by the webview entry (main.ts create_display) and JsonBrowser panels so the two
// can never drift apart in which props each viewer receives.
import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import ConvexHull from '#lib/convex-hull/ConvexHull.svelte'
import type { PhaseData } from '#lib/convex-hull/types'
import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types'
import { is_fermi_surface_data } from '#lib/fermi-surface/types'
import {
  auto_isosurface_settings,
  DEFAULT_ISOSURFACE_SETTINGS,
  type VolumetricFileData,
} from '#lib/isosurface/types'
import IsobaricBinaryPhaseDiagram from '#lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import type { BinaryPhaseDiagram } from '#lib/phase-diagram/types'
import { build_structure_props_from_settings, type DefaultSettings } from '#lib/settings'
import Bands from '#lib/spectral/Bands.svelte'
import BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
import Dos from '#lib/spectral/Dos.svelte'
import { normalize_band_structure, normalize_dos } from '#lib/spectral/helpers'
import type { BaseBandStructure, DosData } from '#lib/spectral/types'
import type { AnyStructure } from '#lib/structure/index'
import type { StructureToolPrediction } from '#lib/structure/prediction'
import Structure from '#lib/structure/Structure.svelte'
import type { XrdPattern } from '#lib/xrd/index'
import XrdPlot from '#lib/xrd/XrdPlot.svelte'
import { mount } from 'svelte'
import type { RenderableType } from './detect'
import PlotPanel from './PlotPanel.svelte'

// `volumetric` JSON is normalised by the caller into a VolumetricFileData before mounting
export type ViewerMountType = Exclude<RenderableType, `volumetric`> | `isosurface`

export interface MountViewerOptions {
  prediction?: StructureToolPrediction
  // A parsed structure/volumetric file's recoverable warnings, shown by Structure as a notice
  parse_warnings?: string[]
  defaults: DefaultSettings
  // Closes the hosting panel (JsonBrowser); viewers without a close affordance ignore it
  on_close?: () => void
}

// Every embedded viewer fills its host; its fullscreen toggle follows host.fullscreen
export const VIEWER_COMMON_PROPS = { style: `height: 100%; border-radius: 0` } as const

// Bands, DOS or both side by side, whichever is given, padded to fit their axes
export function mount_spectral(
  target: HTMLElement,
  { bands, dos }: { bands: BaseBandStructure | null; dos: DosData | null },
  props: { style: string; class?: string },
): ReturnType<typeof mount> {
  if (bands && dos) {
    const both = { band_structs: { '': bands }, doses: { '': dos }, ...props }
    return mount(BandsAndDos, { target, props: both })
  }
  if (bands) return mount(Bands, { target, props: { band_structs: { '': bands }, ...props } })
  if (dos) return mount(Dos, { target, props: { doses: { '': dos }, ...props } })
  throw new Error(`No bands or DOS to plot`)
}

// Mount the viewer for `type` into `target` and return the component handle. Throws on a
// type this table does not know so a new RenderableType cannot silently render nothing.
export function mount_viewer(
  target: HTMLElement,
  type: ViewerMountType,
  data: unknown,
  { defaults, on_close, prediction, parse_warnings }: MountViewerOptions,
): ReturnType<typeof mount> {
  target.innerHTML = ``
  void target.offsetHeight // force layout so Three.js measures real dimensions
  // The outer file viewer (main.ts) owns drops; nested viewers still expose their drop API
  // standalone
  const no_file_drop = { ...VIEWER_COMMON_PROPS, allow_file_drop: false }
  const structure_props = {
    ...build_structure_props_from_settings(defaults),
    ...no_file_drop,
    persist_settings: false,
  }

  if (type === `structure`) {
    return mount(Structure, {
      target,
      props: {
        structure: data as AnyStructure,
        prediction,
        parse_warnings,
        ...structure_props,
      },
    })
  }
  if (type === `isosurface`) {
    const { structure, volumes } = data as VolumetricFileData
    const [first_volume] = volumes
    if (!first_volume) throw new Error(`mount_viewer: volumetric data has no volumes`)
    // The host's isosurface finish applies; the first volume only supplies the layers
    const isosurface_settings = auto_isosurface_settings(first_volume, {
      ...DEFAULT_ISOSURFACE_SETTINGS,
      ...defaults.isosurface,
    })
    return mount(Structure, {
      target,
      props: {
        structure,
        volumetric_data: volumes,
        isosurface_settings,
        parse_warnings,
        ...structure_props,
      },
    })
  }
  if (type === `fermi_surface` || type === `band_grid`) {
    const fermi_props = is_fermi_surface_data(data as FermiSurfaceData | BandGridData)
      ? { fermi_data: data as FermiSurfaceData }
      : { band_data: data as BandGridData }
    // color_property stays unset so per-state data colors by its first property by default.
    const { color_property: _property, ...fermi_defaults } = defaults.fermi
    return mount(FermiSurface, {
      target,
      props: { ...fermi_defaults, ...fermi_props, ...no_file_drop },
    })
  }
  if (type === `convex_hull`) {
    return mount(ConvexHull, {
      target,
      props: { entries: data as PhaseData[], ...no_file_drop },
    })
  }
  if (type === `phase_diagram`) {
    return mount(IsobaricBinaryPhaseDiagram, {
      target,
      props: { data: data as BinaryPhaseDiagram, ...VIEWER_COMMON_PROPS },
    })
  }
  if (type === `bands_and_dos` || type === `band_structure` || type === `dos`) {
    const record = data as Record<string, unknown>
    const bands =
      type === `dos` ? null : normalize_band_structure(record.band_structure ?? data)
    const dos = type === `band_structure` ? null : normalize_dos(record.dos ?? data)
    if (type !== `dos` && !bands) throw new Error(`Invalid band structure data`)
    if (type !== `band_structure` && !dos) throw new Error(`Invalid DOS data`)
    return mount_spectral(target, { bands, dos }, VIEWER_COMMON_PROPS)
  }
  if (type === `brillouin_zone`) {
    const { structure, k_lattice, reciprocal_lattice, bz_order, vertices, faces } =
      data as Record<string, unknown>
    // detect_view_type accepts a bare {k_lattice | reciprocal_lattice, ...} document, which
    // without its lattice handed over showed the empty "Drop Structure File" state
    const bz_props: Record<string, unknown> = {
      ...defaults.brillouin,
      ...no_file_drop,
      structure,
      k_lattice: k_lattice ?? reciprocal_lattice,
      // passed through unchecked: an order outside 1-3 shows BrillouinZone's error
      ...(bz_order !== undefined && { bz_order }),
    }
    if (vertices && faces) bz_props.bz_data = data
    return mount(BrillouinZone, { target, props: bz_props })
  }
  if (type === `xrd`) {
    return mount(XrdPlot, { target, props: { patterns: data as XrdPattern, ...no_file_drop } })
  }
  if (type === `table` || type === `plot`) {
    // PlotPanel declares no rest props, so the shared style prop is not passed
    return mount(PlotPanel, {
      target,
      props: { data, ...(type === `table` && { initial_type: `table` as const }), on_close },
    })
  }
  throw new Error(`mount_viewer: no viewer registered for type ${type}`)
}
