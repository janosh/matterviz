// Export helpers for chemical potential diagrams (shared between 2D and 3D views).
import { download } from '$lib/io/fetch'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export const get_json_string = (payload: unknown): string => JSON.stringify(payload, null, 2)

export const export_json_file = (payload: unknown, basename: string): void =>
  download(get_json_string(payload), `${basename}.json`, `application/json`)

interface XYZ {
  x: number
  y: number
  z: number
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
}): Record<string, unknown> {
  const { camera_position, camera_target, ...settings } = opts
  return {
    ...settings,
    camera_position: camera_position
      ? [camera_position.x, camera_position.y, camera_position.z]
      : null,
    camera_target: camera_target ? [camera_target.x, camera_target.y, camera_target.z] : null,
  }
}

export const export_view_json_file = (
  view_settings: Record<string, unknown>,
  basename: string,
): void =>
  download(get_json_string(view_settings), `${basename}-view.json`, `application/json`)

export interface OverlayTextItem {
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
export function get_overlay_text_items(
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

// Composite the WebGL canvas + HTML overlay labels into a single PNG download
export function export_png_file(
  wrapper: HTMLElement | undefined,
  basename: string,
  png_dpi: number,
): void {
  if (!wrapper) return
  const gl_canvas = wrapper.querySelector(`canvas`)
  if (!(gl_canvas instanceof HTMLCanvasElement)) return

  const rect = gl_canvas.getBoundingClientRect()
  const scale = Math.min(png_dpi / 72, 10)
  const out = document.createElement(`canvas`)
  out.width = Math.round(rect.width * scale)
  out.height = Math.round(rect.height * scale)
  const ctx = out.getContext(`2d`)
  if (!ctx) return
  ctx.scale(scale, scale)

  // Draw the WebGL canvas as background
  ctx.drawImage(gl_canvas, 0, 0, rect.width, rect.height)

  // Draw all HTML overlay text (tick labels, axis labels, domain labels)
  for (const text_item of get_overlay_text_items(wrapper, rect)) {
    ctx.font = text_item.font
    ctx.fillStyle = text_item.color
    ctx.textAlign = `center`
    ctx.textBaseline = `middle`
    ctx.fillText(text_item.text, text_item.x, text_item.y)
  }

  out.toBlob((blob) => {
    if (!blob) return
    download(blob, `${basename}.png`, `image/png`)
  }, `image/png`)
}

const xml_escape = (text: string): string =>
  text
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)

// SVG snapshot: rasterized canvas as embedded image + overlay labels as real text nodes
export function export_svg_file(
  wrapper: HTMLElement | undefined,
  basename: string,
  view_settings: Record<string, unknown>,
): void {
  if (!wrapper) return
  const gl_canvas = wrapper.querySelector(`canvas`)
  if (!(gl_canvas instanceof HTMLCanvasElement)) return
  const canvas_rect = gl_canvas.getBoundingClientRect()
  if (canvas_rect.width === 0 || canvas_rect.height === 0) return
  const png_data_url = gl_canvas.toDataURL(`image/png`)
  const text_nodes = get_overlay_text_items(wrapper, canvas_rect).map(
    (text_item) =>
      `<text x="${text_item.x.toFixed(2)}" y="${text_item.y.toFixed(
        2,
      )}" text-anchor="middle" dominant-baseline="central" fill="${xml_escape(
        text_item.color,
      )}" font-size="${xml_escape(text_item.font_size)}" font-family="${xml_escape(
        text_item.font_family,
      )}" font-weight="${xml_escape(text_item.font_weight)}">${xml_escape(
        text_item.text,
      )}</text>`,
  )
  const metadata = xml_escape(JSON.stringify(view_settings))
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas_rect.width}" height="${canvas_rect.height}" viewBox="0 0 ${canvas_rect.width} ${canvas_rect.height}">`,
    `<metadata>${metadata}</metadata>`,
    `<image href="${png_data_url}" x="0" y="0" width="${canvas_rect.width}" height="${canvas_rect.height}" />`,
    ...text_nodes,
    `</svg>`,
  ].join(``)
  download(svg, `${basename}.svg`, `image/svg+xml`)
}

export interface ChemPotGlbParts {
  hull_geometry?: THREE.BufferGeometry | null
  hull_opacity?: number
  edge_geometry: THREE.BufferGeometry
  formula_meshes?: { geometry: THREE.BufferGeometry; color: string }[]
  formula_edges?: { geometry: THREE.BufferGeometry; color: string }[]
}

// Rebuild the scene from its geometries and export as binary GLTF
export function export_glb_file(parts: ChemPotGlbParts, basename: string): void {
  const {
    hull_geometry,
    hull_opacity = 0.25,
    edge_geometry,
    formula_meshes = [],
    formula_edges = [],
  } = parts
  const gltf_exporter = new GLTFExporter()
  const export_root = new THREE.Group()
  if (hull_geometry) {
    export_root.add(
      new THREE.Mesh(
        hull_geometry.clone(),
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: hull_opacity,
          side: THREE.DoubleSide,
        }),
      ),
    )
  }
  export_root.add(
    new THREE.LineSegments(
      edge_geometry.clone(),
      new THREE.LineBasicMaterial({ color: 0x333333 }),
    ),
  )
  for (const { geometry, color } of formula_meshes) {
    export_root.add(
      new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.13,
          side: THREE.DoubleSide,
        }),
      ),
    )
  }
  for (const { geometry, color } of formula_edges) {
    export_root.add(
      new THREE.LineSegments(
        geometry.clone(),
        new THREE.LineBasicMaterial({ color: new THREE.Color(color) }),
      ),
    )
  }
  gltf_exporter.parse(
    export_root,
    (result) => {
      if (!(result instanceof ArrayBuffer)) return
      download(result, `${basename}.glb`, `model/gltf-binary`)
    },
    (err) => {
      console.error(`Failed to export GLB:`, err)
    },
    { binary: true, onlyVisible: false },
  )
}
