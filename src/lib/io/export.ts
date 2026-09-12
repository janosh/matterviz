import { DEFAULT_PNG_DPI } from '$lib/constants'
import { download } from '$lib/io/fetch'
import { clamp } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { create_structure_filename } from '$lib/structure/export'
import { to_error } from '$lib/utils'
import { type Camera, type Scene, Vector2, type WebGPURenderer } from 'three/webgpu'

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
const blob_timeout_ms = 5000

function canvas_to_blob(canvas: HTMLCanvasElement, failure_message: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, blob?: Blob): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (blob) resolve(blob)
      else reject(new Error(failure_message))
    }
    const timer = setTimeout(
      () =>
        finish(new Error(`${failure_message}: toBlob timed out after ${blob_timeout_ms}ms`)),
      blob_timeout_ms,
    )
    try {
      canvas.toBlob((blob) => finish(undefined, blob ?? undefined), `image/png`)
    } catch (error) {
      finish(to_error(error))
    }
  })
}

// Wait for the GPU device, but never indefinitely: an unfulfilled device request would leave
// the export promise pending forever, giving the user neither a file nor an error.
async function device_ready(renderer: WebGPURenderer): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      renderer.init().then(() => true), // caches its own promise, so repeat calls are free
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), device_timeout_ms)
      }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Re-render a GPU canvas so its drawing buffer holds a fresh frame at capture time. Awaits the
// device since render() throws before init() resolves and this runs outside Threlte's loop.
// Without one, capture whatever the canvas holds — stale beats an export that never resolves.
// Software WebGPU (CI) can throw on createBuffer during render; swallow and keep going.
async function render_for_capture(
  renderer: WebGPURenderer,
  scene: Scene | null,
  camera: Camera | null,
): Promise<void> {
  if (!scene || !camera) return
  if (!(await device_ready(renderer))) return
  try {
    renderer.render(scene, camera)
  } catch (error) {
    console.warn(`PNG capture re-render failed; exporting current canvas buffer`, error)
  }
}

// Capture at the renderer's current pixel ratio after an optional re-render.
async function capture_native(
  canvas: HTMLCanvasElement,
  renderer: WebGPURenderer | undefined,
  scene: Scene | null,
  camera: Camera | null,
): Promise<Blob> {
  if (renderer) await render_for_capture(renderer, scene, camera)
  return canvas_to_blob(canvas, `Failed to generate PNG - canvas may be empty`)
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
  const renderer = renderer_registry.get(canvas)

  if (resolution_multiplier <= 1.1) return capture_native(canvas, renderer, scene, camera)

  if (!renderer) {
    const scaled_canvas = document.createElement(`canvas`)
    scaled_canvas.width = Math.max(1, Math.round(canvas.width * resolution_multiplier))
    scaled_canvas.height = Math.max(1, Math.round(canvas.height * resolution_multiplier))
    const context = scaled_canvas.getContext(`2d`)
    if (!context) throw new Error(`Canvas 2D context not available`)
    context.drawImage(canvas, 0, 0, scaled_canvas.width, scaled_canvas.height)
    return canvas_to_blob(scaled_canvas, `Failed to generate high-resolution PNG`)
  }

  // Temporarily modify the renderer's pixel ratio for high-res capture
  const orig_pixel_ratio = renderer.getPixelRatio()
  const orig_size = renderer.getSize(new Vector2())
  const restore = () => {
    renderer.setPixelRatio(orig_pixel_ratio)
    renderer.setSize(orig_size.width, orig_size.height, false)
  }

  try {
    // Multiplied by the live ratio, not set outright: on a HiDPI display the renderer is
    // already at 2, so assigning the multiplier directly SHRANK the export. An 800x600 scene
    // on a dpr-2 screen went from a native 1600x1200 to 1111x833 at 100 DPI, and everything
    // below ~144 DPI exported at less than screen resolution. export_trajectory_video, a few
    // hundred lines down, already scales the same way.
    renderer.setPixelRatio(orig_pixel_ratio * resolution_multiplier)
    renderer.setSize(orig_size.width, orig_size.height, false)
    await render_for_capture(renderer, scene, camera)
    return await canvas_to_blob(canvas, `Failed to generate high-resolution PNG`)
  } catch (error) {
    // High-DPI needs larger mapped GPU buffers; CI's software WebGPU often refuses them.
    console.warn(
      `High-DPI PNG capture failed; falling back to native canvas resolution`,
      error,
    )
  } finally {
    restore()
  }
  // Reached only on failure: the renderer is back at native resolution by now
  return capture_native(canvas, renderer, scene, camera)
}

