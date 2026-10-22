import { DEFAULT_PNG_DPI, DEFAULT_VIDEO_RESOLUTION } from '#lib/constants.js'
import { download, type DownloadData } from 'svelte-widgets/download'
import type { FileSaver } from './file-export.svelte'
import type { ExportItem, ExportPaneContext, ExportSection } from './types'
import { clamp } from '#lib/math.js'
import { canvas_painters, unique_id } from '#lib/plot/core/utils.js'
import { abortable } from '#lib/utils.js'
import { to_error } from 'svelte-widgets/utils'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { Vector2, PerspectiveCamera, OrthographicCamera } from 'three/webgpu'
import { create_camera_flight_sampler, type CameraFlight } from '#lib/scene/camera-flight.js'
import { set_pan_offset } from '#lib/scene/pan.js'

// Maps a Threlte canvas to its renderer so PNG export can look up the renderer for a
// given canvas without mutating the DOM element. Populated by bind_renderer (scene/).
export const renderer_registry = new WeakMap<HTMLCanvasElement, WebGPURenderer>()

// Companion scene+camera mapping: the drawing buffer is cleared after present, so any
// capture of a live canvas must re-render it first — which needs the scene and active camera.
export const scene_registry = new WeakMap<
  HTMLCanvasElement,
  { scene: Scene; camera: Camera }
>()

// PNG DPI -> render scale relative to the 72 DPI baseline, capped at 10x. DPI floors
// at 1 (non-finite -> 72) so bad inputs can't yield 0x0 canvases or NaN pixel ratios.
export const dpi_to_scale = (png_dpi: number): number =>
  clamp(Number.isFinite(png_dpi) ? png_dpi : 72, 1, 720) / 72

const device_timeout_ms = 5000
// Encoding cost grows with image pixels or recording size, but stalled exports stay bounded.
const export_timeout_ms = (estimated_megabytes: number): number =>
  Math.min(300_000, 30_000 + estimated_megabytes * 1000)

async function with_timeout<Value>(
  operation: () => Promise<Value>,
  timeout_ms: number,
  message: string,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${message} timed out after ${timeout_ms}ms`)),
          timeout_ms,
        )
      }),
    ])
  } catch (error) {
    throw to_error(error)
  } finally {
    clearTimeout(timer)
  }
}

const canvas_to_blob = (
  canvas: HTMLCanvasElement,
  failure_message = `Failed to generate PNG blob`,
): Promise<Blob> =>
  with_timeout(
    () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error(failure_message))),
          `image/png`,
        )
      }),
    export_timeout_ms((canvas.width * canvas.height * 4) / 1e6),
    `${failure_message}: toBlob`,
  )

// Wait for the GPU device, but never indefinitely: an unfulfilled device request would leave
// the export promise pending forever, giving the user neither a file nor an error.
// init() caches its own promise, so repeat calls are free.
export async function wait_for_renderer(renderer: WebGPURenderer): Promise<void> {
  await with_timeout(() => renderer.init(), device_timeout_ms, `GPU initialization`)
}

// Check before resizing: an oversized drawing buffer can invalidate the live viewer.
function validate_capture_size(
  renderer: WebGPURenderer,
  size: Vector2,
  pixel_ratio: number,
): void {
  const width = Math.floor(size.width * pixel_ratio)
  const height = Math.floor(size.height * pixel_ratio)
  const context = renderer.getContext() as GPUCanvasContext | WebGL2RenderingContext
  const max_dimension =
    `getConfiguration` in context
      ? context.getConfiguration()?.device.limits.maxTextureDimension2D
      : Math.min(
          context.getParameter(context.MAX_TEXTURE_SIZE),
          context.getParameter(context.MAX_RENDERBUFFER_SIZE),
        )
  if (!max_dimension) throw new Error(`GPU canvas is not configured for export`)
  if (width > max_dimension || height > max_dimension)
    throw new Error(
      `Export resolution ${width}×${height} exceeds this GPU's ${max_dimension}px limit per dimension. Select a lower resolution or resize the viewer.`,
    )
}

// PNG of a live canvas at `png_dpi` (72 DPI = one pixel per CSS pixel), independent of the
// screen's devicePixelRatio. GPU canvases re-render their registered scene at that pixel ratio
// (the drawing buffer is cleared after present, so even a same-size capture renders first);
// plain 2D canvases encode as-is when their backing store already has the target size.
export async function canvas_to_png_blob(
  canvas: HTMLCanvasElement,
  png_dpi = DEFAULT_PNG_DPI,
): Promise<Blob> {
  const scale = dpi_to_scale(png_dpi)
  const renderer = renderer_registry.get(canvas)

  if (!renderer) {
    const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * scale))
    const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * scale))
    if (width === canvas.width && height === canvas.height) return canvas_to_blob(canvas)
    return paint_png_blob(width, height, 1, (ctx) =>
      ctx.drawImage(canvas, 0, 0, width, height),
    )
  }

  await wait_for_renderer(renderer)
  const view = scene_registry.get(canvas)
  const orig_pixel_ratio = renderer.getPixelRatio()
  const orig_size = renderer.getSize(new Vector2())
  const resize = Math.abs(scale - orig_pixel_ratio) > 1e-6
  validate_capture_size(renderer, orig_size, scale)

  try {
    if (resize) renderer.setDrawingBufferSize(orig_size.width, orig_size.height, scale)
    if (view) renderer.render(view.scene, view.camera)
    return await canvas_to_blob(canvas)
  } finally {
    if (resize)
      renderer.setDrawingBufferSize(orig_size.width, orig_size.height, orig_pixel_ratio)
  }
}

