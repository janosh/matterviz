// Serialize trajectory frames back to files. Frames are pulled one at a time through a
// resolver rather than read off `trajectory.frames`, because an indexed trajectory keeps only
// a handful of frames in memory and would otherwise export a truncated file.
import { strip_compression_extensions } from '$lib/io/decompress'
import { trajectory_property_config } from '$lib/labels'
import { structure_to_poscar_str, structure_to_xyz_str } from '$lib/structure/export'
import type { Site } from '$lib/structure'
import { rows_to_csv, to_error } from '$lib/utils'
import { zipSync } from 'fflate'
import { full_data_extractor } from './extract'
import type { TrajectoryFrame, TrajectoryMetadata } from './index'
import { extract_label_and_unit } from './plotting'
import type { TrajectoryRun } from './run'

// Resolve one frame by index; null when the index is out of range or the load failed.
export type TrajectoryFrameResolver = (
  frame_idx: number,
) => TrajectoryFrame | null | Promise<TrajectoryFrame | null>

// Strip compression and known trajectory suffixes so `run.extxyz.gz` exports as `run`, then
// keep only filename-safe characters. Leading and trailing separators go too, so `run (1).traj`
// exports as `run_1` rather than `run_1_`.
export function trajectory_export_basename(filename: string): string {
  // Case-preserving: this names a file the user sees. The hand-rolled list it replaced omitted
  // `.zip`, `.z` and `.deflate`.
  const base = strip_compression_extensions(filename.split(/[/\\]/).pop() ?? ``, {
    lowercase: false,
  })
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
// see them; this folds them back onto the sites it does read. Per-vector validation is left to
// site_force in structure/export.ts, which already drops the forces column for every atom
// unless all of them carry a finite 3-vector.
const frame_sites_with_forces = (frame: TrajectoryFrame): Site[] | null => {
  const forces = frame.metadata?.forces
  if (!Array.isArray(forces) || forces.length !== frame.structure.sites.length) return null
  return frame.structure.sites.map((site, idx) => ({
    ...site,
    properties: { ...site.properties, force: forces[idx] },
  }))
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

// Frame count of an inclusive range, throwing on anything a caller could mistake for a
// successful short export (reversed, fractional, negative, or NaN bounds).
function frame_range_length(start_frame: number, end_frame: number): number {
  if (
    !Number.isInteger(start_frame) ||
    !Number.isInteger(end_frame) ||
    start_frame < 0 ||
    end_frame < start_frame
  ) {
    throw new Error(`Invalid trajectory frame range ${start_frame}-${end_frame}`)
  }
  return end_frame - start_frame + 1
}

async function* iter_export_frames(
  start_frame: number,
  end_frame: number,
  resolve_frame: TrajectoryFrameResolver,
  on_progress?: (completed: number, total: number) => void,
): AsyncGenerator<[frame_idx: number, frame: TrajectoryFrame]> {
  const total = frame_range_length(start_frame, end_frame)
  for (let frame_idx = start_frame; frame_idx <= end_frame; frame_idx++) {
    // Same reason as serialize_frame below: a lazy resolver reading frame 3127 off disk fails
    // with an I/O or parse message that names no frame.
    let frame: TrajectoryFrame | null | undefined
    try {
      frame = await resolve_frame(frame_idx)
    } catch (error) {
      throw new Error(
        `Failed to load trajectory frame ${frame_idx}: ${to_error(error).message}`,
        { cause: error },
      )
    }
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

// === Per-frame property tables (CSV/JSON) ===

// One frame's numbers: the frame index and MD step that identify it, plus every numeric
// property the extractor (or the pre-extracted plot metadata) yielded for it.
export interface TrajectoryPropertyRow {
  frame: number
  step: number
  properties: Record<string, number>
}

export interface TrajectoryPropertyTable {
  start_frame: number
  end_frame: number
  // Where the numbers came from: whole frames pulled through the resolver, or the run's
  // property rows when they hold an entry for every frame in the range.
  source: `frames` | `properties`
  rows: TrajectoryPropertyRow[]
}

// `Step` duplicates the row's own step column. Non-finite values are dropped rather than
// written as `NaN`/`Infinity` text, leaving the cell empty - same rule the extXYZ comment
// writer applies.
const numeric_properties = (data: Record<string, unknown>): Record<string, number> => {
  const properties: Record<string, number> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === `Step`) continue
    if (typeof value === `number` && Number.isFinite(value)) properties[key] = value
  }
  return properties
}

// Rows straight off the run's property rows, or null when they miss even one frame of the
// range. Partial coverage must not silently export fewer rows than the range has frames.
function property_rows(
  metadata_rows: readonly TrajectoryMetadata[],
  start_frame: number,
  end_frame: number,
): TrajectoryPropertyRow[] | null {
  if (metadata_rows.length === 0) return null
  const by_frame = new Map(metadata_rows.map((meta) => [meta.frame_number, meta]))
  const rows: TrajectoryPropertyRow[] = []
  for (let frame_idx = start_frame; frame_idx <= end_frame; frame_idx++) {
    const meta = by_frame.get(frame_idx)
    if (!meta) return null
    rows.push({
      frame: frame_idx,
      step: meta.step,
      properties: numeric_properties(meta.properties),
    })
  }
  return rows
}

// Build a per-frame property table over an inclusive range. Prefers the run's already
// extracted property rows (no frame reads at all), else walks the range through the resolver
// so a sampled (HDF5) run exports every frame rather than its plot sample.
export async function collect_frame_property_rows(
  start_frame: number,
  end_frame: number,
  resolve_frame: TrajectoryFrameResolver,
  run: TrajectoryRun,
  on_progress?: (completed: number, total: number) => void,
): Promise<TrajectoryPropertyTable> {
  const total = frame_range_length(start_frame, end_frame)

  const ready_rows = property_rows(run.properties.rows, start_frame, end_frame)
  if (ready_rows) {
    on_progress?.(total, total)
    return { start_frame, end_frame, source: `properties`, rows: ready_rows }
  }

  const rows: TrajectoryPropertyRow[] = []
  for await (const [frame_idx, frame] of iter_export_frames(
    start_frame,
    end_frame,
    resolve_frame,
    on_progress,
  )) {
    rows.push({
      frame: frame_idx,
      step: frame.step,
      properties: numeric_properties(
        serialize_frame(frame_idx, () => full_data_extractor(frame)),
      ),
    })
  }
  return { start_frame, end_frame, source: `frames`, rows }
}

// Union of property keys in first-seen order. A frame that failed to yield e.g. density must
// not drop that column for every other frame (rows_to_csv only reads the first row's keys).
const property_key_order = (rows: TrajectoryPropertyRow[]): string[] => {
  const keys = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row.properties)) keys.add(key)
  return [...keys]
}