// Export structure as PNG image from canvas (triggers browser download)
export function export_canvas_as_png(
  canvas: HTMLCanvasElement | null,
  structure_or_filename: AnyStructure | string | undefined,
  png_dpi = DEFAULT_PNG_DPI,
  scene: Scene | null = null,
  camera: Camera | null = null,
): void {
  if (!canvas) {
    if (typeof window !== `undefined`) console.warn(`Canvas not found for PNG export`)
    return
  }

  let filename =
    typeof structure_or_filename === `string`
      ? structure_or_filename
      : create_structure_filename(structure_or_filename, `png`)

  const suffix = `-${Math.round(png_dpi)}dpi`
  if (filename.toLowerCase().endsWith(`.png`)) {
    filename = filename.replace(/\.png$/i, `${suffix}.png`)
  } else {
    filename = `${filename}${suffix}.png`
  }

  canvas_to_png_blob(canvas, png_dpi, scene, camera)
    .then((blob) => download(blob, filename, `image/png`))
    .catch((error: unknown) => console.error(`Error exporting PNG:`, error))
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
): void {
  if (!svg_element) {
    console.warn(`SVG element not found for export`)
    return
  }
  try {
    const svg_content = svg_to_svg_string(svg_element, inline_styles, options)
    download(svg_content, filename, `image/svg+xml;charset=utf-8`)
  } catch (error) {
    console.error(`Error exporting SVG:`, error)
  }
}

// Rasterize an SVG using its viewBox or viewport dimensions.
export function svg_to_png_blob(
  svg_element: SVGElement,
  png_dpi = DEFAULT_PNG_DPI,
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
): Promise<Blob> {
  const padding = resolve_viewbox_padding(svg_element, options)
  const padded_viewbox = svg_viewbox(svg_element, padding)
  if (!padded_viewbox)
    return Promise.reject(new Error(`Invalid SVG dimensions for PNG export`))
  const [, , width, height] = padded_viewbox
  if (!Number.isFinite(png_dpi) || png_dpi <= 0) {
    return Promise.reject(new Error(`Invalid PNG DPI for export`))
  }

  const resolution_multiplier = dpi_to_scale(png_dpi)
  // Floor at 1px: small viewBoxes at low DPI round to 0 and make toBlob fail confusingly
  const pixel_width = Math.max(1, Math.round(width * resolution_multiplier))
  const pixel_height = Math.max(1, Math.round(height * resolution_multiplier))

  const canvas = document.createElement(`canvas`)
  const ctx = canvas.getContext(`2d`)
  if (!ctx) return Promise.reject(new Error(`Canvas 2D context not available`))

  canvas.width = pixel_width
  canvas.height = pixel_height

  const serialized = serialize_svg_for_export(svg_element, inline_styles, padding, [
    pixel_width,
    pixel_height,
  ])
  const svg_blob = new Blob([serialized], { type: `image/svg+xml;charset=utf-8` })
  const svg_data_url = URL.createObjectURL(svg_blob)
  let url_revoked = false
  const revoke_url = () => {
    if (url_revoked) return
    url_revoked = true
    URL.revokeObjectURL(svg_data_url)
  }

  return new Promise((resolve, reject) => {
    try {
      const img = new Image()
      img.addEventListener(`load`, () => {
        try {
          ctx.clearRect(0, 0, pixel_width, pixel_height)
          ctx.drawImage(img, 0, 0, pixel_width, pixel_height)
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob)
              else reject(new Error(`Failed to generate PNG blob`))
            },
            `image/png`,
            1,
          )
        } catch (error) {
          reject(to_error(error))
        } finally {
          revoke_url()
        }
      })
      img.addEventListener(`error`, () => {
        revoke_url()
        reject(new Error(`Failed to load SVG for PNG export`))
      })
      img.src = svg_data_url
    } catch (error) {
      revoke_url()
      reject(to_error(error))
    }
  })
}