// PNG of a scene drawn in CSS pixels: `paint` runs on a fresh canvas pre-scaled by `scale`,
// so canvas-drawn marks come out crisp instead of as an upscaled screen bitmap
export function paint_png_blob(
  width: number,
  height: number,
  scale: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Promise<Blob> {
  const canvas = document.createElement(`canvas`)
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext(`2d`)
  if (!ctx) throw new Error(`Canvas 2D context not available`)
  ctx.scale(scale, scale)
  paint(ctx)
  return canvas_to_blob(canvas, `Failed to generate high-resolution PNG`)
}

// Export a canvas as PNG named `<basename>-<dpi>dpi.png` (triggers browser download)
export async function export_canvas_as_png(
  canvas: HTMLCanvasElement,
  filename: string,
  png_dpi = DEFAULT_PNG_DPI,
  save: FileSaver = download,
): Promise<void> {
  const basename = filename.replace(/\.png$/i, ``)
  await save(
    await canvas_to_png_blob(canvas, png_dpi),
    `${basename}-${Math.round(png_dpi)}dpi.png`,
    `image/png`,
  )
}

// === Export model ===
// Every exporting component lists the serializers it supports as `ExportSources` and hands
// them to one ExportPane, which turns them into download/copy buttons. Callers pick formats
// with `export_formats` and may take over saving with `on_export`.

export type ExportFormat = `png` | `svg` | `csv` | `json` | `md` | `tex`
export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: `image/png`,
  svg: `image/svg+xml;charset=utf-8`,
  csv: `text/csv;charset=utf-8`,
  json: `application/json`,
  md: `text/markdown;charset=utf-8`,
  tex: `text/x-tex;charset=utf-8`,
}
const EXPORT_ORDER = Object.keys(EXPORT_MIME) as ExportFormat[]
const EXPORT_LABELS: Partial<Record<ExportFormat, string>> = { md: `Markdown`, tex: `LaTeX` }

// Serializes one format; PNG sources receive the pane's DPI, the others ignore it
export type ExportSource = (png_dpi: number) => DownloadData | Promise<DownloadData>
export type ExportSources = Partial<Record<ExportFormat, ExportSource>>

// The serialized file handed to `on_export`, alongside the pane's destination and DPI
export interface ExportContext extends ExportPaneContext {
  data: DownloadData
  mime: string
}

// The export props every chart and viewer accepts
export interface ExportProps {
  // Formats offered (default: all the component supports); [] hides the export pane
  export_formats?: readonly ExportFormat[]
  // Default base name of exported files; the pane appends each format's extension
  export_filename?: string
  // Receives each serialized file instead of the default save (downloads or chosen folder)
  on_export?: (format: ExportFormat, context: ExportContext) => void | Promise<void>
}

// Serialize one format and save it, or hand it to on_export
export async function run_export(
  format: ExportFormat,
  source: ExportSource,
  context: ExportPaneContext,
  on_export?: ExportProps[`on_export`],
): Promise<void> {
  const data = await source(context.png_dpi)
  const mime = EXPORT_MIME[format]
  if (on_export) return on_export(format, { ...context, data, mime })
  return context.save(data, `${context.filename}.${format}`, mime)
}

// Pane sections for the offered sources: an Image section (PNG, SVG) and a Data section
// (CSV, JSON, Markdown, LaTeX). Every text format also gets a copy-to-clipboard button.
export function export_sections(
  sources: ExportSources,
  { export_formats, on_export }: Omit<ExportProps, `export_filename`> = {},
): ExportSection[] {
  const items = (image: boolean): ExportItem[] =>
    EXPORT_ORDER.flatMap((format) => {
      const source = sources[format]
      if (!source || (format === `png` || format === `svg`) !== image) return []
      if (export_formats && !export_formats.includes(format)) return []
      const copy_text = async () => {
        const data = await source(DEFAULT_PNG_DPI)
        return typeof data === `string` ? data : null
      }
      return [
        {
          label: EXPORT_LABELS[format] ?? format.toUpperCase(),
          show_dpi: format === `png`,
          on_download: (context) => run_export(format, source, context, on_export),
          copy_text: format === `png` ? undefined : copy_text,
        },
      ]
    })
  return [
    { title: `Image`, items: items(true) },
    { title: `Data`, items: items(false) },
  ].filter((section) => section.items.length > 0)
}

const require_element = <El>(element: El | null | undefined, kind: string): El => {
  if (!element) throw new Error(`No ${kind} to export yet: the view has not rendered`)
  return element
}

// SVG and PNG sources for a live SVG figure, looked up per export since it may re-mount
export const svg_sources = (get_svg: () => SVGElement | null | undefined): ExportSources => ({
  png: (png_dpi) => svg_to_png_blob(require_element(get_svg(), `SVG`), png_dpi),
  svg: () => svg_to_string(require_element(get_svg(), `SVG`)),
})

// PNG source for a live canvas (2D or GPU-rendered)
export const canvas_sources = (
  get_canvas: () => HTMLCanvasElement | null | undefined,
): ExportSources => ({
  png: (png_dpi) => canvas_to_png_blob(require_element(get_canvas(), `canvas`), png_dpi),
})

export const json_source =
  (get_data: () => unknown): ExportSource =>
  () =>
    JSON.stringify(get_data(), null, 2)

// === SVG serialization ===

const SVG_NS = `http://www.w3.org/2000/svg`

