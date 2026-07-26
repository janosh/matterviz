// Readers for reaction-path input.
//
// The native format is `matterviz-reaction-path` JSON, documented below. Multi-frame
// extended XYZ (what `ase.io.write("neb.xyz", images)` produces) is also read, since a
// browser cannot read a directory from a plain drop and a VASP `00/`, `01/` … layout is
// therefore out of reach — dropping the files of one path together is the workable
// equivalent.
//
// ```jsonc
// {
//   "format": "matterviz-reaction-path",
//   "version": 1,
//   "energy_unit": "eV",              // optional, defaults to eV
//   "label": "Li vacancy hop",        // optional
//   "images": [                        // single path
//     {
//       "energy": -1234.5,
//       "label": "IS",                 // optional
//       "forces": [[0, 0, 0], ...],    // optional, one Vec3 per site, energy_unit / Å
//       "structure": { "lattice": { "matrix": [[...]] }, "sites": [...] }
//     }
//   ]
// }
// ```
// Several mechanisms are compared by replacing `images` with a keyed `paths` record:
// `{ "format": ..., "paths": { "vacancy": { "images": [...] }, "interstitial": [...] } }`.
// A `paths` entry is either a full path object or a bare image array.

import type { Vec3 } from '$lib/math'
import { is_finite_vec3_like } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { parse_any_structure } from '$lib/structure/parse'
import { count_xyz_frames, iter_xyz_frames } from '$lib/trajectory/helpers'
import { build_xyz_frame, parse_xyz_comment_metadata } from '$lib/trajectory/parse/xyz'
import type { NebImage, ReactionPath } from './index'
import { assert_path } from './reaction-path'

export const REACTION_PATH_FORMAT = `matterviz-reaction-path`

const is_record = (val: unknown): val is Record<string, unknown> =>
  typeof val === `object` && val !== null && !Array.isArray(val)

// A NaN energy silently poisons every derived barrier, so all three readers funnel their
// energy through here. `message` is a thunk so context is only built on the failing path.
function require_finite(val: unknown, message: () => string): number {
  if (typeof val !== `number` || !Number.isFinite(val)) throw new TypeError(message())
  return val
}

// Per-atom forces, kept only when every entry is 3 finite numbers.
function parse_forces(val: unknown, context: string): Vec3[] | undefined {
  if (val === undefined || val === null) return undefined
  if (!Array.isArray(val)) {
    throw new TypeError(`${context} forces must be an array of [x, y, z] vectors`)
  }
  return val.map((entry, atom_idx) => {
    if (!Array.isArray(entry) || !is_finite_vec3_like(entry)) {
      throw new Error(
        `${context} force ${atom_idx} must be 3 finite numbers, got ${JSON.stringify(entry)}`,
      )
    }
    return [entry[0], entry[1], entry[2]] as Vec3
  })
}

function parse_image(raw: unknown, context: string): NebImage {
  if (!is_record(raw)) {
    throw new Error(`${context} must be an object with "energy" and "structure"`)
  }
  if (!is_record(raw.structure)) {
    throw new Error(`${context} is missing a "structure" object`)
  }
  const structure = parse_any_structure(JSON.stringify(raw.structure), `${context}.json`)
  const forces = parse_forces(raw.forces, context)
  if (forces && forces.length !== structure.sites.length) {
    throw new Error(
      `${context} has ${forces.length} force vectors for ${structure.sites.length} sites`,
    )
  }
  return {
    structure,
    energy: require_finite(
      raw.energy,
      () => `${context} energy must be a finite number, got ${JSON.stringify(raw.energy)}`,
    ),
    ...(forces ? { forces } : {}),
    ...(typeof raw.label === `string` ? { label: raw.label } : {}),
  }
}

function parse_path_body(raw: unknown, context: string, energy_unit?: string): ReactionPath {
  const body = Array.isArray(raw) ? { images: raw } : raw
  if (!is_record(body) || !Array.isArray(body.images)) {
    throw new Error(`${context} must be an image array or an object with an "images" array`)
  }
  const path: ReactionPath = {
    images: body.images.map((image, image_idx) =>
      parse_image(image, `${context} image ${image_idx}`),
    ),
    ...(typeof body.label === `string` ? { label: body.label } : {}),
    energy_unit: typeof body.energy_unit === `string` ? body.energy_unit : energy_unit,
  }
  assert_path(path, context)
  return path
}

