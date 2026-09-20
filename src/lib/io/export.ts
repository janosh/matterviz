import { DEFAULT_PNG_DPI, DEFAULT_VIDEO_RESOLUTION } from '$lib/constants'
import { download } from '$lib/io/fetch'
import type { FileSaver } from './file-export.svelte'
import { clamp } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { create_structure_filename } from '$lib/structure/export'
import { abortable, to_error } from '$lib/utils'
import {
  type Camera,
  type Scene,
  Vector2,
  type WebGPURenderer,
  PerspectiveCamera,
  OrthographicCamera,
} from 'three/webgpu'
import { create_camera_flight_sampler, type CameraFlight } from '$lib/scene/camera-flight'
import { set_pan_offset } from '$lib/scene/pan'

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
  Math.min(Math.max(1, Number.isFinite(png_dpi) ? png_dpi : 72) / 72, 10)

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

// GPU canvases temporarily adjust renderer pixel ratio; plain 2D canvases are drawn into a
// scaled offscreen canvas. Returns the Blob rather than downloading it.
export async function canvas_to_png_blob(
  canvas: HTMLCanvasElement,
  png_dpi = DEFAULT_PNG_DPI,
  scene: Scene | null = null,
  camera: Camera | null = null,
): Promise<Blob> {
  const resolution_multiplier = dpi_to_scale(png_dpi)
  const resize = resolution_multiplier > 1.1
  const renderer = renderer_registry.get(canvas)

  if (!renderer) {
    if (!resize) return canvas_to_blob(canvas)
    const scaled_canvas = document.createElement(`canvas`)
    scaled_canvas.width = Math.max(1, Math.round(canvas.width * resolution_multiplier))
    scaled_canvas.height = Math.max(1, Math.round(canvas.height * resolution_multiplier))
    const context = scaled_canvas.getContext(`2d`)
    if (!context) throw new Error(`Canvas 2D context not available`)
    context.drawImage(canvas, 0, 0, scaled_canvas.width, scaled_canvas.height)
    return canvas_to_blob(scaled_canvas, `Failed to generate high-resolution PNG`)
  }

  await wait_for_renderer(renderer)
  const orig_pixel_ratio = renderer.getPixelRatio()
  const orig_size = renderer.getSize(new Vector2())
  // Scale the live ratio so HiDPI exports retain their display resolution.
  const pixel_ratio = orig_pixel_ratio * (resize ? resolution_multiplier : 1)
  validate_capture_size(renderer, orig_size, pixel_ratio)

  try {
    if (resize) renderer.setDrawingBufferSize(orig_size.width, orig_size.height, pixel_ratio)
    if (scene && camera) renderer.render(scene, camera)
    return await canvas_to_blob(canvas)
  } finally {
    if (resize)
      renderer.setDrawingBufferSize(orig_size.width, orig_size.height, orig_pixel_ratio)
  }
}

// Export structure as PNG image from canvas (triggers browser download)
export async function export_canvas_as_png(
  canvas: HTMLCanvasElement | null,
  structure_or_filename: AnyStructure | string | undefined,
  png_dpi = DEFAULT_PNG_DPI,
  scene: Scene | null = null,
  camera: Camera | null = null,
  save: FileSaver = download,
): Promise<void> {
  if (!canvas) {
    if (typeof window !== `undefined`) console.warn(`Canvas not found for PNG export`)
    return
  }

  const basename =
    typeof structure_or_filename === `string`
      ? structure_or_filename
      : create_structure_filename(structure_or_filename, `png`)

  const filename = `${basename.replace(/\.png$/i, ``)}-${Math.round(png_dpi)}dpi.png`

  await save(await canvas_to_png_blob(canvas, png_dpi, scene, camera), filename, `image/png`)
}

interface SvgExportOptions {
  // Extra user-space units around the viewBox in the exported clone. Useful
  // when strokes are centered on a chart edge and would otherwise be clipped.
  // `stroke` derives the padding from half the largest rendered stroke width.
  viewbox_padding?: number | `stroke`
}

