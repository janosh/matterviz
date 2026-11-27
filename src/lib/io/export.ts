import { DEFAULT_VIDEO_RESOLUTION } from '#lib/constants'
import { download, type DownloadData, type FileExportContext } from 'svelte-widgets/browser'
import {
  DEFAULT_PNG_DPI,
  dpi_to_scale,
  encode_canvas_png,
  export_figure,
  export_timeout_ms,
  type CanvasFigureOptions,
} from 'svelte-widgets/figure-export'
import type { ExportItem, ExportPaneContext, ExportSection } from './types'
import { abortable, clamp, to_error, with_timeout } from 'svelte-widgets/utils'
// three.js and the scene camera helpers are imported dynamically where GPU canvases need
// them: every 2D plot imports this module for SVG/PNG export, and static imports put
// three.js in each plot page's initial bundle
import type { Camera, Scene, Vector2, WebGPURenderer } from 'three/webgpu'
import type { CameraFlight } from '#lib/scene/camera-flight'

// Maps a Threlte canvas to its renderer so PNG export can look up the renderer for a
// given canvas without mutating the DOM element. Populated by bind_renderer (scene/).
export const renderer_registry = new WeakMap<HTMLCanvasElement, WebGPURenderer>()

// Companion scene+camera mapping: the drawing buffer is cleared after present, so any
// capture of a live canvas must re-render it first — which needs the scene and active camera.
// `ready` resolves once the scene shows what was requested (e.g. isosurfaces still meshing).
export const scene_registry = new WeakMap<
  HTMLCanvasElement,
  { scene: Scene; camera: Camera; ready?: () => Promise<void> }
>()

const device_timeout_ms = 5000
// Wait for the GPU device, but never indefinitely: an unfulfilled device request would leave
// the export promise pending forever, giving the user neither a file nor an error.
// init() caches its own promise, so repeat calls are free.
export async function wait_for_renderer(renderer: WebGPURenderer): Promise<void> {
  await with_timeout(() => renderer.init(), device_timeout_ms, `GPU initialization`)
}

// The capture's pixel size and the GPU's per-dimension texture limit, checked before resizing:
// an oversized drawing buffer can invalidate the live viewer.
function validate_capture_size(
  renderer: WebGPURenderer,
  size: Vector2,
  pixel_ratio: number,
): { width: number; height: number; max_dimension: number } {
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
  return { width, height, max_dimension }
}

// GPU PNG exports render at up to this multiple of their pixel size (as far as the GPU's
// texture limit allows) and downscale, for edges smoother than MSAA alone gives
export const PNG_SUPERSAMPLE = 2
// Most pixels a supersampled render may hold (16 MP, ~64 MB at 4 bytes each, before the GPU's
// own render targets): larger captures use the largest factor that fits, down to none
export const PNG_SUPERSAMPLE_PIXELS = 16e6

// PNG of a live canvas at `png_dpi` (72 DPI = one pixel per CSS pixel), independent of the
// screen's devicePixelRatio. GPU canvases re-render their registered scene at that pixel ratio
// times `supersample` (the drawing buffer is cleared after present, so even a same-size
// capture renders first); plain 2D canvases encode as-is when their backing store already has
// the target size.
export async function canvas_to_png_blob(
  canvas: HTMLCanvasElement,
  png_dpi = DEFAULT_PNG_DPI,
  supersample = PNG_SUPERSAMPLE,
): Promise<Blob> {
  const renderer = renderer_registry.get(canvas)
  // a 2D canvas: its export painter or its pixels scaled, as figure exports draw it
  if (!renderer) return export_figure(canvas, { format: `png`, dpi: png_dpi })
  const scale = dpi_to_scale(png_dpi)
  // the DPI the scale realizes, after dpi_to_scale's clamping
  const export_dpi = scale * 72

  const [{ Vector2 }, { depth_cues, render_scene }] = await Promise.all([
    import('three/webgpu'),
    import('#lib/scene/lighting'),
    wait_for_renderer(renderer),
  ])
  await scene_registry.get(canvas)?.ready?.()
  const release = await lock_capture(renderer)
  try {
    const view = scene_registry.get(canvas)
    const orig_pixel_ratio = renderer.getPixelRatio()
    const orig_size = renderer.getSize(new Vector2())
    const { width, height, max_dimension } = validate_capture_size(renderer, orig_size, scale)
    const fits = Math.floor(max_dimension / Math.max(width, height))
    const fits_budget = Math.floor(Math.sqrt(PNG_SUPERSAMPLE_PIXELS / (width * height)))
    const factor = clamp(Math.min(fits, fits_budget), 1, supersample)
    const render_ratio = scale * factor
    const resize = Math.abs(render_ratio - orig_pixel_ratio) > 1e-6
    // On a transparent PNG a depth cue would fade toward the page color and leave faded parts
    // grey, so such captures render without it; opaque ones keep it
    const transparent = !view?.scene.background && renderer.getClearAlpha() < 1
    const cue = view && transparent ? depth_cues.get(view.scene) : undefined
    try {
      if (cue) cue.shown.value = 0
      if (resize)
        renderer.setDrawingBufferSize(orig_size.width, orig_size.height, render_ratio)
      if (view) render_scene(renderer, view.scene, view.camera)
      const rendered = await encode_canvas_png(canvas, export_dpi)
      if (factor === 1) return rendered
      // downscale the encoded render: drawing the GPU canvas itself into a 2D context reads
      // back blank under software WebGPU (CI's SwiftShader), while its toBlob is reliable
      const bitmap = await createImageBitmap(rendered)
      const target = Object.assign(document.createElement(`canvas`), { width, height })
      const ctx = target.getContext(`2d`)
      if (!ctx) throw new Error(`Canvas 2D context not available`)
      ctx.imageSmoothingQuality = `high`
      ctx.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()
      return await encode_canvas_png(target, export_dpi)
    } finally {
      if (cue) cue.shown.value = 1
      if (resize)
        renderer.setDrawingBufferSize(orig_size.width, orig_size.height, orig_pixel_ratio)
      // the canvas shows the capture frame (or a cleared buffer) until redrawn
      if (view) render_scene(renderer, view.scene, view.camera)
    }
  } finally {
    release()
  }
}