// Paint properties a standalone SVG must carry itself (it loses the page stylesheets), with
// their initial values. Inherited ones are written only where they change from the parent,
// the others only where they leave their initial value, so the file stays small. The fonts
// have no fixed initial value, so the root always pins the page's.
const INHERITED_STYLES: Record<string, string> = {
  fill: `rgb(0, 0, 0)`,
  'fill-opacity': `1`,
  stroke: `none`,
  'stroke-width': `1`,
  'stroke-opacity': `1`,
  'stroke-dasharray': `none`,
  'stroke-linecap': `butt`,
  'stroke-linejoin': `miter`,
  'font-family': ``,
  'font-size': ``,
  'font-weight': `400`,
  'font-style': `normal`,
  'text-anchor': `start`,
  'dominant-baseline': `auto`,
  'paint-order': `normal`,
  visibility: `visible`,
}
const OWN_STYLES: Record<string, string> = {
  opacity: `1`,
  'stop-color': `rgb(0, 0, 0)`,
  'stop-opacity': `1`,
}
// Containers whose content only renders where referenced, so nothing in them is stripped
const DEFINITION_TAGS = new Set([
  `defs`,
  `clipPath`,
  `mask`,
  `pattern`,
  `marker`,
  `symbol`,
  `linearGradient`,
  `radialGradient`,
  `filter`,
])
const SHAPE_TAGS = new Set([
  `rect`,
  `circle`,
  `ellipse`,
  `path`,
  `line`,
  `polyline`,
  `polygon`,
])
const is_no_paint = (paint: string): boolean =>
  paint === `none` || paint === `transparent` || /^rgba\(.*,\s*0\)$/.test(paint)

type ResolvedStyles = Record<string, string>

// Write each paint property onto `clone` where it differs from what the clone would inherit,
// and drop authored ones that are redundant. Reads the browser's computed style, falling back
// to the authored attribute for engines that don't compute SVG presentation attributes.
function inline_styles(
  live: Element,
  clone: Element,
  parent: ResolvedStyles | null,
): ResolvedStyles {
  const computed = getComputedStyle(live)
  const resolved: ResolvedStyles = {}
  const style = (clone as SVGElement).style
  for (const [props, inherited] of [
    [INHERITED_STYLES, true],
    [OWN_STYLES, false],
  ] as const) {
    for (const [prop, initial] of Object.entries(props)) {
      const expected = (inherited ? parent?.[prop] : undefined) ?? initial
      // empty strings mean "not set" at every level, hence find(Boolean) rather than ??
      const value = (
        [
          computed.getPropertyValue(prop),
          (live as SVGElement).style?.getPropertyValue(prop),
          live.getAttribute(prop),
        ].find(Boolean) ?? expected
      )
        .replaceAll(/(?<num>\d)px\b/g, `$<num>`)
        .replace(/^normal$/, prop === `font-weight` ? `400` : `normal`)
      resolved[prop] = value
      style?.removeProperty(prop)
      if (value === expected) clone.removeAttribute(prop)
      else clone.setAttribute(prop, value)
    }
  }
  if (style && !style.length) clone.removeAttribute(`style`)
  // Read for stripping, never written: an element is either exported visible or dropped
  resolved.display = [computed.display, live.getAttribute(`display`)].find(Boolean) ?? `inline`
  return resolved
}

// Hidden elements, transparent hit targets and interaction-only markup render nothing
function renders_nothing(live: Element, styles: ResolvedStyles): boolean {
  if (live.hasAttribute(`data-export-exclude`)) return true
  if (live.hasAttribute(`data-export-only`)) return false
  if (styles.display === `none` || styles.opacity === `0`) return true
  if (styles.visibility === `hidden` && live.childElementCount === 0) return true
  return (
    SHAPE_TAGS.has(live.localName) &&
    (live.localName === `line` || is_no_paint(styles.fill)) && // lines have no fill
    (is_no_paint(styles.stroke) || styles[`stroke-width`] === `0`)
  )
}

// A <canvas> inside a <foreignObject> is a live bitmap, not markup: the serializer would emit
// an empty element. Swap it for an <image> of its pixels, repainted at `scale` when the chart
// registered a painter for it (see canvas_painters) so raster exports stay sharp.
function foreign_canvas_image(live: Element, scale: number): SVGImageElement | null {
  const canvas = live.querySelector(`canvas`)
  if (!canvas?.width || !canvas.height) return null
  const painter = canvas_painters.get(canvas)
  let source = canvas
  if (painter) {
    source = document.createElement(`canvas`)
    painter(source, scale)
  }
  let href: string
  try {
    href = source.toDataURL(`image/png`)
  } catch {
    return null // tainted by a cross-origin draw: nothing can be read back
  }
  const image = document.createElementNS(SVG_NS, `image`)
  for (const attr of [`x`, `y`, `width`, `height`]) {
    const value = live.getAttribute(attr)
    if (value != null) image.setAttribute(attr, value)
  }
  image.setAttribute(`href`, href)
  return image
}

type WalkState = { max_stroke: number; raster_scale: number }

// Walk the live tree and its clone in lockstep: inline styles, strip what renders nothing,
// rasterize foreign canvases and track the widest stroke (for edge padding)
function prepare_clone(
  live: Element,
  clone: Element,
  parent: ResolvedStyles | null,
  in_defs: boolean,
  state: WalkState,
): void {
  const styles = inline_styles(live, clone, parent)
  // Static stand-ins for interactive markup, hidden on screen
  if (live.hasAttribute(`data-export-only`)) clone.removeAttribute(`display`)
  if (!in_defs && renders_nothing(live, styles)) return clone.remove()
  if (live.localName === `foreignObject`) {
    if (!live.querySelector(`canvas`)) return
    const image = foreign_canvas_image(live, state.raster_scale)
    if (image) clone.replaceWith(image)
    else clone.remove()
    return
  }
  if (!in_defs && !is_no_paint(styles.stroke)) {
    // stroke widths may carry units (`1.5px`), which Number() rejects
    const stroke_width = Number.parseFloat(styles[`stroke-width`]) // oxlint-disable-line unicorn/prefer-number-coercion
    state.max_stroke = Math.max(state.max_stroke, stroke_width || 0)
  }
  const children_in_defs = in_defs || DEFINITION_TAGS.has(live.localName)
  const clone_children = [...clone.children]
  ;[...live.children].forEach((child, idx) => {
    if (clone_children[idx])
      prepare_clone(child, clone_children[idx], styles, children_in_defs, state)
  })
}