// Helper to ensure font-family is set on SVG root
function set_svg_font_family(svg: SVGElement) {
  const style = svg.getAttribute(`style`) ?? ``
  if (!style.includes(`font-family`)) {
    svg.setAttribute(`style`, `${style}${style ? `;` : ``}font-family:sans-serif;`)
  }
  // Also set as attribute for extra robustness
  svg.setAttribute(`font-family`, `sans-serif`)
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
  if (parts?.length !== 4 || !parts.every(Number.isFinite)) return null
  const [coord_x, coord_y, width, height] = parts
  if (width <= 0 || height <= 0) return null
  const padded: SvgViewbox = [
    coord_x - padding,
    coord_y - padding,
    width + 2 * padding,
    height + 2 * padding,
  ]
  return padded.every(Number.isFinite) && padded[2] > 0 && padded[3] > 0 ? padded : null
}

function resolve_viewbox_padding(svg: SVGElement, options: SvgExportOptions): number {
  if (options.viewbox_padding !== `stroke`) {
    return Number.isFinite(options.viewbox_padding)
      ? Math.max(0, options.viewbox_padding ?? 0)
      : 0
  }
  let max_stroke_width = 0
  for (const element of [svg, ...svg.querySelectorAll(`*`)]) {
    const computed = getComputedStyle(element)
    const inline_style = (element as SVGElement).style
    const stroke =
      [
        inline_style.stroke,
        computed.getPropertyValue(`stroke`),
        element.getAttribute(`stroke`),
      ].find(Boolean) ?? ``
    if (!stroke || stroke === `none` || stroke === `transparent`) continue
    // oxlint-disable-next-line unicorn/prefer-number-coercion -- CSS lengths include units
    const stroke_width = Number.parseFloat(
      [
        inline_style.strokeWidth,
        computed.getPropertyValue(`stroke-width`),
        element.getAttribute(`stroke-width`),
      ].find(Boolean) ?? ``,
    )
    if (Number.isFinite(stroke_width)) {
      max_stroke_width = Math.max(max_stroke_width, stroke_width)
    }
  }
  return max_stroke_width / 2
}

// Copy the given computed-style props from each live SVG element to its clone counterpart;
// identical structure lets querySelectorAll(`*`) walk both in lockstep. Writes clone-only.
function inline_computed_styles(
  live: SVGElement,
  clone: SVGElement,
  properties: readonly string[],
) {
  const live_els = [live, ...live.querySelectorAll(`*`)]
  const clone_els = [clone, ...clone.querySelectorAll(`*`)]
  for (const [idx, live_el] of live_els.entries()) {
    const computed = getComputedStyle(live_el)
    for (const prop of properties) {
      const val = computed.getPropertyValue(prop)
      if (val) clone_els[idx].setAttribute(prop, val)
    }
  }
}

// A <canvas> inside a <foreignObject> is a live bitmap, not markup: the serializer emits
// the empty element and the pixels are lost, so an exported dense scatter comes out with
// no points at all. Swap each one for an <image> carrying the same pixels.
function inline_foreign_canvases(source: SVGElement, clone: SVGElement): void {
  const originals = [...source.querySelectorAll(`foreignObject`)]
  const copies = [...clone.querySelectorAll(`foreignObject`)]
  originals.forEach((original, idx) => {
    const canvas = original.querySelector(`canvas`)
    const copy = copies[idx]
    if (!canvas?.width || !canvas.height || !copy) return
    let href: string
    try {
      href = canvas.toDataURL(`image/png`)
    } catch {
      return // tainted by a cross-origin draw; leaving the blank foreignObject is all we can do
    }
    const image = document.createElementNS(`http://www.w3.org/2000/svg`, `image`)
    for (const attr of [`x`, `y`, `width`, `height`]) {
      const value = copy.getAttribute(attr)
      if (value != null) image.setAttribute(attr, value)
    }
    image.setAttribute(`href`, href)
    copy.replaceWith(image)
  })
}

