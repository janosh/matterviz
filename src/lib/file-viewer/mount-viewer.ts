// One dispatch table from a detected data type to the viewer component that renders it,
// shared by the webview entry (main.ts create_display) and JsonBrowser panels so the two
// can never drift apart in which props each viewer receives.
import BrillouinZone from '$lib/brillouin/BrillouinZone.svelte'
import ConvexHull from '$lib/convex-hull/ConvexHull.svelte'
import type { PhaseData } from '$lib/convex-hull/types'
import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import {
  type BandGridData,
  type FermiSurfaceData,
  is_fermi_surface_data,
} from '$lib/fermi-surface/types'
import type { VolumetricFileData } from '$lib/isosurface/types'
import IsobaricBinaryPhaseDiagram from '$lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import type { PhaseDiagramData } from '$lib/phase-diagram/types'
import { build_structure_props_from_settings, type DefaultSettings } from '$lib/settings'
import Bands from '$lib/spectral/Bands.svelte'
import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import Dos from '$lib/spectral/Dos.svelte'
import type { BaseBandStructure, DosInput } from '$lib/spectral/types'
import type { AnyStructure } from '$lib/structure'
import Structure from '$lib/structure/Structure.svelte'
import type { XrdPattern } from '$lib/xrd'
import XrdPlot from '$lib/xrd/XrdPlot.svelte'
import { mount } from 'svelte'
import type { RenderableType } from './detect'
import PlotPanel from './PlotPanel.svelte'

// `volumetric` JSON is normalised by the caller into a VolumetricFileData before mounting
export type ViewerMountType = Exclude<RenderableType, `volumetric`> | `isosurface`

export interface MountViewerOptions {
  defaults: DefaultSettings
  // Closes the hosting panel (JsonBrowser); viewers without a close affordance ignore it
  on_close?: () => void
}

// Mount the viewer for `type` into `target` and return the component handle. Throws on a
// type this table does not know so a new RenderableType cannot silently render nothing.
export function mount_viewer(
  target: HTMLElement,
  type: ViewerMountType,
  data: unknown,
  { defaults, on_close }: MountViewerOptions,
): ReturnType<typeof mount> {
  target.innerHTML = ``
  void target.offsetHeight // force layout so Three.js measures real dimensions
  const common_props = { style: `height: 100%; border-radius: 0`, fullscreen_toggle: false }
  // Only viewers with a drop zone declare allow_file_drop; elsewhere it would land on the div
  const no_file_drop = { ...common_props, allow_file_drop: false }
  const structure_props = {
    ...build_structure_props_from_settings(defaults),
    ...no_file_drop,
    persist_settings: false,
  }

  if (type === `structure`) {
    return mount(Structure, {
      target,
      props: { structure: data as AnyStructure, ...structure_props },
    })
  }
  if (type === `isosurface`) {
    const { structure, volumes } = data as VolumetricFileData
    return mount(Structure, {
      target,
      props: { structure, volumetric_data: volumes, ...structure_props },
    })
  }
  if (type === `fermi_surface` || type === `band_grid`) {
    const fermi_props = is_fermi_surface_data(data as FermiSurfaceData | BandGridData)
      ? { fermi_data: data as FermiSurfaceData }
      : { band_data: data as BandGridData }
    return mount(FermiSurface, { target, props: { ...fermi_props, ...no_file_drop } })
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
      props: { data: data as PhaseDiagramData, ...common_props },
    })
  }
  if (type === `bands_and_dos`) {
    // Support both { band_structure, dos } wrapper and combined-fields format
    const record = data as Record<string, unknown>
    return mount(BandsAndDos, {
      target,
      props: {
        band_structs: (record.band_structure ?? data) as BaseBandStructure,
        doses: (record.dos ?? data) as DosInput,
        ...common_props,
      },
    })
  }
  if (type === `band_structure`) {
    return mount(Bands, {
      target,
      props: { band_structs: data as BaseBandStructure, ...common_props, padding: { b: 60 } },
    })
  }
  if (type === `dos`) {
    return mount(Dos, {
      target,
      props: { doses: data as DosInput, ...common_props, padding: { b: 60 } },
    })
  }
  if (type === `brillouin_zone`) {
    const record = data as Record<string, unknown>
    const bz_props: Record<string, unknown> = { ...no_file_drop }
    if (record.structure) bz_props.structure = record.structure
    // Pass pre-computed BZ data (vertices, faces, edges) if present
    if (record.vertices && record.faces) bz_props.bz_data = data
    return mount(BrillouinZone, { target, props: bz_props })
  }
  if (type === `xrd`) {
    return mount(XrdPlot, {
      target,
      props: { patterns: data as XrdPattern, ...no_file_drop },
    })
  }
  if (type === `table` || type === `plot`) {
    // PlotPanel declares no rest props, so the shared style/fullscreen props are not passed
    return mount(PlotPanel, {
      target,
      props: { data, ...(type === `table` && { initial_type: `table` as const }), on_close },
    })
  }
  throw new Error(`mount_viewer: no viewer registered for type ${String(type)}`)
}
