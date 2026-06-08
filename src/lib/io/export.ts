import { download } from '$lib/io/fetch'
import type { AnyStructure } from '$lib/structure'
import { create_structure_filename } from '$lib/structure/export'
import { to_error } from '$lib/utils'
import { type Camera, type Scene, Vector2, type WebGLRenderer } from 'three'

function is_webgl_renderer_like(value: unknown): value is WebGLRenderer {
  if (typeof value !== `object` || !value) return false
  const renderer_obj = value as Record<string, unknown>
  return (
    typeof renderer_obj.render === `function` &&
    typeof renderer_obj.getPixelRatio === `function` &&
    typeof renderer_obj.setPixelRatio === `function` &&
    typeof renderer_obj.getSize === `function` &&
    typeof renderer_obj.setSize === `function`
  )
}

function get_canvas_renderer(canvas: HTMLCanvasElement): WebGLRenderer | undefined {
  // oxlint-disable-next-line no-underscore-dangle -- three.js stores its renderer here
  const renderer_val = (canvas as unknown as Record<string, unknown>).__renderer
  return is_webgl_renderer_like(renderer_val) ? renderer_val : undefined
}

// Capture a WebGL canvas as a PNG Blob at the given DPI.
// Temporarily adjusts renderer pixel ratio for high-res capture, then restores.
// Returns data directly (no browser download), suitable for programmatic capture
// in test suites, server-side rendering, or Python widget integration via anywidget.
// DPI is converted to a resolution multiplier relative to 72 DPI baseline, capped at 10x.
export function canvas_to_png_blob(
  canvas: HTMLCanvasElement,
  png_dpi = 150,
  scene: Scene | null = null,
  camera: Camera | null = null,
): Promise<Blob> {
  const resolution_multiplier = Math.min(png_dpi / 72, 10)
  const renderer = get_canvas_renderer(canvas)

  if (resolution_multiplier <= 1.1 || !renderer) {
    if (renderer && scene && camera) renderer.render(scene, camera)
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error(`Failed to generate PNG - canvas may be empty`))
        }, `image/png`)
      } catch (error) {
        reject(to_error(error))
      }
    })
  }

  // Temporarily modify the renderer's pixel ratio for high-res capture
  const orig_pixel_ratio = renderer.getPixelRatio()
  const orig_size = renderer.getSize(new Vector2())
  const restore = () => {
    renderer.setPixelRatio(orig_pixel_ratio)
    renderer.setSize(orig_size.width, orig_size.height, false)
  }

  renderer.setPixelRatio(resolution_multiplier)
  renderer.setSize(orig_size.width, orig_size.height, false)
  if (scene && camera) renderer.render(scene, camera)

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        restore()
        if (blob) resolve(blob)
        else reject(new Error(`Failed to generate high-resolution PNG`))
      }, `image/png`)
    } catch (error) {
      restore()
      reject(to_error(error))
    }
  })
}

// Export structure as PNG image from canvas (triggers browser download)
export function export_canvas_as_png(
  canvas: HTMLCanvasElement | null,
  structure_or_filename: AnyStructure | string | undefined,
  png_dpi = 150,
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
    .catch((error) => console.error(`Error exporting PNG:`, error))
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

// Clone, inline the given computed-style props, ensure font-family + xmlns, then serialize
// to a standalone SVG string. Never mutates the live element.
function serialize_svg_for_export(
  svg_element: SVGElement,
  inline_styles: readonly string[] = [],
): string {
  const clone = svg_element.cloneNode(true) as SVGElement
  if (inline_styles.length) inline_computed_styles(svg_element, clone, inline_styles)
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
): string {
  const svg_string = serialize_svg_for_export(svg_element, inline_styles)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg_string}`
}

// Export SVG element as SVG file (triggers browser download)
export function export_svg_as_svg(
  svg_element: SVGElement | null,
  filename: string,
  inline_styles: readonly string[] = [],
): void {
  if (!svg_element) {
    console.warn(`SVG element not found for export`)
    return
  }
  try {
    const svg_content = svg_to_svg_string(svg_element, inline_styles)
    download(svg_content, filename, `image/svg+xml;charset=utf-8`)
  } catch (error) {
    console.error(`Error exporting SVG:`, error)
  }
}

// Rasterize an SVG element to a PNG Blob at the given DPI.
// Creates an offscreen canvas at the scaled resolution, draws the SVG via an
// Image element, and returns the resulting PNG Blob. Rejects if viewBox is
// missing or dimensions are invalid (zero width/height).
// DPI is converted to a resolution multiplier relative to 72 DPI baseline, capped at 10x.
export function svg_to_png_blob(
  svg_element: SVGElement,
  png_dpi = 150,
  inline_styles: readonly string[] = [],
): Promise<Blob> {
  const viewBox = svg_element.getAttribute(`viewBox`)?.trim()
  if (!viewBox) return Promise.reject(new Error(`SVG viewBox not found for PNG export`))

  const parts = viewBox.split(/[\s,]+/).map(Number)
  if (parts.length < 4 || !parts.every(Number.isFinite)) {
    return Promise.reject(new Error(`Invalid SVG dimensions for PNG export`))
  }
  const [, , width, height] = parts
  if (!(width > 0) || !(height > 0)) {
    return Promise.reject(new Error(`Invalid SVG dimensions for PNG export`))
  }
  if (!Number.isFinite(png_dpi) || png_dpi <= 0) {
    return Promise.reject(new Error(`Invalid PNG DPI for export`))
  }

  const resolution_multiplier = Math.min(png_dpi / 72, 10)
  const pixel_width = Math.round(width * resolution_multiplier)
  const pixel_height = Math.round(height * resolution_multiplier)

  const canvas = document.createElement(`canvas`)
  const ctx = canvas.getContext(`2d`)
  if (!ctx) return Promise.reject(new Error(`Canvas 2D context not available`))

  canvas.width = pixel_width
  canvas.height = pixel_height

  const serialized = serialize_svg_for_export(svg_element, inline_styles)
  const svg_blob = new Blob([serialized], { type: `image/svg+xml;charset=utf-8` })
  const svg_data_url = URL.createObjectURL(svg_blob)

  return new Promise((resolve, reject) => {
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
        URL.revokeObjectURL(svg_data_url)
      }
    })
    img.addEventListener(`error`, () => {
      URL.revokeObjectURL(svg_data_url)
      reject(new Error(`Failed to load SVG for PNG export`))
    })
    img.src = svg_data_url
  })
}

// Export SVG element as PNG (triggers browser download)
export function export_svg_as_png(
  svg_element: SVGElement | null,
  filename: string,
  png_dpi = 150,
  inline_styles: readonly string[] = [],
): void {
  if (!svg_element) {
    console.warn(`SVG element not found for PNG export`)
    return
  }
  svg_to_png_blob(svg_element, png_dpi, inline_styles)
    .then((blob) => download(blob, filename, `image/png`))
    .catch((error) => console.error(`Error exporting PNG:`, error))
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
  Math.max(1_000_000, Math.min(pixel_count * fps * 0.1, 200_000_000))

// Generate FFmpeg command for WebM to MP4 conversion
export function get_ffmpeg_conversion_command(input_filename: string): string {
  const output = input_filename.replace(/\.webm$/i, `.mp4`)
  return `ffmpeg -i "${input_filename}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags faststart "${output}"`
}

