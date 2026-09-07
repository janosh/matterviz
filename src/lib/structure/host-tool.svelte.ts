import type { Component, ComponentProps, Snippet } from 'svelte'
import type StructureScene from './StructureScene.svelte'
import type { VolumetricData } from '$lib/isosurface'
import type { AnyStructure } from './index'

// Host tools operate on the input cell. Their overlays are transient and never edit the
// caller's structure, including when a trajectory lends its current frame to the viewer.
export interface StructureToolOverlay {
  source: AnyStructure
  site_properties?: Record<string, unknown>[]
  volumes?: VolumetricData[]
  color_property?: string
}

// A host can lend a full-size view (for example a growing trajectory) without replacing
// the source structure or unmounting the tool that owns the computation.
export interface StructureToolViewProps {
  scene_props: ComponentProps<typeof StructureScene>
  supercell_scaling: string
  show_image_atoms: boolean
}
export interface StructureToolView {
  source: AnyStructure
  content: Snippet<[StructureToolViewProps]>
}

export interface StructureToolProps {
  structure: AnyStructure
  on_overlay: (overlay: StructureToolOverlay | null) => void
  on_view: (view: StructureToolView | null) => void
}

// A host registers once before mounting; this also reaches independently mounted file viewers.
export const structure_host_tool = $state<{
  component: Component<StructureToolProps> | null
}>({
  component: null,
})