const property_unit = (key: string): string =>
  extract_label_and_unit(key, trajectory_property_config).unit

// One row per frame, `frame,step` first, then every property observed anywhere in the range.
// Each column is headed by the extractor key with its unit appended (`energy (eV)`), not by
// the plot label, which carries markup (`F<sub>max</sub>`) and shifts with display tweaks.
export function frame_rows_to_csv({ rows }: TrajectoryPropertyTable): string {
  const columns = property_key_order(rows)
    .filter((key) => key !== `frame` && key !== `step`)
    .map((key) => {
      const unit = property_unit(key)
      return { key, header: unit ? `${key} (${unit})` : key }
    })
  return rows_to_csv(
    rows.map(({ frame, step, properties }) => {
      const record: Record<string, number | string | null> = { frame, step }
      for (const { key, header } of columns) record[header] = properties[key] ?? null
      return record
    }),
  )
}

// Same numbers as the CSV, but keys stay bare and units move into their own map so a consumer
// can index `row.energy` without parsing a header.
export function frame_rows_to_json(table: TrajectoryPropertyTable): string {
  const { start_frame, end_frame, source, rows } = table
  const units: Record<string, string> = {}
  for (const key of property_key_order(rows)) {
    const unit = property_unit(key)
    if (unit) units[key] = unit
  }
  return `${JSON.stringify(
    {
      frame_range: [start_frame, end_frame],
      n_frames: rows.length,
      source,
      units,
      rows: rows.map(({ frame, step, properties }) => ({ ...properties, frame, step })),
    },
    null,
    2,
  )}\n`
}
