// Export helpers for the 3D chemical potential diagram: composited PNG/SVG snapshots and GLB.
import { canvas_to_png_blob, dpi_to_scale, paint_png_blob } from '#lib/io/export.js'
import { blob_to_data_url } from '#lib/io/fetch.js'
import type { FileSaver } from '#lib/io/file-export.svelte.js'
import { export_scene_as } from '#lib/scene/index.js'
import { escape_html as xml_escape } from '#lib/utils.js'
import * as THREE from 'three/webgpu'

interface XYZ {
  x: number
  y: number
  z: number
}

const xyz_tuple = (point?: XYZ | null): number[] | null =>
  point ? [point.x, point.y, point.z] : null

const get_gl_canvas = (wrapper: HTMLElement | undefined): HTMLCanvasElement | null => {
  const canvas = wrapper?.querySelector(`canvas`)
  return canvas instanceof HTMLCanvasElement ? canvas : null
}

// Serializable snapshot of the current 3D view (embedded in SVG/JSON exports)
export function get_view_settings(opts: {
  elements: string[]
  camera_projection: string
  auto_rotate: number
  color_mode: string
  color_scale: string
  reverse_color_scale: boolean
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

interface OverlayTextItem {
  x: number
  y: number
  text: string
  font: string
  font_size: string
  font_family: string
  font_weight: string
  color: string
}

// Collect HTML overlay text (tick/axis/domain labels) positioned relative to the canvas
function get_overlay_text_items(
  wrapper: HTMLElement,
  canvas_rect: DOMRect,
): OverlayTextItem[] {
  const text_items: OverlayTextItem[] = []
  for (const element of wrapper.querySelectorAll(`.tick-label, .axis-label, .domain-label`)) {
    const html_element = element as HTMLElement
    const style = getComputedStyle(html_element)
    if (style.display === `none` || style.visibility === `hidden`) continue
    const element_rect = html_element.getBoundingClientRect()
    text_items.push({
      x: element_rect.left + element_rect.width / 2 - canvas_rect.left,
      y: element_rect.top + element_rect.height / 2 - canvas_rect.top,
      text: html_element.textContent ?? ``,
      font: style.font || `${style.fontSize} ${style.fontFamily}`,
      font_size: style.fontSize || `11px`,
      font_family: style.fontFamily || `sans-serif`,
      font_weight: style.fontWeight || `400`,
      color: style.color || `#333`,
    })
  }
  return text_items
}

// The 3D canvas, throwing when it is missing or has zero size (hidden/unrendered)
function require_canvas(wrapper: HTMLElement | undefined): {
  canvas: HTMLCanvasElement
  rect: DOMRect
  wrapper: HTMLElement
} {
  const canvas = get_gl_canvas(wrapper)
  const rect = canvas?.getBoundingClientRect()
  if (!canvas || !wrapper || !rect || !(rect.width > 0) || !(rect.height > 0))
    throw new Error(`Chemical potential diagram has no rendered canvas to export`)
  return { canvas, rect, wrapper }
}

// The 3D canvas (re-rendered at `png_dpi`) with the HTML overlay labels drawn on top
export async function chempot_png_blob(
  wrapper: HTMLElement | undefined,
  png_dpi: number,
): Promise<Blob> {
  const { canvas, rect, wrapper: root } = require_canvas(wrapper)
  const frame = await createImageBitmap(await canvas_to_png_blob(canvas, png_dpi))
  return paint_png_blob(rect.width, rect.height, dpi_to_scale(png_dpi), (ctx) => {
    ctx.drawImage(frame, 0, 0, rect.width, rect.height)
    frame.close()
    ctx.textAlign = `center`
    ctx.textBaseline = `middle`
    for (const text_item of get_overlay_text_items(root, rect)) {
      ctx.font = text_item.font
      ctx.fillStyle = text_item.color
      ctx.fillText(text_item.text, text_item.x, text_item.y)
    }
  })
}

// SVG snapshot: the rendered canvas as an embedded image, overlay labels as real text nodes
// and the view settings as metadata
export async function chempot_svg_string(
  wrapper: HTMLElement | undefined,
  view_settings: Record<string, unknown>,
): Promise<string> {
  const { canvas, rect, wrapper: root } = require_canvas(wrapper)
  const frame_url = await blob_to_data_url(await canvas_to_png_blob(canvas))
  const text_nodes = get_overlay_text_items(root, rect).map(
    ({ x, y, color, font_size, font_family, font_weight, text }) =>
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" fill="${xml_escape(color)}" font-size="${xml_escape(font_size)}" font-family="${xml_escape(font_family)}" font-weight="${xml_escape(font_weight)}">${xml_escape(text)}</text>`,
  )
  const metadata = xml_escape(JSON.stringify(view_settings))
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}" viewBox="0 0 ${rect.width} ${rect.height}">`,
    `<metadata>${metadata}</metadata>`,
    `<image href="${frame_url}" x="0" y="0" width="${rect.width}" height="${rect.height}" />`,
    ...text_nodes,
    `</svg>`,
  ].join(``)
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