// Clone, inline the given computed-style props, ensure font-family + xmlns, then serialize
// to a standalone SVG string. Never mutates the live element.
function serialize_svg_for_export(
  svg_element: SVGElement,
  inline_styles: readonly string[] = [],
  viewbox_padding = 0,
  raster_size?: [width: number, height: number],
): string {
  const clone = svg_element.cloneNode(true) as SVGElement
  if (inline_styles.length) inline_computed_styles(svg_element, clone, inline_styles)
  // After the style pass, which walks source and clone in parallel by index
  inline_foreign_canvases(svg_element, clone)
  // Interactive HTML controls taint a rasterized SVG. Components supply static SVG
  // replacements using the same label layout, while transient tooltips are omitted.
  for (const element of clone.querySelectorAll(`[data-export-exclude]`)) element.remove()
  for (const element of clone.querySelectorAll(`[data-export-only]`)) {
    element.removeAttribute(`display`)
    element.removeAttribute(`data-export-only`)
  }
  const padded_viewbox =
    viewbox_padding > 0 || raster_size ? svg_viewbox(svg_element, viewbox_padding) : null
  if (padded_viewbox) clone.setAttribute(`viewBox`, padded_viewbox.join(` `))
  if (raster_size) {
    const [width, height] = raster_size
    clone.setAttribute(`width`, String(width))
    clone.setAttribute(`height`, String(height))
    clone.style.width = `${width}px`
    clone.style.height = `${height}px`
  }
  set_svg_font_family(clone)
  if (!clone.hasAttribute(`xmlns`)) {
    clone.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
  }
  return new XMLSerializer().serializeToString(clone)
}