// Export trajectory video as WebM with frame-by-frame rendering to prevent dropped frames.
// Note: Browsers only support WebM natively. Use FFmpeg for MP4 conversion (see get_ffmpeg_conversion_command).
export async function export_trajectory_video(
  canvas: HTMLCanvasElement | null,
  filename: string,
  options: {
    fps?: number
    total_frames?: number
    on_progress?: (progress: number) => void
    on_step?: (step_idx: number) => void | Promise<void>
    resolution_multiplier?: number
  } = {},
): Promise<void> {
  const {
    fps = 30,
    total_frames = 100,
    on_progress,
    on_step,
    resolution_multiplier = 1,
  } = options

  if (
    !canvas ||
    typeof MediaRecorder === `undefined` ||
    !MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`)
  )
    throw new Error(`WebM video recording not supported in this browser`)

  const renderer = get_canvas_renderer(canvas)

  // Store original renderer settings if changing resolution
  let orig_pixel_ratio: number | undefined
  let orig_size: Vector2 | undefined

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

  const stream = canvas.captureStream(0)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: `video/webm;codecs=vp9`,
    videoBitsPerSecond: bitrate,
  })

  recorder.addEventListener(`dataavailable`, (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })

  const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void
  }

  // Start recording
  recorder.start()

  const frame_duration = 1000 / fps

  try {
    // Render each frame sequentially with precise timing
    for (let idx = 0; idx < total_frames; idx++) {
      const frame_start = performance.now()

      on_progress?.((idx / total_frames) * 100)

      // Update trajectory step
      if (on_step) await on_step(idx)

      // Double RAF ensures Three.js completes rendering before capture
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      )

      // Capture frame
      track.requestFrame?.()

      // Wait for remaining frame time to maintain consistent FPS
      const elapsed = performance.now() - frame_start
      const remaining = Math.max(0, frame_duration - elapsed)
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
    }
  } finally {
    // Restore original renderer settings
    if (orig_pixel_ratio !== undefined && orig_size && renderer) {
      renderer.setPixelRatio(orig_pixel_ratio)
      renderer.setSize(orig_size.width, orig_size.height, false)
    }
  }

  // Finalize recording
  return new Promise((resolve, reject) => {
    let is_resolved = false

    recorder.addEventListener(`stop`, () => {
      if (is_resolved) return
      is_resolved = true

      try {
        const blob = new Blob(chunks, { type: `video/webm` })
        const webm_filename = filename.replace(/\.(mp4|webm)$/i, `.webm`)
        download(blob, webm_filename, `video/webm`)
        on_progress?.(100)
        resolve()
      } catch (error) {
        reject(to_error(error))
      }
    })

    recorder.addEventListener(`error`, (event) => {
      if (is_resolved) return
      is_resolved = true
      const error_msg =
        event instanceof ErrorEvent && event.error instanceof Error
          ? event.error.message
          : event.type
      reject(new Error(`MediaRecorder error: ${error_msg}`))
    })

    // Stop recording with safety timeout
    try {
      recorder.stop()
      // Fallback: force resolution if recorder doesn't stop within 5 seconds
      setTimeout(() => {
        if (!is_resolved) {
          is_resolved = true
          reject(new Error(`Recording timeout - recorder did not stop`))
        }
      }, 5000)
    } catch (error) {
      if (!is_resolved) {
        is_resolved = true
        reject(to_error(error))
      }
    }
  })
}
