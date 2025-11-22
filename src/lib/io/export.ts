// deno-lint-ignore-file no-await-in-loop
import type { AnyStructure } from '$lib'
import { download } from '$lib/io/fetch'
import { create_structure_filename } from '$lib/structure/export'
import { type Camera, type Scene, Vector2, type WebGLRenderer } from 'three'

// Export structure as PNG image from canvas
export function export_canvas_as_png(
  canvas: HTMLCanvasElement | null,
  structure_or_filename: AnyStructure | string | undefined,
  png_dpi = 150,
  scene: Scene | null = null,
  camera: Camera | null = null,
): void {
  try {
    if (!canvas) {
      if (typeof window !== `undefined`) {
        console.warn(`Canvas not found for PNG export`)
      }
      return
    }

    // Determine filename from either structure or direct filename
    let filename = typeof structure_or_filename === `string`
      ? structure_or_filename
      : create_structure_filename(structure_or_filename, `png`)

    // Inject DPI into filename
    const suffix = `-${Math.round(png_dpi)}dpi`
    if (filename.toLowerCase().endsWith(`.png`)) {
      filename = filename.replace(/\.png$/i, `${suffix}.png`)
    } else {
      filename = `${filename}${suffix}.png`
    }

    // Convert DPI to multiplier (72 DPI is baseline web resolution)
    // Cap to a reasonable upper bound to avoid excessive memory use
    const resolution_multiplier = Math.min(png_dpi / 72, 10)
    const renderer = (canvas as { __renderer?: WebGLRenderer }).__renderer

    // Force render to populate buffer
    if (renderer && scene && camera) renderer.render(scene, camera)

    if (resolution_multiplier <= 1.1 || !renderer) {
      // Direct capture at current resolution (if DPI is close to 72 or renderer not available)
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            download(blob, filename, `image/png`)
          } else {
            if (typeof window !== `undefined`) {
              console.warn(`Failed to generate PNG - canvas may be empty`)
            }
          }
        }, `image/png`)
      } catch (error) {
        console.error(`Error during PNG export:`, error)
      }
      return
    }

    // Temporarily modify the renderer's pixel ratio for high-res capture
    const orig_pixel_ratio = renderer.getPixelRatio()
    const orig_size = renderer.getSize(new Vector2())

    try {
      // Set higher pixel ratio to increase rendering resolution
      renderer.setPixelRatio(resolution_multiplier)

      // Force the canvas to update its resolution
      renderer.setSize(orig_size.width, orig_size.height, false)

      if (scene && camera) {
        renderer.render(scene, camera)
      }

      // Capture the high-resolution render after paint completion
      canvas.toBlob((blob) => {
        // Restore original settings immediately
        renderer.setPixelRatio(orig_pixel_ratio)
        renderer.setSize(orig_size.width, orig_size.height, false)

        if (blob) {
          download(blob, filename, `image/png`)
        } else {
          if (typeof window !== `undefined`) {
            console.warn(`Failed to generate high-resolution PNG`)
          }
        }
      }, `image/png`)
    } catch (error) {
      console.error(`Error during high-res rendering:`, error)
      // Restore original settings
      renderer.setPixelRatio(orig_pixel_ratio)
      renderer.setSize(orig_size.width, orig_size.height, false)
      if (typeof window !== `undefined`) {
        console.warn(
          `Failed to render at high resolution: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  } catch (error) {
    console.error(`Error exporting PNG:`, error)
  }
}

// Helper to ensure font-family is set on SVG root
function set_svg_font_family(svg: SVGElement) {
  const style = svg.getAttribute(`style`) || ``
  if (!/font-family/.test(style)) {
    svg.setAttribute(`style`, `${style};font-family:sans-serif;`)
  }
  // Also set as attribute for extra robustness
  svg.setAttribute(`font-family`, `sans-serif`)
}

// Export SVG element as SVG file
export function export_svg_as_svg(
  svg_element: SVGElement | null,
  filename: string,
): void {
  try {
    if (!svg_element) {
      console.warn(`SVG element not found for export`)
      return
    }

    // Clone the SVG to avoid modifying the original
    const cloned_svg = svg_element.cloneNode(true) as SVGElement

    // Ensure the SVG has proper dimensions and viewBox
    const viewBox = svg_element.getAttribute(`viewBox`)
    if (viewBox) cloned_svg.setAttribute(`viewBox`, viewBox)

    // Ensure font-family is set
    set_svg_font_family(cloned_svg)
    // Ensure xmlns is set
    if (!cloned_svg.hasAttribute(`xmlns`)) {
      cloned_svg.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
    }

    // Convert SVG to string
    const svg_string = new XMLSerializer().serializeToString(cloned_svg)

    // Add XML declaration and DOCTYPE for proper SVG format
    const svg_content =
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg_string}`

    download(svg_content, filename, `image/svg+xml;charset=utf-8`)
  } catch (error) {
    console.error(`Error exporting SVG:`, error)
  }
}

// Export SVG element as PNG by converting to canvas
export function export_svg_as_png(
  svg_element: SVGElement | null,
  filename: string,
  png_dpi = 150,
): void {
  try {
    if (!svg_element) {
      console.warn(`SVG element not found for PNG export`)
      return
    }

    // Get SVG dimensions
    const viewBox = svg_element.getAttribute(`viewBox`)
    if (!viewBox) {
      console.warn(`SVG viewBox not found for PNG export`)
      return
    }

    const [, , width, height] = viewBox.split(` `).map(Number)
    if (!width || !height) {
      console.warn(`Invalid SVG dimensions for PNG export`)
      return
    }

    // Convert DPI to pixel dimensions
    const resolution_multiplier = Math.min(png_dpi / 72, 10)
    const pixel_width = Math.round(width * resolution_multiplier)
    const pixel_height = Math.round(height * resolution_multiplier)

    // Create a canvas for rendering
    const canvas = document.createElement(`canvas`)
    const ctx = canvas.getContext(`2d`)
    if (!ctx) {
      console.warn(`Canvas 2D context not available for PNG export`)
      return
    }

    // Set canvas dimensions
    canvas.width = pixel_width
    canvas.height = pixel_height

    // Clone and patch SVG for font-family
    const cloned_svg = svg_element.cloneNode(true) as SVGElement
    set_svg_font_family(cloned_svg)

    // Create an object URL from SVG Blob
    const svg_string = new XMLSerializer().serializeToString(cloned_svg)
    const svg_blob = new Blob([svg_string], { type: `image/svg+xml;charset=utf-8` })
    const svg_data_url = URL.createObjectURL(svg_blob)

    // Create an image element to load the SVG
    const img = new Image()
    img.onload = () => {
      try {
        ctx.clearRect(0, 0, pixel_width, pixel_height)
        ctx.drawImage(img, 0, 0, pixel_width, pixel_height)
        canvas.toBlob(
          (blob) => {
            if (blob) download(blob, filename, `image/png`)
            else console.warn(`Failed to generate PNG blob`)
          },
          `image/png`,
          1, // set max PNG quality
        )
      } catch (error) {
        console.error(`Error during PNG generation:`, error)
      } finally {
        URL.revokeObjectURL(svg_data_url)
      }
    }
    img.onerror = () => {
      console.error(`Failed to load SVG for PNG export`)
      URL.revokeObjectURL(svg_data_url)
    }
    img.src = svg_data_url
  } catch (error) {
    console.error(`Error exporting PNG:`, error)
  }
}

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
  ) throw new Error(`WebM video recording not supported in this browser`)

  const renderer = (canvas as { __renderer?: WebGLRenderer }).__renderer

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
  // VP9 typically needs 0.08-0.12 bits per pixel per frame for good quality
  // canvas dimensions include device pixel ratio and any resolution_multiplier
  const pixels_per_frame = canvas.width * canvas.height
  const bits_per_pixel_per_frame = 0.1 // Good quality for VP9
  // Clamp bitrate to reasonable bounds (1 Mbps min, 200 Mbps max)
  const calculated_bitrate = pixels_per_frame * fps * bits_per_pixel_per_frame
  const bitrate = Math.max(1_000_000, Math.min(calculated_bitrate, 200_000_000))

  const stream = canvas.captureStream(0)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: `video/webm;codecs=vp9`,
    videoBitsPerSecond: bitrate,
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

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
        requestAnimationFrame(() => requestAnimationFrame(resolve))
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

    recorder.onstop = () => {
      if (is_resolved) return
      is_resolved = true

      try {
        const blob = new Blob(chunks, { type: `video/webm` })
        const webm_filename = filename.replace(/\.(mp4|webm)$/i, `.webm`)
        download(blob, webm_filename, `video/webm`)
        on_progress?.(100)
        resolve()
      } catch (error) {
        reject(error)
      }
    }

    recorder.onerror = (event) => {
      if (is_resolved) return
      is_resolved = true
      // Extract error details from MediaRecorderErrorEvent or ErrorEvent
      reject(new Error(`MediaRecorder error: ${event.error}`))
    }

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
        reject(error)
      }
    }
  })
}