// Matches decimals with 3+ fraction digits (optionally in exponent form), rounded to 2 places:
// 0.01 user units is far below a pixel, and long floats dominate chart file sizes
const LONG_DECIMAL = /-?\d*\.\d{3,}(?:e[-+]?\d+)?|-?\d+(?:\.\d+)?e-\d+/gi
const round_decimals = (text: string): string =>
  text.replaceAll(LONG_DECIMAL, (match) => String(Math.round(Number(match) * 100) / 100 || 0))
// Markup the standalone file has no use for: interaction and test hooks and event routing.
// Classes stay as layer names for editing the figure in vector tools, minus Svelte's
// scoping hashes, which only meant something to the page stylesheet.
const DROP_ATTR = /^(?:data-|aria-|role$|tabindex$|pointer-events$|cursor$)/
const INTERACTION_STYLES = [`cursor`, `pointer-events`, `user-select`, `touch-action`]

function minify_clone(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const comment of comments) comment.parentNode?.removeChild(comment)
  for (const element of [root, ...root.querySelectorAll(`*`)]) {
    const style = (element as SVGElement).style
    for (const prop of INTERACTION_STYLES) style?.removeProperty(prop)
    if (style && !style.length) element.removeAttribute(`style`)
    const classes = element
      .getAttribute(`class`)
      ?.replaceAll(/\bsvelte-\w+\b/g, ``)
      .trim()
    if (classes) element.setAttribute(`class`, classes.replaceAll(/\s+/g, ` `))
    else element.removeAttribute(`class`)
    // a snapshot: the live NamedNodeMap shifts as attributes are removed
    for (const { name, value } of Array.from(element.attributes)) {
      if (DROP_ATTR.test(name)) element.removeAttribute(name)
      else if (![`href`, `xlink:href`, `id`, `font-family`].includes(name))
        element.setAttribute(name, round_decimals(value))
    }
  }
  // Groups emptied by the stripping above render nothing (definition containers may be
  // referenced by id, so they stay)
  for (const group of [...root.querySelectorAll(`g`)].toReversed()) {
    if (!group.firstElementChild && !group.closest(`defs`)) group.remove()
  }
}

type SvgViewbox = [x: number, y: number, width: number, height: number]

function svg_viewbox(svg: SVGElement, padding = 0): SvgViewbox | null {
  const viewbox = svg.getAttribute(`viewBox`)?.trim()
  // Without a viewBox, SVG coordinates use the viewport's resolved length units.
  const style = viewbox ? null : getComputedStyle(svg)
  const parts = viewbox
    ? viewbox.split(/[\s,]+/).map(Number)
    : style
      ? // oxlint-disable-next-line unicorn/prefer-number-coercion -- computed CSS dimensions include px
        [0, 0, Number.parseFloat(style.width), Number.parseFloat(style.height)]
      : null
  if (parts?.length !== 4) return null
  const [coord_x, coord_y, width, height] = parts
  if (!(width > 0 && height > 0)) return null
  const padded: SvgViewbox = [
    coord_x - padding,
    coord_y - padding,
    width + 2 * padding,
    height + 2 * padding,
  ]
  return padded.every(Number.isFinite) ? padded : null
}

// Standalone SVG markup of a live figure, never mutating it: computed paint styles inlined
// minimally, HTML overlays (legends, color bars) redrawn as SVG, hidden and interaction-only
// elements dropped, coordinates rounded to 2 decimals, and the viewBox padded by half the
// widest stroke so edge strokes aren't clipped. Foreign canvases embed at `scale`; a raster
// export also sizes the root to its viewBox times `scale` in pixels.
function serialize_svg(
  svg: SVGElement,
  scale: number,
  raster = false,
): { markup: string; size: [width: number, height: number] | null } {
  const clone = svg.cloneNode(true) as SVGElement
  const state: WalkState = { max_stroke: 0, raster_scale: scale }
  prepare_clone(svg, clone, null, false, state)
  for (const overlay of export_overlays(svg)) clone.append(overlay)
  minify_clone(clone)
  const viewbox = svg_viewbox(svg, state.max_stroke / 2)
  // Floor at 1px: small viewBoxes at low DPI round to 0 and make toBlob fail confusingly
  const size: [number, number] | null = viewbox
    ? ([viewbox[2], viewbox[3]].map((len) =>
        raster ? Math.max(1, Math.round(len * scale)) : Math.round(len * 100) / 100,
      ) as [number, number])
    : null
  if (viewbox) clone.setAttribute(`viewBox`, round_decimals(viewbox.join(` `)))
  if (size) set_attrs(clone, { width: size[0], height: size[1] })
  clone.style.removeProperty(`width`)
  clone.style.removeProperty(`height`)
  if (!clone.style.length) clone.removeAttribute(`style`)
  clone.setAttribute(`xmlns`, SVG_NS)
  return { markup: new XMLSerializer().serializeToString(clone), size }
}