// Wrap serialize_svg_for_export's output as a full SVG document string (XML declaration +
// DOCTYPE + SVG), suitable for saving to file.
export function svg_to_svg_string(
  svg_element: SVGElement,
  // CSS props to inline from computed styles as presentation attributes; a standalone SVG
  // drops page stylesheets (e.g. Svelte component styles), so class-based styling is lost.
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
): string {
  const viewbox_padding = resolve_viewbox_padding(svg_element, options)
  const svg_string = serialize_svg_for_export(svg_element, inline_styles, viewbox_padding)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg_string}`
}

// Export SVG element as SVG file (triggers browser download)
export function export_svg_as_svg(
  svg_element: SVGElement | null,
  filename: string,
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
  save: FileSaver = download,
): void | Promise<void> {
  if (!svg_element) {
    console.warn(`SVG element not found for export`)
    return
  }
  const svg_content = svg_to_svg_string(svg_element, inline_styles, options)
  return save(svg_content, filename, `image/svg+xml;charset=utf-8`)
}

// Rasterize an SVG using its viewBox or viewport dimensions.
export async function svg_to_png_blob(
  svg_element: SVGElement,
  png_dpi = DEFAULT_PNG_DPI,
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
): Promise<Blob> {
  const padding = resolve_viewbox_padding(svg_element, options)
  const padded_viewbox = svg_viewbox(svg_element, padding)
  if (!padded_viewbox) throw new Error(`Invalid SVG dimensions for PNG export`)
  const [, , width, height] = padded_viewbox
  if (!Number.isFinite(png_dpi) || png_dpi <= 0) {
    throw new Error(`Invalid PNG DPI for export`)
  }

  const resolution_multiplier = dpi_to_scale(png_dpi)
  // Floor at 1px: small viewBoxes at low DPI round to 0 and make toBlob fail confusingly
  const pixel_width = Math.max(1, Math.round(width * resolution_multiplier))
  const pixel_height = Math.max(1, Math.round(height * resolution_multiplier))

  const canvas = document.createElement(`canvas`)
  const ctx = canvas.getContext(`2d`)
  if (!ctx) throw new Error(`Canvas 2D context not available`)

  canvas.width = pixel_width
  canvas.height = pixel_height

  const serialized = serialize_svg_for_export(svg_element, inline_styles, padding, [
    pixel_width,
    pixel_height,
  ])
  const svg_blob = new Blob([serialized], { type: `image/svg+xml;charset=utf-8` })
  const svg_data_url = URL.createObjectURL(svg_blob)
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
          img.src = svg_data_url
        }),
      export_timeout_ms((pixel_width * pixel_height * 4) / 1e6),
      `SVG image load`,
    )
    ctx.clearRect(0, 0, pixel_width, pixel_height)
    ctx.drawImage(img, 0, 0, pixel_width, pixel_height)
    return await canvas_to_blob(canvas)
  } catch (error) {
    throw to_error(error)
  } finally {
    listeners.abort()
    URL.revokeObjectURL(svg_data_url)
  }
}

// Export SVG element as PNG (triggers browser download)
export async function export_svg_as_png(
  svg_element: SVGElement | null,
  filename: string,
  png_dpi = DEFAULT_PNG_DPI,
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
  save: FileSaver = download,
): Promise<void> {
  if (!svg_element) {
    console.warn(`SVG element not found for PNG export`)
    return
  }
  await save(
    await svg_to_png_blob(svg_element, png_dpi, inline_styles, options),
    filename,
    `image/png`,
  )
}

// Watch a wrapper element for <canvas> insertion/removal: calls set(bool) immediately
// and on every DOM mutation. Returns a cleanup that disconnects the observer (or
// undefined when no wrapper is given). Used by export panes to enable canvas exports.
export function observe_canvas_presence(
  wrapper: HTMLElement | undefined,
  set: (has_canvas: boolean) => void,
): (() => void) | undefined {
  if (!wrapper) {
    set(false)
    return undefined
  }
  const check = () => set(Boolean(wrapper.querySelector(`canvas`)))
  check()
  const observer = new MutationObserver(check)
  observer.observe(wrapper, { childList: true, subtree: true })
  return () => observer.disconnect()
}

// Bitrate target (bits/s) for AV1 exports, clamped to [1, 200] Mbps.
// This pixel-rate heuristic also drives the file-size estimate; actual sizes vary by scene.
export const estimate_video_bitrate = (pixel_count: number, fps: number): number =>
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
  signal?.throwIfAborted()
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
  signal?.throwIfAborted()
  let restore_renderer: (() => void) | undefined
  try {
    const prepare = async (idx: number) => {
      signal?.throwIfAborted()
      on_progress?.((idx / Math.max(1, total_frames)) * 100)
      signal?.throwIfAborted()
      await abortable(() => on_step?.(idx, signal), signal)
      await wait_for_video_tick(signal)
      await wait_for_video_tick(signal)
    }
    if (total_frames > 0) await prepare(0)
    const view = scene_registry.get(canvas)
    const export_camera =
      view && (sample || width !== undefined) ? view.camera.clone() : view?.camera
    if (
      sample &&
      !(
        export_camera instanceof PerspectiveCamera ||
        export_camera instanceof OrthographicCamera
      )
    )
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
      signal?.throwIfAborted()
      if (
        export_camera instanceof PerspectiveCamera ||
        export_camera instanceof OrthographicCamera
      ) {
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
      if (idx > 0) await prepare(idx)
      if (idx > 0) capture(idx)
      await abortable(() => sink.frame(capture_canvas, idx, signal), signal)
      signal?.throwIfAborted()
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
            const track = stream?.getVideoTracks()[0] as
              | CanvasCaptureMediaStreamTrack
              | undefined
            if (total_frames > 0) track?.requestFrame?.()
          })
          recording_start = performance.now()
          frame_start = recording_start
        },
        frame: async (_canvas, idx) => {
          const track = stream?.getVideoTracks()[0] as
            | CanvasCaptureMediaStreamTrack
            | undefined
          if (idx > 0) track?.requestFrame?.()
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
