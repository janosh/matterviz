import type { Vec3 } from '$lib/math'
import {
  validate_camera_flight,
  type CameraFlight,
  type CameraPose,
} from '$lib/scene/camera-flight'
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import type { MaterialSource } from '$lib/file-viewer/open'
import type { TrajectoryController } from './index'
import type { VideoFormat } from '$lib/io/export'

export type MovieRenderOptions = {
  signal?: AbortSignal
  on_progress?: (progress: number) => void
}

export interface TrajectoryViewerController extends TrajectoryController {
  load: (
    source: MaterialSource,
    options?: { hdf5_group_path?: string; signal?: AbortSignal },
  ) => Promise<void>
  prepare_frame: (idx: number, signal?: AbortSignal) => Promise<void>
  inspect: () => Promise<{
    frame_count: number
    atom_count: number
    filename?: string
    camera: CameraPose
    viewport_height: number
    bounds: { min: Vec3; max: Vec3 }
    warnings: readonly string[]
  }>
  plan_movie: (request: MovieRequest) => Promise<MoviePlan>
  // The same canvas is reused; finish consuming each frame before resolving the callback.
  render_movie: (
    plan: MoviePlan,
    on_frame: (canvas: HTMLCanvasElement, idx: number, signal: AbortSignal) => Promise<void>,
    options?: MovieRenderOptions,
  ) => Promise<void>
  export_movie: (
    plan: MoviePlan,
    options?: MovieRenderOptions & {
      format?: VideoFormat
      on_save?: (blob: Blob) => void | Promise<void>
    },
  ) => Promise<void>
  cancel_movie: () => void
}

export type MovieRequest = {
  // Preserve a saved plan's orthographic framing when editing its FPS or duration.
  camera_viewport_height?: number
  // Zero-based source frames, start inclusive and end exclusive. Repeated video frames
  // hold a source frame; atomic coordinates are never interpolated.
  frames?: { start: number; end: number }
  camera?:
    | CameraFlight
    | {
        preset: 'orbit'
        turns?: number
        elevation_deg?: number
        azimuth_deg?: number
        distance_scale?: number
        up?: Vec3
      }
  video: {
    width: number
    height: number
    fps: number
    duration_s: number
    background?: string
    bitrate?: number
  }
}

export type MoviePlan = {
  frames: { start: number; end: number }
  camera: CameraFlight
  // Orthographic poses store zoom in CSS pixels. Retain their reference frustum height
  // so reopening this plan in a different-sized viewer preserves world-space framing.
  camera_viewport_height: number
  video: MovieRequest['video'] & { frame_count: number }
}