// Standalone SVG file content of a live figure (see serialize_svg)
export const svg_to_string = (svg: SVGElement): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${serialize_svg(svg, dpi_to_scale(DEFAULT_PNG_DPI)).markup}`

// Rasterize a live SVG figure at `png_dpi` (72 DPI = one pixel per viewBox unit)
export async function svg_to_png_blob(
  svg: SVGElement,
  png_dpi = DEFAULT_PNG_DPI,
): Promise<Blob> {
  if (!Number.isFinite(png_dpi) || png_dpi <= 0) throw new Error(`Invalid PNG DPI for export`)
  const { markup, size } = serialize_svg(svg, dpi_to_scale(png_dpi), true)
  if (!size) throw new Error(`Invalid SVG dimensions for PNG export`)
  const [width, height] = size
  return with_svg_image(markup, width * height, (img) =>
    paint_png_blob(width, height, 1, (ctx) => ctx.drawImage(img, 0, 0, width, height)),
  )
}

// Load SVG markup into an <img> (timeout scaled by its pixel count), run `use` on it, then
// release the object URL
async function with_svg_image<Value>(
  markup: string,
  n_pixels: number,
  use: (img: HTMLImageElement) => Promise<Value>,
): Promise<Value> {
  const url = URL.createObjectURL(new Blob([markup], { type: EXPORT_MIME.svg }))
  const listeners = new AbortController()
  try {
    const img = new Image()
    await with_timeout(
      () =>
        new Promise<void>((resolve, reject) => {
          const event_options = { once: true, signal: listeners.signal }
          img.addEventListener(`load`, () => resolve(), event_options)
          img.addEventListener(
            `error`,
            () => reject(new Error(`Failed to load SVG for PNG export`)),
            event_options,
          )
          img.src = url
        }),
      export_timeout_ms((n_pixels * 4) / 1e6),
      `SVG image load`,
    )
    return await use(img)
  } catch (error) {
    throw to_error(error)
  } finally {
    listeners.abort()
    URL.revokeObjectURL(url)
  }
}

// === HTML overlays ===
// Legends and color bars are HTML laid over a chart's SVG. Components mark such roots with
// `data-export-overlay`; on export each is redrawn as static SVG at its on-screen position.

type Attrs = Record<string, string | number>
const set_attrs = <El extends Element>(element: El, attrs: Attrs): El => {
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value))
  return element
}
const svg_el = (tag: string, attrs: Attrs) =>
  set_attrs(document.createElementNS(SVG_NS, tag), attrs)

// ColorBar only draws `to right` (horizontal) and `to top` (vertical) gradients
const GRADIENT_VECTORS: Record<string, [number, number, number, number]> = {
  right: [0, 0, 1, 0],
  top: [0, 1, 0, 0],
}

// ColorBar's computed `linear-gradient(to <side>, <color> <offset>, ...)` as an SVG gradient
// vector plus [color, offset] stops, or null for any other background
export function parse_linear_gradient(background_image: string) {
  const { side = ``, args = `` } =
    /^linear-gradient\(to (?<side>\w+), (?<args>.*)\)$/s.exec(background_image.trim())
      ?.groups ?? {}
  const vector = GRADIENT_VECTORS[side]
  if (!vector) return null
  // split on commas outside parentheses (color functions like rgb(1, 2, 3) nest their own),
  // then each stop at the space before its offset
  const stops = args.split(/,(?![^(]*\))/).map((stop) => stop.trim().split(/\s+(?=\S+$)/))
  return { vector, stops }
}

// Redraw an HTML overlay as SVG in the coordinate frame of `origin` (the chart SVG's box):
// solid and gradient backgrounds become rects, nested SVGs (legend markers) are cloned in
// place, text runs become <text> at their laid-out position with the computed font.
function overlay_to_svg(root: HTMLElement, origin: DOMRect): SVGElement {
  // clipPath and linearGradient never render themselves, so they can live in the group
  const group = svg_el(`g`, {})
  const box = (rect: DOMRect) => ({
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  })
  // A scrolling legend shows only what fits its box
  if (![``, `visible`].includes(getComputedStyle(root).overflowY)) {
    const id = unique_id(`export-overlay-clip`)
    const clip = svg_el(`clipPath`, { id })
    const clip_box = box(root.getBoundingClientRect())
    clip.append(svg_el(`rect`, clip_box))
    group.append(clip)
    group.setAttribute(`clip-path`, `url(#${id})`)
  }

  const add_background = (element: Element, style: CSSStyleDeclaration, opacity: number) => {
    const rect = box(element.getBoundingClientRect())
    if (!(rect.width > 0 && rect.height > 0)) return
    // oxlint-disable-next-line unicorn/prefer-number-coercion -- computed CSS lengths include px
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0
    const gradient = parse_linear_gradient(style.backgroundImage)
    let fill = style.backgroundColor
    if (gradient) {
      const id = unique_id(`export-overlay-gradient`)
      const [x1, y1, x2, y2] = gradient.vector
      const element_gradient = svg_el(`linearGradient`, { id, x1, y1, x2, y2 })
      for (const [color, offset] of gradient.stops) {
        element_gradient.append(svg_el(`stop`, { offset, 'stop-color': color }))
      }
      group.append(element_gradient)
      fill = `url(#${id})`
    } else if (!fill || is_no_paint(fill)) return
    group.append(svg_el(`rect`, { ...rect, ...(radius && { rx: radius }), fill, opacity }))
  }

  const add_text = (node: Text, style: CSSStyleDeclaration, opacity: number) => {
    const text = node.textContent?.replaceAll(/\s+/g, ` `).trim()
    if (!text) return
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = box(range.getBoundingClientRect())
    if (!(rect.width > 0 || rect.height > 0)) return
    const text_el = svg_el(`text`, {
      x: rect.x,
      y: rect.y + rect.height / 2,
      'dominant-baseline': `central`,
      fill: style.color,
      'font-size': style.fontSize,
      'font-family': style.fontFamily,
      'font-weight': style.fontWeight,
      'font-style': style.fontStyle,
      opacity,
    })
    text_el.textContent = text
    group.append(text_el)
  }

  const walk = (element: Element, parent_opacity: number) => {
    // Interactive controls have no static rendering (and raster exports must stay untainted)
    if (element.matches(`input, select, button, textarea, [data-export-exclude]`)) return
    const style = getComputedStyle(element)
    if (style.display === `none` || style.visibility === `hidden`) return
    const opacity = parent_opacity * (style.opacity === `` ? 1 : Number(style.opacity))
    if (!(opacity > 0)) return
    if (element instanceof SVGSVGElement) {
      const clone = element.cloneNode(true) as SVGSVGElement
      prepare_clone(element, clone, null, false, { max_stroke: 0, raster_scale: 1 })
      const nested_box = box(element.getBoundingClientRect())
      group.append(set_attrs(clone, { ...nested_box, opacity }))
      return
    }
    add_background(element, style, opacity)
    for (const child of element.childNodes) {
      if (child instanceof Text) add_text(child, style, opacity)
      else if (child instanceof Element) walk(child, opacity)
    }
  }
  walk(root, 1)
  return group
}

