// HTML overlay label helpers for the 3D chemical potential diagram: tick label occlusion and
// composited PNG/SVG snapshots (plus GLB export)
import { canvas_overlay_png_blob, canvas_overlay_svg } from '#lib/io/export.js'
import type { FileSaver } from '#lib/io/file-export.svelte.js'
import { pad_rect, rects_overlap } from '#lib/plot/core/layout.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { export_scene_as } from '#lib/scene/index.js'
import * as THREE from 'three/webgpu'

interface XYZ {
  x: number
  y: number
  z: number
}

const xyz_tuple = (point?: XYZ | null): number[] | null =>
  point ? [point.x, point.y, point.z] : null

// Serializable snapshot of the current 3D view (embedded in SVG/JSON exports)
export function get_view_settings(opts: {
  elements: string[]
  camera_projection: string
  auto_rotate: number
  color_mode: string
  color_scale: ColorScale
  camera_position?: XYZ | null
  camera_target?: XYZ | null
  // an orthographic camera frames by zoom, not distance, so a snapshot without it is ambiguous
  orthographic_zoom?: number | null
}): Record<string, unknown> {
  const { camera_position, camera_target, ...settings } = opts
  return {
    ...settings,
    camera_position: xyz_tuple(camera_position),
    camera_target: xyz_tuple(camera_target),
  }
}

const is_shown = ({ display, visibility }: CSSStyleDeclaration): boolean =>
  display !== `none` && visibility !== `hidden`

// Hide the axis tick labels a shown domain label overlaps and return whether any are hidden.
// Runs every frame while the camera moves, so it reads every label's style and rect before
// writing any (no layout thrash) and writes only labels whose state flips (our own inline
// `hidden` is not mistaken for CSS hiding the label). Without a shown domain label it only
// restores the tick labels it hid earlier, measuring nothing.
export function occlude_tick_labels(wrapper: HTMLElement): boolean {
  const domain_rects = [...wrapper.querySelectorAll<HTMLElement>(`.domain-label`)]
    .filter((label) => is_shown(getComputedStyle(label)))
    .map((label) => pad_rect(label.getBoundingClientRect(), 1))
  const tick_labels = [...wrapper.querySelectorAll<HTMLElement>(`.axis-tick-label`)]
  const was_occluded = tick_labels.map(({ style }) => style.visibility === `hidden`)
  const occluded =
    domain_rects.length === 0
      ? tick_labels.map(() => false)
      : tick_labels.map((tick_label, idx) => {
          if (!was_occluded[idx] && !is_shown(getComputedStyle(tick_label))) return false
          const tick_rect = tick_label.getBoundingClientRect()
          return domain_rects.some((domain_rect) => rects_overlap(tick_rect, domain_rect))
        })
  for (const [idx, tick_label] of tick_labels.entries()) {
    if (occluded[idx] !== was_occluded[idx])
      tick_label.style.visibility = occluded[idx] ? `hidden` : ``
  }
  return occluded.includes(true)
}

// The 3D canvas and its HTML overlay labels (tick, axis and domain labels)
const canvas_and_labels = (wrapper: HTMLElement | undefined) =>
  [
    wrapper?.querySelector(`canvas`),
    [
      ...(wrapper?.querySelectorAll<HTMLElement>(`.tick-label, .axis-label, .domain-label`) ??
        []),
    ],
  ] as const

// The 3D canvas (re-rendered at `png_dpi`) with the HTML overlay labels drawn on top
export const chempot_png_blob = (wrapper: HTMLElement | undefined, png_dpi: number) =>
  canvas_overlay_png_blob(...canvas_and_labels(wrapper), png_dpi)

// SVG snapshot: the rendered canvas as an embedded image, overlay labels as real text nodes
// and the view settings as metadata
export async function chempot_svg_string(
  wrapper: HTMLElement | undefined,
  view_settings: Record<string, unknown>,
): Promise<string> {
  const svg = await canvas_overlay_svg(...canvas_and_labels(wrapper))
  const metadata = document.createElementNS(svg.namespaceURI, `metadata`)
  metadata.textContent = JSON.stringify(view_settings)
  svg.prepend(metadata)
  return `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(svg)}`
}

interface ChemPotGlbParts {
  hull_geometry: THREE.BufferGeometry | null
  hull_opacity: number
  edge_geometry: THREE.BufferGeometry
  formula_meshes: { geometry: THREE.BufferGeometry; color: string }[]
  formula_edges: { geometry: THREE.BufferGeometry; color: string }[]
}

// Rebuild the scene from its geometries and export as binary GLTF
export function export_glb_file(
  parts: ChemPotGlbParts,
  basename: string,
  save: FileSaver,
): Promise<void> {
  const { hull_geometry, hull_opacity, edge_geometry, formula_meshes, formula_edges } = parts
  const export_root = new THREE.Group()
  const add_mesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.MeshBasicMaterialParameters,
  ): void => {
    const opts = { transparent: true, side: THREE.DoubleSide, ...material }
    export_root.add(new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial(opts)))
  }
  const add_lines = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) =>
    export_root.add(
      new THREE.LineSegments(geometry.clone(), new THREE.LineBasicMaterial({ color })),
    )
  if (hull_geometry) add_mesh(hull_geometry, { vertexColors: true, opacity: hull_opacity })
  add_lines(edge_geometry, 0x333333)
  for (const { geometry, color } of formula_meshes)
    add_mesh(geometry, { color: new THREE.Color(color), opacity: 0.13 })
  for (const { geometry, color } of formula_edges) add_lines(geometry, new THREE.Color(color))
  return export_scene_as(export_root, `glb`, basename, save)
}
