import type { ShowControlsProp } from '#lib/controls'
import type { ExportProps } from '#lib/io/export'
import type { SceneControlProps } from '#lib/scene/props.svelte'
import type { HTMLAttributes } from 'svelte/elements'

// Props every 3D viewer (Structure, Trajectory, BrillouinZone, FermiSurface, WulffShape) takes.
// on_fullscreen_change receives `FullscreenData` plus the new `fullscreen` state.
export type Viewer3DProps<ControlName extends string, FullscreenData> = Omit<
  HTMLAttributes<HTMLDivElement>,
  `children`
> & {
  // `always`, `hover`, `never` (or a boolean), or `{ mode, hidden, style }` where `hidden` drops
  // named controls, e.g. `hidden: ['fullscreen']` or `['info-pane']`
  show_controls?: ShowControlsProp<ControlName>
  fullscreen?: boolean // whether the viewer fills the screen
  on_fullscreen_change?: (data: FullscreenData & { fullscreen: boolean }) => void
  wrapper?: HTMLDivElement // the viewer's root element
  width?: number // output: wrapper width in CSS px
  height?: number // output: wrapper height in CSS px
  hovered?: boolean // output: true while the pointer is over the viewer
}

// The single-scene viewers (BrillouinZone, FermiSurface, WulffShape) also share a settings
// pane, an export pane and scene controls. Structure and Trajectory keep camera and lighting in
// `scene_props` (StructureSettings), which their controls pane edits and persists.
export type SceneViewerProps<ControlName extends string, FullscreenData> = Viewer3DProps<
  ControlName,
  FullscreenData
> &
  ExportProps & {
    controls_open?: boolean // whether the settings pane is open
    png_dpi?: number // resolution in dots per inch of PNG exports
    // Camera, lighting and interaction options of the scene, e.g. { gizmo: false }; not the
    // scene, camera or projection the viewer binds or sets itself
    scene_controls?: Omit<SceneControlProps, `scene` | `camera` | `camera_projection`>
  }
