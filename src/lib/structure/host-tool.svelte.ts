import type { Component } from 'svelte'
import type { VolumetricData } from '$lib/isosurface'
import type { AnyStructure } from './index'

// Host tools operate on the input cell. Their overlays are transient and never edit the
// caller's structure, including when a trajectory lends its current frame to the viewer.
export interface StructureToolOverlay {
  source: AnyStructure
  site_properties?: Record<string, unknown>[]
  volumes?: VolumetricData[]
}

export interface StructureToolProps {
  structure: AnyStructure
  on_overlay: (overlay: StructureToolOverlay | null) => void
}

// A host registers once before mounting; this also reaches independently mounted file viewers.
export const structure_host_tool = $state<{
  component: Component<StructureToolProps> | null
}>({
  component: null,
})