// Captures of one renderer take turns: each restores the drawing buffer size it found, so one
// starting mid-capture would "restore" the export size and leave the live viewer stuck at it
const capture_queues = new WeakMap<WebGPURenderer, Promise<undefined>>()
async function lock_capture(renderer: WebGPURenderer): Promise<() => void> {
  const previous = capture_queues.get(renderer)
  const turn = Promise.withResolvers<undefined>()
  capture_queues.set(renderer, turn.promise)
  await previous
  return () => turn.resolve(undefined)
}

// Where an export writes its files: an export pane's FileExportContext (see its `open`), or
// browser downloads for exports run outside one
export type FileDestination = Omit<FileExportContext, `filename`>
export const BROWSER_DOWNLOADS: FileDestination = {
  destination: `downloads`,
  open: async (filename, mime) => async (data) => download(data, filename, mime),
}

// Export a canvas as PNG named `<basename>-<dpi>dpi.png`
export async function export_canvas_as_png(
  canvas: HTMLCanvasElement,
  filename: string,
  png_dpi = DEFAULT_PNG_DPI,
  { open }: FileDestination = BROWSER_DOWNLOADS,
): Promise<void> {
  const basename = filename.replace(/\.png$/i, ``)
  const write = await open(`${basename}-${Math.round(png_dpi)}dpi.png`, `image/png`)
  await write(await canvas_to_png_blob(canvas, png_dpi))
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
  // Receives each serialized file instead of the default save to the pane's destination. The
  // data is encoded before this runs, so a Save As `open` here may come after the click's
  // user activation has lapsed (about 5 s in Chromium) and be refused
  on_export?: (format: ExportFormat, context: ExportContext) => void | Promise<void>
}

// Serialize one format and save it, or hand it to on_export. Without on_export the file opens
// first, so the destination is checked (or a Save As dialog answered) before encoding.
export async function run_export(
  format: ExportFormat,
  source: ExportSource,
  context: ExportPaneContext,
  on_export?: ExportProps[`on_export`],
): Promise<void> {
  const mime = EXPORT_MIME[format]
  if (on_export) {
    const data = await source(context.png_dpi)
    return on_export(format, { ...context, data, mime })
  }
  const write = await context.open(`${context.filename}.${format}`, mime)
  await write(await source(context.png_dpi))
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

// SVG and PNG sources for a live figure (an SVG chart or an HTML element laid out as one),
// looked up per export since it may re-mount
export const svg_sources = (
  get_figure: () => SVGElement | HTMLElement | null | undefined,
): ExportSources => ({
  png: (png_dpi) =>
    export_figure(require_element(get_figure(), `figure`), { format: `png`, dpi: png_dpi }),
  svg: async () =>
    (await export_figure(require_element(get_figure(), `figure`), { format: `svg` })).text(),
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

// A live canvas (re-rendered at the export DPI, see canvas_to_png_blob) with `overlays` laid
// over it: canvases stacked on it (annotation layers) as they are, HTML (legends, color bars,
// scene labels) redrawn on top at its on-screen position, as vector SVG in SVG exports
export const canvas_figure = async (
  canvas: HTMLCanvasElement | null | undefined,
  options: Omit<CanvasFigureOptions, `render_frame`>,
): Promise<Blob> =>
  export_figure(require_element(canvas, `canvas`), {
    ...options,
    render_frame: canvas_to_png_blob,
  })

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
  const [
    { Vector2, PerspectiveCamera, OrthographicCamera },
    { create_camera_flight_sampler },
    { set_pan_offset },
    { render_scene },
  ] = await Promise.all([
    import('three/webgpu'),
    import('#lib/scene/camera-flight'),
    import('#lib/scene/pan'),
    import('#lib/scene/lighting'),
  ])
  const sample = camera_flight && create_camera_flight_sampler(camera_flight)
  const renderer = renderer_registry.get(canvas)
  if (renderer) await wait_for_renderer(renderer)
  signal.throwIfAborted()
  // the drawing buffer stays at the video size for the whole recording
  const release = renderer && (await lock_capture(renderer))
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
            throw new TypeError(
              `Select ${pose.projection} projection before rendering this movie`,
            )
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
      if (renderer && view && export_camera) render_scene(renderer, view.scene, export_camera)
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
    release?.()
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