// Export SVG element as PNG (triggers browser download)
export function export_svg_as_png(
  svg_element: SVGElement | null,
  filename: string,
  png_dpi = DEFAULT_PNG_DPI,
  inline_styles: readonly string[] = [],
  options: SvgExportOptions = {},
): void {
  if (!svg_element) {
    console.warn(`SVG element not found for PNG export`)
    return
  }
  svg_to_png_blob(svg_element, png_dpi, inline_styles, options)
    .then((blob) => download(blob, filename, `image/png`))
    .catch((error: unknown) => console.error(`Error exporting PNG:`, error))
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

// Estimate VP9 video bitrate (bits/s) from pixel count and frame rate.
// VP9 needs ~0.1 bits per pixel per frame for good quality; clamped to [1, 200] Mbps.
export const estimate_video_bitrate = (pixel_count: number, fps: number): number =>
  clamp(pixel_count * fps * 0.1, 1_000_000, 200_000_000)

// Generate FFmpeg command for WebM to MP4 conversion
export function get_ffmpeg_conversion_command(input_filename: string): string {
  const output = input_filename.replace(/\.webm$/i, `.mp4`)
  return `ffmpeg -i "${input_filename}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags faststart "${output}"`
}

// Recorder state changes synchronously; its encoder starts and stops asynchronously.
function run_recorder_action(
  recorder: MediaRecorder,
  action: 'start' | 'stop',
  signal?: AbortSignal,
  after_action?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const listeners = new AbortController()
    const finish = (error?: Error): void => {
      clearTimeout(timeout)
      listeners.abort()
      if (error !== undefined) reject(error)
      else resolve()
    }
    const timeout = setTimeout(
      () => finish(new Error(`Recording timeout - recorder did not ${action}`)),
      5000,
    )
    recorder.addEventListener(action, () => finish(), { signal: listeners.signal })
    signal?.addEventListener(`abort`, () => finish(to_error(signal.reason)), {
      signal: listeners.signal,
      once: true,
    })
    recorder.addEventListener(
      `error`,
      (event) => {
        const message =
          event instanceof ErrorEvent && event.error instanceof Error
            ? event.error.message
            : event.type
        finish(new Error(`MediaRecorder error: ${message}`))
      },
      { signal: listeners.signal },
    )
    try {
      recorder[action]()
      after_action?.()
    } catch (error) {
      finish(to_error(error))
    }
  })
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