// SVG redraws of the HTML overlays a chart lays over `svg` (siblings marked data-export-overlay)
function export_overlays(svg: SVGElement): SVGElement[] {
  const overlays = [
    ...(svg.parentElement?.querySelectorAll<HTMLElement>(`[data-export-overlay]`) ?? []),
  ].filter((overlay) => !svg.contains(overlay))
  if (overlays.length === 0) return []
  const origin = svg.getBoundingClientRect()
  return overlays.map((overlay) => overlay_to_svg(overlay, origin))
}

// An HTML element (e.g. a CSS-grid heatmap) as a standalone SVG: the overlay redraw applied
// to the element itself inside an SVG of its size, so HTML figures share the SVG/PNG path
export function html_to_svg(element: HTMLElement): SVGSVGElement {
  const rect = element.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0))
    throw new Error(`Cannot export an element that has not been laid out (zero size)`)
  const svg = svg_el(`svg`, { viewBox: `0 0 ${rect.width} ${rect.height}` }) as SVGSVGElement
  svg.append(overlay_to_svg(element, rect))
  return svg
}

// PNG of a live canvas (re-rendered at `png_dpi`, see canvas_to_png_blob) with the HTML
// `overlays` laid over it (legends, color bars) redrawn on top at their on-screen positions,
// through the same overlay redraw as SVG chart exports
export async function canvas_overlay_png_blob(
  canvas: HTMLCanvasElement | null | undefined,
  overlays: readonly HTMLElement[],
  png_dpi = DEFAULT_PNG_DPI,
): Promise<Blob> {
  const source = require_element(canvas, `canvas`)
  const frame_blob = await canvas_to_png_blob(source, png_dpi)
  if (overlays.length === 0) return frame_blob
  const origin = source.getBoundingClientRect()
  const { width, height } = origin
  if (!(width > 0 && height > 0))
    throw new Error(`Cannot export a canvas that has not been laid out (zero size)`)
  const scale = dpi_to_scale(png_dpi)
  // sized in export pixels so the overlay rasterizes as crisply as the re-rendered frame
  const svg = svg_el(`svg`, {
    xmlns: SVG_NS,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    viewBox: `0 0 ${width} ${height}`,
  })
  for (const overlay of overlays) svg.append(overlay_to_svg(overlay, origin))
  const markup = new XMLSerializer().serializeToString(svg)
  const frame = await createImageBitmap(frame_blob)
  try {
    return await with_svg_image(markup, width * height * scale ** 2, (img) =>
      paint_png_blob(width, height, scale, (ctx) => {
        ctx.drawImage(frame, 0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
      }),
    )
  } finally {
    frame.close()
  }
}

// Watch a wrapper element for <canvas> insertion/removal: calls set with its first canvas (or
// null) immediately and whenever a canvas comes or goes. Returns a cleanup that disconnects
// the observer (or undefined when no wrapper is given). Used by export panes to enable canvas
// exports.
export function observe_canvas_presence(
  wrapper: HTMLElement | undefined,
  set: (canvas: HTMLCanvasElement | null) => void,
): (() => void) | undefined {
  if (!wrapper) {
    set(null)
    return undefined
  }
  const check = () => set(wrapper.querySelector(`canvas`))
  check()
  // Only an inserted or removed canvas (or subtree holding one) can change the answer: a
  // viewer's tables and labels re-render on every frame, and querying its whole tree each
  // time cost a trajectory's frame switches more than rendering them
  const holds_canvas = (nodes: NodeList): boolean =>
    [...nodes].some(
      (node) =>
        node instanceof Element &&
        (node.localName === `canvas` || node.querySelector(`canvas`) !== null),
    )
  const observer = new MutationObserver((records) => {
    if (records.some((rec) => holds_canvas(rec.addedNodes) || holds_canvas(rec.removedNodes)))
      check()
  })
  observer.observe(wrapper, { childList: true, subtree: true })
  return () => observer.disconnect()
}

// Bitrate target (bits/s) for AV1 exports without an explicit `bitrate`, clamped to
// [1, 200] Mbps. A pixel-rate heuristic: actual sizes vary by scene.
const estimate_video_bitrate = (pixel_count: number, fps: number): number =>
  clamp(pixel_count * fps * 0.1, 1_000_000, 200_000_000)

// Both containers use AV1. MP4 requires its registered sample-entry code, av01.
const video_mime_types = {
  webm: `video/webm;codecs=av1`,
  mp4: `video/mp4;codecs=av01`,
} as const
export type VideoFormat = keyof typeof video_mime_types

export const is_video_export_supported = (format: VideoFormat): boolean =>
  typeof MediaRecorder !== `undefined` &&
  MediaRecorder.isTypeSupported(video_mime_types[format])

// Recorder state changes synchronously; its encoder starts and stops asynchronously.
async function run_recorder_action(
  recorder: MediaRecorder,
  action: 'start' | 'stop',
  timeout_ms: number,
  signal?: AbortSignal,
  after_action?: () => void,
): Promise<void> {
  signal?.throwIfAborted()
  const listeners = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Recording timeout - recorder did not ${action}`)),
        timeout_ms,
      )
      const options = { signal: listeners.signal }
      recorder.addEventListener(action, () => resolve(), options)
      signal?.addEventListener(`abort`, () => reject(to_error(signal.reason)), options)
      recorder.addEventListener(
        `error`,
        (event) => {
          const message =
            event instanceof ErrorEvent && event.error instanceof Error
              ? event.error.message
              : event.type
          reject(new Error(`MediaRecorder error: ${message}`))
        },
        options,
      )
      recorder[action]()
      after_action?.()
    })
  } catch (error) {
    throw to_error(error)
  } finally {
    clearTimeout(timeout)
    listeners.abort()
  }
}

// Cancel scheduled work too: animation frames may never fire in a hidden/unmounted viewer.
function wait_for_video_tick(signal?: AbortSignal, duration?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const finish = () => {
      signal?.removeEventListener(`abort`, abort)
      resolve()
    }
    const handle =
      duration === undefined
        ? requestAnimationFrame(finish)
        : window.setTimeout(finish, duration)
    const abort = () => {
      if (duration === undefined) cancelAnimationFrame(handle)
      else clearTimeout(handle)
      reject(to_error(signal?.reason))
    }
    signal?.addEventListener(`abort`, abort, { once: true })
  })
}

// Resolution and frame preparation shared by realtime and offline video sinks.
export type VideoFrameOptions = {
  fps?: number
  total_frames?: number
  width?: number
  height?: number
  background?: string
  camera_flight?: CameraFlight
  camera_viewport_height?: number
  resolution_multiplier?: number
  on_step?: (step_idx: number, signal?: AbortSignal) => void | Promise<void>
  on_progress?: (progress: number) => void
  signal?: AbortSignal
}

// One bounded-memory frame producer for browser downloads, previews and offline encoding.
// The sink owns timing: offline sinks encode idx/fps regardless of how long a read takes.
// The capture canvas is reused, so sinks must consume it before their promise resolves.
export async function render_video_frames(
  canvas: HTMLCanvasElement,
  {
    fps = 30,
    total_frames = 100,
    width,
    height,
    background,
    camera_flight,
    camera_viewport_height,
    resolution_multiplier = DEFAULT_VIDEO_RESOLUTION,
    on_step,
    on_progress,
    signal = new AbortController().signal,
  }: VideoFrameOptions,
  sink: {
    start?: (canvas: HTMLCanvasElement) => Promise<void>
    frame: (canvas: HTMLCanvasElement, idx: number, signal: AbortSignal) => Promise<void>
    finish?: () => Promise<void>
  },
): Promise<void> {
  signal.throwIfAborted()
  if (
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isSafeInteger(total_frames) ||
    total_frames < 0
  )
    throw new RangeError(`Invalid video timing: ${total_frames} frames at ${fps} fps`)
  if (
    (width !== undefined || height !== undefined) &&
    ![width, height].every((value) => Number.isInteger(value) && Number(value) > 0)
  )
    throw new RangeError(`Invalid video dimensions: ${width}×${height}`)
  if (!Number.isFinite(resolution_multiplier) || resolution_multiplier <= 0)
    throw new RangeError(`Invalid resolution multiplier: ${resolution_multiplier}`)
  const sample = camera_flight && create_camera_flight_sampler(camera_flight)
  const renderer = renderer_registry.get(canvas)
  if (renderer) await wait_for_renderer(renderer)
  signal.throwIfAborted()
  let restore_renderer: (() => void) | undefined
  try {
    const prepare = async (idx: number) => {
      signal.throwIfAborted()
      on_progress?.((idx / Math.max(1, total_frames)) * 100)
      signal.throwIfAborted()
      await abortable(() => on_step?.(idx, signal), signal)
      await wait_for_video_tick(signal)
      await wait_for_video_tick(signal)
    }
    if (total_frames > 0) await prepare(0)
    const view = scene_registry.get(canvas)
    const export_camera =
      view && (sample || width !== undefined) ? view.camera.clone() : view?.camera
    const is_3d_camera =
      export_camera instanceof PerspectiveCamera || export_camera instanceof OrthographicCamera
    if (sample && !is_3d_camera)
      throw new Error(`A registered 3D camera is required to render a camera flight`)
    if (renderer && (width !== undefined || resolution_multiplier !== 1)) {
      const size = renderer.getSize(new Vector2())
      const ratio = renderer.getPixelRatio()
      const output_size =
        width !== undefined && height !== undefined ? new Vector2(width, height) : size
      const output_ratio = width !== undefined ? 1 : ratio * resolution_multiplier
      validate_capture_size(renderer, output_size, output_ratio)
      restore_renderer = () => renderer.setDrawingBufferSize(size.width, size.height, ratio)
      renderer.setDrawingBufferSize(output_size.width, output_size.height, output_ratio)
    }
    const capture_canvas = document.createElement(`canvas`)
    capture_canvas.width = width ?? canvas.width
    capture_canvas.height = height ?? canvas.height
    const context = capture_canvas.getContext(`2d`)
    if (!context) throw new Error(`Canvas 2D context not available for video export`)
    const aspect = capture_canvas.width / capture_canvas.height
    const capture = (idx: number) => {
      signal.throwIfAborted()
      if (is_3d_camera) {
        const duration = camera_flight?.keyframes.at(-1)?.time ?? 0
        const pose = sample?.(total_frames <= 1 ? 0 : (duration * idx) / (total_frames - 1))
        if (pose) {
          if (
            export_camera instanceof PerspectiveCamera !==
            (pose.projection === `perspective`)
          )
            throw new Error(`Select ${pose.projection} projection before rendering this movie`)
          export_camera.position.set(...pose.position)
          export_camera.quaternion.set(...pose.quaternion)
          export_camera.zoom = pose.zoom
          if (export_camera instanceof PerspectiveCamera) export_camera.fov = pose.fov
          set_pan_offset(
            export_camera,
            [pose.pan[0] * capture_canvas.width, pose.pan[1] * capture_canvas.height],
            capture_canvas.width,
            capture_canvas.height,
          )
        }
        if (export_camera !== view?.camera) {
          if (export_camera instanceof PerspectiveCamera) export_camera.aspect = aspect
          else {
            const half_height =
              (camera_viewport_height ?? export_camera.top - export_camera.bottom) / 2
            const center = (export_camera.left + export_camera.right) / 2
            export_camera.top = half_height
            export_camera.bottom = -half_height
            export_camera.left = center - half_height * aspect
            export_camera.right = center + half_height * aspect
          }
          export_camera.updateProjectionMatrix()
          export_camera.updateMatrixWorld()
        }
      }
      if (renderer && view && export_camera) renderer.render(view.scene, export_camera)
      context.clearRect(0, 0, capture_canvas.width, capture_canvas.height)
      if (background) {
        context.fillStyle = background
        context.fillRect(0, 0, capture_canvas.width, capture_canvas.height)
      }
      context.drawImage(canvas, 0, 0, capture_canvas.width, capture_canvas.height)
    }
    if (total_frames > 0) capture(0)
    await abortable(() => sink.start?.(capture_canvas), signal)
    for (let idx = 0; idx < total_frames; idx++) {
      if (idx > 0) {
        await prepare(idx)
        capture(idx)
      }
      await abortable(() => sink.frame(capture_canvas, idx, signal), signal)
      signal.throwIfAborted()
    }
    await abortable(() => sink.finish?.(), signal)
  } finally {
    restore_renderer?.()
  }
}

export async function export_trajectory_video(
  canvas: HTMLCanvasElement | null,
  filename: string,
  {
    format = `webm`,
    fps = 30,
    total_frames = 100,
    on_finish,
    on_save,
    bitrate,
    stop_timeout_ms,
    signal,
    ...frame_options
  }: VideoFrameOptions & {
    format?: VideoFormat
    // Restore caller-owned state after recording cleanup, before any download.
    on_finish?: () => void | Promise<void>
    // Save the completed video to a caller-selected destination instead of downloading it.
    on_save?: (blob: Blob) => void | Promise<void>
    bitrate?: number
    // Finalization deadline in ms (1–2^31-1). Default: 30s + 1s per estimated MB, capped at 5min.
    stop_timeout_ms?: number
  } = {},
): Promise<void> {
  signal?.throwIfAborted()
  if (!canvas) throw new Error(`Canvas not ready for video export`)
  if (
    stop_timeout_ms !== undefined &&
    !(stop_timeout_ms >= 1 && stop_timeout_ms <= 2_147_483_647)
  )
    throw new RangeError(`Invalid stop_timeout_ms: ${stop_timeout_ms}; expected 1–2147483647`)
  const mime_type = video_mime_types[format]
  if (!is_video_export_supported(format))
    throw new Error(`AV1 recording (${mime_type}) is not supported in this browser`)

  if (bitrate !== undefined && (!Number.isFinite(bitrate) || bitrate <= 0))
    throw new RangeError(`Invalid video bitrate: ${bitrate}`)
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let recording_start = 0
  let frame_start = 0
  let actual_bitrate = 0
  const chunks: Blob[] = []
  const stop_recorder = () => {
    if (recorder && recorder.state !== `inactive`) recorder.stop()
  }
  const request_frame = () =>
    (
      stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
    )?.requestFrame?.()
  signal?.addEventListener(`abort`, stop_recorder, { once: true })
  try {
    await render_video_frames(
      canvas,
      { ...frame_options, fps, total_frames, signal },
      {
        start: async (capture_canvas) => {
          actual_bitrate =
            bitrate ??
            estimate_video_bitrate(capture_canvas.width * capture_canvas.height, fps)
          stream = capture_canvas.captureStream(fps)
          recorder = new MediaRecorder(stream, {
            mimeType: mime_type,
            videoBitsPerSecond: actual_bitrate,
          })
          recorder.addEventListener(`dataavailable`, (event) => {
            if (event.data.size > 0) chunks.push(event.data)
          })
          await run_recorder_action(recorder, `start`, 5000, signal, () => {
            if (total_frames > 0) request_frame()
          })
          recording_start = performance.now()
          frame_start = recording_start
        },
        frame: async (_canvas, idx) => {
          if (idx > 0) request_frame()
          await wait_for_video_tick(
            signal,
            Math.max(0, 1000 / fps - (performance.now() - frame_start)),
          )
          frame_start = performance.now()
        },
        finish: async () => {
          if (!recorder) throw new Error(`Video recorder was not initialized`)
          const estimated_megabytes =
            (actual_bitrate * (performance.now() - recording_start)) / 8e9
          await run_recorder_action(
            recorder,
            `stop`,
            stop_timeout_ms ?? export_timeout_ms(estimated_megabytes),
            signal,
          )
        },
      },
    )
  } catch (error) {
    stop_recorder()
    throw error
  } finally {
    signal?.removeEventListener(`abort`, stop_recorder)
    try {
      for (const track of stream?.getTracks() ?? []) track.stop()
    } finally {
      await on_finish?.()
    }
  }
  signal?.throwIfAborted()
  const container_mime = `video/${format}`
  const blob = new Blob(chunks, { type: container_mime })
  if (on_save) await on_save(blob)
  else download(blob, `${filename.replace(/\.(?:mp4|webm)$/i, ``)}.${format}`, container_mime)
  frame_options.on_progress?.(100)
}
