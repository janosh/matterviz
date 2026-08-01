// Serialize trajectory frames back to files. Frames are pulled one at a time through a
// resolver rather than read off `trajectory.frames`, because an indexed trajectory keeps only
// a handful of frames in memory and would otherwise export a truncated file.
import { structure_to_poscar_str, structure_to_xyz_str } from '$lib/structure/export'
import type { Site } from '$lib/structure'
import { to_error } from '$lib/utils'
import { zipSync } from 'fflate'
import type { TrajectoryFrame } from './index'

// Resolve one frame by index; null when the index is out of range or the load failed.
export type TrajectoryFrameResolver = (
  frame_idx: number,
) => TrajectoryFrame | null | Promise<TrajectoryFrame | null>

// Strip compression and known trajectory suffixes so `run.extxyz.gz` exports as `run`, then
// keep only filename-safe characters. Leading and trailing separators go too, so `run (1).traj`
// exports as `run_1` rather than `run_1_`.
export function trajectory_export_basename(filename: string): string {
  const base = (filename.split(/[/\\]/).pop() ?? ``)
    .replace(/(?:\.(?:gz|gzip|bz2|xz|zst))+$/i, ``)
    .replace(/\.(?:extxyz|xyz|traj|h5|hdf5|lammpstrj|dump|xml|json)$/i, ``)
    .replaceAll(/[^A-Za-z0-9._-]+/g, `_`)
    .replaceAll(/^[._-]+|[._-]+$/g, ``)
  return base || `trajectory`
}

// Zero-padded so a directory listing or `cat *.vasp` sorts in trajectory order
export function poscar_frame_filename(
  filename: string,
  frame_idx: number,
  total_frames: number,
): string {
  const width = Math.max(4, String(Math.max(0, total_frames - 1)).length)
  const padded_idx = String(frame_idx).padStart(width, `0`)
  return `${trajectory_export_basename(filename)}_frame_${padded_idx}.vasp`
}

// Per-atom forces recorded on the frame rather than its structure. XYZ/extXYZ parsing puts
// them in `frame.metadata.forces` (see build_xyz_frame), where the structure exporter cannot
// see them; this folds them back onto the sites it does read. All-or-nothing: one unusable
// entry returns null, because a partial list would make the exporter drop the forces column
// for every atom and look like a successful export that simply had no force data.
const frame_sites_with_forces = (frame: TrajectoryFrame): Site[] | null => {
  const forces = frame.metadata?.forces
  if (!Array.isArray(forces) || forces.length !== frame.structure.sites.length) return null
  const sites: Site[] = []
  for (const [idx, site] of frame.structure.sites.entries()) {
    const force = forces[idx]
    if (!Array.isArray(force) || force.length < 3) return null
    const vec = force.slice(0, 3).map(Number)
    if (!vec.every(Number.isFinite)) return null
    sites.push({ ...site, properties: { ...site.properties, force: vec } })
  }
  return sites
}

// Already carried by the forces columns, recomputed from the cell on read, or written
// explicitly below, so re-emitting them in the comment would duplicate or contradict the file.
const SKIP_METADATA_KEYS = new Set([`forces`, `step`, `volume`])

// Serialize one frame as an extXYZ block, preserving the metadata that lives on the frame
// rather than its structure. Single-structure export reads forces off site properties and
// knows nothing about energy or step, so both are merged in here.
export function trajectory_frame_to_extxyz_str(frame: TrajectoryFrame): string {
  const sites = frame_sites_with_forces(frame)
  const lines = structure_to_xyz_str({ ...frame.structure, ...(sites && { sites }) }).split(
    `\n`,
  )
  const extra = [`step=${frame.step}`]
  for (const [key, value] of Object.entries(frame.metadata ?? {})) {
    if (SKIP_METADATA_KEYS.has(key)) continue
    // Number.isFinite, not typeof: a NaN or Infinity would emit `energy=NaN` into the comment,
    // which every downstream extXYZ reader parses back as a number that isn't one.
    if (typeof value === `boolean` || Number.isFinite(value)) {
      extra.push(`${key.replaceAll(/[^A-Za-z0-9_]/g, `_`)}=${value}`)
    }
  }
  lines[1] = `${lines[1]} ${extra.join(` `)}`
  return lines.join(`\n`)
}

// Walk an inclusive frame range, resolving one frame at a time. The event loop gets a turn
// every YIELD_EVERY_FRAMES so a long export doesn't freeze the tab; awaiting a macrotask per
// frame would instead dominate the serialization itself.
const YIELD_EVERY_FRAMES = 16
async function* iter_export_frames(
  start_frame: number,
  end_frame: number,
  resolve_frame: TrajectoryFrameResolver,
  on_progress?: (completed: number, total: number) => void,
): AsyncGenerator<[frame_idx: number, frame: TrajectoryFrame]> {
  if (
    !Number.isInteger(start_frame) ||
    !Number.isInteger(end_frame) ||
    start_frame < 0 ||
    end_frame < start_frame
  ) {
    throw new Error(`Invalid trajectory frame range ${start_frame}-${end_frame}`)
  }
  const total = end_frame - start_frame + 1
  for (let frame_idx = start_frame; frame_idx <= end_frame; frame_idx++) {
    const frame = await resolve_frame(frame_idx)
    // Emitting a short file would look like a successful export of a shorter run
    if (!frame?.structure?.sites) {
      throw new Error(`Trajectory frame ${frame_idx} is not available for export`)
    }
    yield [frame_idx, frame]
    const completed = frame_idx - start_frame + 1
    on_progress?.(completed, total)
    if (completed < total && completed % YIELD_EVERY_FRAMES === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}

// Name the frame a serializer choked on. Its own errors ("No lattice information for POSCAR
// export") say nothing about where in a 5000-frame range the bad frame is.
const serialize_frame = <T>(frame_idx: number, serialize: () => T): T => {
  try {
    return serialize()
  } catch (error) {
    throw new Error(
      `Failed to serialize trajectory frame ${frame_idx}: ${to_error(error).message}`,
      { cause: error },
    )
  }
}

// Serialize an inclusive frame range as multi-frame extXYZ. Only the emitted text is retained,
// so a lazily-loaded trajectory can be exported without holding every decoded frame at once.
export async function serialize_extxyz_frame_range(
  start_frame: number,
  end_frame: number,
  resolve_frame: TrajectoryFrameResolver,
  on_progress?: (completed: number, total: number) => void,
): Promise<string> {
  const chunks: string[] = []
  for await (const [frame_idx, frame] of iter_export_frames(
    start_frame,
    end_frame,
    resolve_frame,
    on_progress,
  ))
    chunks.push(serialize_frame(frame_idx, () => trajectory_frame_to_extxyz_str(frame)))
  return `${chunks.join(`\n`)}\n`
}

// Build a ZIP of one numbered POSCAR per frame over the inclusive range.
export async function create_poscar_frame_range_zip(
  start_frame: number,
  end_frame: number,
  resolve_frame: TrajectoryFrameResolver,
  filename: string,
  total_frames: number,
  on_progress?: (completed: number, total: number) => void,
): Promise<Blob> {
  const encoder = new TextEncoder()
  const files: Record<string, Uint8Array> = {}
  for await (const [frame_idx, frame] of iter_export_frames(
    start_frame,
    end_frame,
    resolve_frame,
    on_progress,
  )) {
    files[poscar_frame_filename(filename, frame_idx, total_frames)] = encoder.encode(
      serialize_frame(frame_idx, () => `${structure_to_poscar_str(frame.structure)}\n`),
    )
  }
  return new Blob([zipSync(files)], { type: `application/zip` })
}