// Export trajectory video as WebM while advancing through the requested frames.
// Note: Browsers only support WebM natively. Use FFmpeg for MP4 conversion (see get_ffmpeg_conversion_command).
export async function export_trajectory_video(
  canvas: HTMLCanvasElement | null,
  filename: string,
  options: {
    fps?: number
    total_frames?: number
    on_progress?: (progress: number) => void
    on_step?: (step_idx: number, signal?: AbortSignal) => void | Promise<void>
    // Restore caller-owned state after recording cleanup, before any download.
    on_finish?: () => void | Promise<void>
    resolution_multiplier?: number
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const {
    fps = 30,
    total_frames = 100,
    on_progress,
    on_step,
    on_finish,
    resolution_multiplier = 1,
    signal,
  } = options

  signal?.throwIfAborted()
  if (
    !canvas ||
    typeof MediaRecorder === `undefined` ||
    !MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`)
  )
    throw new Error(`WebM video recording not supported in this browser`)

  const renderer = renderer_registry.get(canvas)
  // Recording captures the canvas stream while Threlte drives frames, but resizing the
  // renderer below touches GPU resources, so make sure the device exists first.
  if (renderer) await device_ready(renderer)
  signal?.throwIfAborted()

  // Store original renderer settings if changing resolution
  let orig_pixel_ratio: number | undefined
  let orig_size: Vector2 | undefined
  let recorder: MediaRecorder | undefined = undefined
  let stream: MediaStream | undefined
  const chunks: Blob[] = []
  const stop_recorder = () => {
    if (recorder && recorder.state !== `inactive`) recorder.stop()
  }
  // Stop capturing immediately even when a custom frame callback is still settling.
  signal?.addEventListener(`abort`, stop_recorder, { once: true })

  try {
    const prepare_step = async (idx: number): Promise<void> => {
      signal?.throwIfAborted()
      on_progress?.((idx / total_frames) * 100)
      signal?.throwIfAborted()
      await on_step?.(idx, signal)
      // Threlte resizes the canvas and updates the scene in its animation loop.
      await wait_for_video_tick(signal)
      await wait_for_video_tick(signal)
    }
    // Snapshot the mounted dimensions, not the canvas's initial 300 x 150 drawing buffer.
    if (total_frames > 0) await prepare_step(0)
    if (resolution_multiplier !== 1 && renderer) {
      orig_pixel_ratio = renderer.getPixelRatio()
      orig_size = renderer.getSize(new Vector2())
      // Adjust pixel ratio for different resolution export
      renderer.setPixelRatio(orig_pixel_ratio * resolution_multiplier)
      renderer.setSize(orig_size.width, orig_size.height, false)
    }

    // Calculate bitrate based on actual video dimensions
    // (canvas dimensions include device pixel ratio and any resolution_multiplier)
    const bitrate = estimate_video_bitrate(canvas.width * canvas.height, fps)

    // Record a stable 2D surface: direct WebGPU streams can contain no frames, and restoring
    // the renderer's resolution must not resize the recording before its encoder finishes.
    const capture_canvas = document.createElement(`canvas`)
    capture_canvas.width = canvas.width
    capture_canvas.height = canvas.height
    const context = capture_canvas.getContext(`2d`)
    if (!context) throw new Error(`Canvas 2D context not available for video export`)
    const copy_frame = (): void => {
      signal?.throwIfAborted()
      const view = scene_registry.get(canvas)
      if (renderer && view) renderer.render(view.scene, view.camera)
      context.clearRect(0, 0, capture_canvas.width, capture_canvas.height)
      context.drawImage(canvas, 0, 0)
    }
    // A stream captures its initial canvas too; never give it an unpainted first frame.
    if (total_frames > 0) copy_frame()
    stream = capture_canvas.captureStream(fps)
    recorder = new MediaRecorder(stream, {
      mimeType: `video/webm;codecs=vp9`,
      videoBitsPerSecond: bitrate,
    })

    recorder.addEventListener(`dataavailable`, (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void
    }

    // Repaint once the stream is listening, then wait for the encoder's first frame. A cold
    // encoder can otherwise start after a short trajectory has already called stop().
    await run_recorder_action(recorder, `start`, signal, () => {
      if (total_frames > 0) {
        copy_frame()
        track.requestFrame?.()
      }
    })

    const frame_duration = 1000 / fps

    // Advance frames sequentially, allowing rendering time between steps.
    for (let idx = 0; idx < total_frames; idx++) {
      const frame_start = performance.now()

      if (idx > 0) {
        await prepare_step(idx)
        copy_frame()
        track.requestFrame?.()
      }

      // Wait for remaining frame time to maintain consistent FPS
      const elapsed = performance.now() - frame_start
      const remaining = Math.max(0, frame_duration - elapsed)
      if (remaining > 0) {
        await wait_for_video_tick(signal, remaining)
      }
    }
    await run_recorder_action(recorder, `stop`, signal)
  } catch (error) {
    stop_recorder()
    throw error
  } finally {
    signal?.removeEventListener(`abort`, stop_recorder)
    try {
      // Restore original renderer settings after the encoder has finished reading frames.
      if (orig_pixel_ratio !== undefined && orig_size && renderer) {
        renderer.setPixelRatio(orig_pixel_ratio)
        renderer.setSize(orig_size.width, orig_size.height, false)
      }
    } finally {
      try {
        for (const track of stream?.getTracks() ?? []) track.stop()
      } finally {
        await on_finish?.()
      }
    }
  }
  signal?.throwIfAborted()
  const blob = new Blob(chunks, { type: `video/webm` })
  download(blob, filename.replace(/\.(?:mp4|webm)$/i, `.webm`), `video/webm`)
  on_progress?.(100)
}