// Parse the native reaction-path JSON. Always returns a keyed record so single-path and
// multi-path files are consumed identically.
export function parse_reaction_path_json(
  content: string,
  filename = `reaction path`,
): Record<string, ReactionPath> {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (exc) {
    throw new Error(
      `${filename} is not valid JSON: ${exc instanceof Error ? exc.message : String(exc)}`,
      { cause: exc },
    )
  }
  if (!is_record(raw)) {
    throw new Error(`${filename} must contain a JSON object, got ${typeof raw}`)
  }
  if (typeof raw.format === `string` && raw.format !== REACTION_PATH_FORMAT) {
    throw new Error(
      `${filename} declares format "${raw.format}"; expected "${REACTION_PATH_FORMAT}"`,
    )
  }
  const energy_unit = typeof raw.energy_unit === `string` ? raw.energy_unit : undefined

  if (is_record(raw.paths)) {
    const entries = Object.entries(raw.paths)
    if (entries.length === 0) throw new Error(`${filename} has an empty "paths" record`)
    return Object.fromEntries(
      entries.map(([key, body]) => [
        key,
        parse_path_body(body, `${filename}:${key}`, energy_unit),
      ]),
    )
  }
  if (raw.images === undefined) {
    throw new Error(`${filename} has neither an "images" array nor a "paths" record`)
  }
  const path = parse_path_body(raw, filename, energy_unit)
  return { [path.label ?? filename]: path }
}

// Energy from an (ext)XYZ comment line. The trajectory parser's metadata reader also
// accepts `E=`, `etot=` and `total_energy=`, not just `energy=`.
const xyz_comment_energy = (comment: string, context: string): number =>
  require_finite(
    parse_xyz_comment_metadata(comment).properties.energy,
    () =>
      `${context} has no parsable energy in its comment line; expected e.g. \`energy=-1234.5\`, got "${comment.trim()}"`,
  )

// Read a multi-frame extended-XYZ file as one reaction path, one image per frame. Frame
// walking, `Properties=` column layout, lattice, pbc and comment metadata all come from
// the trajectory XYZ parser, which is the single source of truth for the format.
export function parse_xyz_reaction_path(content: string, filename = `path.xyz`): ReactionPath {
  const lines = content.trim().split(/\r?\n/)
  const images: NebImage[] = []
  for (const frame of iter_xyz_frames(lines)) {
    const image_idx = images.length
    const context = `${filename} frame ${image_idx}`
    const { structure, metadata } = build_xyz_frame(lines, frame, {
      frame_label: context,
      default_step: image_idx,
    })
    // Forces as read by the trajectory parser, kept only when every site got one
    const raw_forces = metadata?.forces
    const has_forces =
      Array.isArray(raw_forces) &&
      raw_forces.length === structure.sites.length &&
      raw_forces.every((vec) => is_finite_vec3_like(vec))
    images.push({
      structure,
      energy: xyz_comment_energy(frame.comment, context),
      ...(has_forces
        ? { forces: raw_forces.map((vec): Vec3 => [vec[0], vec[1], vec[2]]) }
        : {}),
      label: `image ${image_idx}`,
    })
  }
  if (images.length < 2) {
    throw new Error(
      `${filename} holds ${images.length} XYZ frame(s); a reaction path needs at least 2`,
    )
  }
  const path: ReactionPath = { images, label: filename }
  assert_path(path, filename)
  return path
}

export type DroppedFile = { content: string; filename: string }

const is_xyz = (filename: string) => /\.(?:xyz|extxyz)$/i.test(filename)

// A dropped .json file is either a whole reaction path or a single structure; only the
// content can tell them apart, since both use the same extension.
export function is_reaction_path_json(content: string): boolean {
  try {
    const raw: unknown = JSON.parse(content)
    if (!is_record(raw)) return false
    return (
      raw.format === REACTION_PATH_FORMAT || Array.isArray(raw.images) || is_record(raw.paths)
    )
  } catch {
    return false
  }
}

// Energy of a single dropped structure file, which must carry it in `properties.energy`
// (pymatgen JSON) — plain POSCAR/CIF files have nowhere to put one.
const structure_energy = (structure: AnyStructure, filename: string): number =>
  require_finite(
    structure.properties?.energy,
    () =>
      `${filename} carries no energy; give it a numeric "properties.energy", ` +
      `use an extended-XYZ \`energy=\` comment, or drop a ${REACTION_PATH_FORMAT} JSON file`,
  )

// Assemble whatever was dropped into named reaction paths. Reaction-path JSON and
// multi-frame XYZ each contribute their own path(s); loose structure files are collected
// into one path in drop order.
export function parse_dropped_paths(files: DroppedFile[]): Record<string, ReactionPath> {
  if (files.length === 0) throw new Error(`parse_dropped_paths got no files`)
  const paths: Record<string, ReactionPath> = {}
  const loose: NebImage[] = []

  for (const { content, filename } of files) {
    if (is_reaction_path_json(content)) {
      Object.assign(paths, parse_reaction_path_json(content, filename))
      continue
    }
    if (is_xyz(filename) && count_xyz_frames(content) > 1) {
      paths[filename] = parse_xyz_reaction_path(content, filename)
      continue
    }
    const structure = parse_any_structure(content, filename)
    loose.push({
      structure,
      energy: is_xyz(filename)
        ? xyz_comment_energy(content.split(/\r?\n/)[1] ?? ``, filename)
        : structure_energy(structure, filename),
      label: filename,
    })
  }

  if (loose.length > 0) {
    const path: ReactionPath = { images: loose, label: `dropped images` }
    assert_path(path, `dropped structure files`)
    paths[`dropped images`] = path
  }
  return paths
}