// Resolve presets once, so the preview, final render and saved plan share exact poses.
export function plan_movie(
  request: MovieRequest,
  total_frames: number,
  pose: CameraPose,
): MoviePlan {
  const { video, camera } = request
  const camera_viewport_height = request.camera_viewport_height ?? video.height
  if (!Number.isFinite(camera_viewport_height) || camera_viewport_height <= 0)
    throw new RangeError(`Invalid camera viewport height: ${camera_viewport_height}`)
  const frames = request.frames ?? { start: 0, end: total_frames }
  if (
    !Number.isSafeInteger(total_frames) ||
    total_frames < 1 ||
    !Number.isInteger(frames.start) ||
    !Number.isInteger(frames.end) ||
    frames.start < 0 ||
    frames.end <= frames.start ||
    frames.end > total_frames
  )
    throw new RangeError(
      `Invalid movie frame range ${frames.start}..${frames.end} for ${total_frames} frames`,
    )
  for (const [name, value] of Object.entries({ width: video.width, height: video.height })) {
    if (!Number.isInteger(value) || value < 2 || value % 2 !== 0)
      throw new RangeError(`Movie ${name} must be a positive even integer, got ${value}`)
  }
  if (!Number.isFinite(video.fps) || video.fps <= 0 || video.fps > 240)
    throw new RangeError(`Movie fps must be in (0, 240], got ${video.fps}`)
  const frame_count = Math.round(video.duration_s * video.fps)
  if (
    !Number.isFinite(video.duration_s) ||
    video.duration_s <= 0 ||
    !Number.isSafeInteger(frame_count) ||
    frame_count < 1
  )
    throw new RangeError(`Invalid movie duration ${video.duration_s} at ${video.fps} fps`)
  if (video.bitrate !== undefined && (!Number.isFinite(video.bitrate) || video.bitrate <= 0))
    throw new RangeError(`Movie bitrate must be positive, got ${video.bitrate}`)
  // Quantize duration to whole video frames and report the actual encoded duration.
  const duration_s = frame_count / video.fps
  let flight: CameraFlight
  if (camera && `keyframes` in camera) {
    validate_camera_flight(camera)
    const duration = camera.keyframes[camera.keyframes.length - 1].time
    flight = {
      ...camera,
      keyframes: camera.keyframes.map((frame) => ({
        ...structuredClone(frame),
        time: frame.time === duration ? duration_s : frame.time * (duration_s / duration),
      })),
    }
  } else if (camera) {
    if (camera.preset !== `orbit`) throw new Error(`Unknown camera preset: ${camera.preset}`)
    const {
      turns = 1,
      distance_scale = 1,
      elevation_deg = 25,
      azimuth_deg = 35,
      up = [0, 1, 0],
    } = camera
    if (
      ![turns, distance_scale, elevation_deg, azimuth_deg, ...up].every(Number.isFinite) ||
      distance_scale <= 0 ||
      Math.abs(turns) > 20 ||
      Math.abs(elevation_deg) >= 89 ||
      Math.hypot(...up) === 0
    )
      throw new RangeError(`Invalid orbit settings: ${JSON.stringify(camera)}`)
    const target = new Vector3(...pose.target)
    const distance = new Vector3(...pose.position).distanceTo(target) * distance_scale
    if (!distance) throw new Error(`Camera position coincides with orbit target`)
    const axis = new Vector3(...up).normalize()
    const basis = new Vector3(1, 0, 0)
    if (Math.abs(basis.dot(axis)) > 0.9) basis.set(0, 0, 1)
    basis.addScaledVector(axis, -basis.dot(axis)).normalize()
    const elevation = (elevation_deg * Math.PI) / 180
    const count = Math.max(8, Math.ceil(Math.abs(turns) * 16))
    flight = {
      interpolation: `smooth`,
      keyframes: Array.from({ length: count + 1 }, (_unused, idx) => {
        const angle = ((azimuth_deg + (360 * turns * idx) / count) * Math.PI) / 180
        const position = basis
          .clone()
          .applyAxisAngle(axis, angle)
          .multiplyScalar(distance * Math.cos(elevation))
          .addScaledVector(axis, distance * Math.sin(elevation))
          .add(target)
        return {
          ...structuredClone(pose),
          time: (duration_s * idx) / count,
          position: position.toArray(),
          zoom: pose.projection === `orthographic` ? pose.zoom / distance_scale : pose.zoom,
          quaternion: new Quaternion()
            .setFromRotationMatrix(new Matrix4().lookAt(position, target, axis))
            .toArray(),
        }
      }),
    }
  } else
    flight = {
      interpolation: `linear`,
      keyframes: [
        { ...structuredClone(pose), time: 0 },
        { ...structuredClone(pose), time: duration_s },
      ],
    }
  validate_camera_flight(flight)
  return {
    frames: { ...frames },
    camera: flight,
    camera_viewport_height,
    video: { ...video, duration_s, frame_count },
  }
}

// Include both endpoints in the picture sequence; timestamps remain idx / fps. This also
// makes a one-frame source useful for a full camera flight without synthesizing atom motion.
export const movie_frame = (plan: MoviePlan, idx: number) => {
  if (!Number.isInteger(idx) || idx < 0 || idx >= plan.video.frame_count)
    throw new RangeError(`Movie frame ${idx} is outside 0..${plan.video.frame_count - 1}`)
  const progress = plan.video.frame_count === 1 ? 0 : idx / (plan.video.frame_count - 1)
  return {
    source_frame: Math.round(
      plan.frames.start + progress * (plan.frames.end - plan.frames.start - 1),
    ),
    camera_time: progress * plan.video.duration_s,
    timestamp_us: Math.round((idx * 1e6) / plan.video.fps),
  }
}
