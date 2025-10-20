// Extract phonon band structures and DOS from full phonon objects

import type { Branch, PhononBandStructure, PhononDos, QPoint } from '$lib/bands'
import * as math from '$lib/math'

interface RawPhononBandStructure {
  lattice_rec: { matrix: math.Matrix3x3 }
  qpoints: math.Vec3[]
  bands: number[][]
  labels_dict: Record<string, math.Vec3>
  has_nac?: boolean
  has_imaginary_modes?: boolean
  [key: string]: unknown
}

// Calculate distance between two points in reciprocal space
function calc_recip_distance(q1: math.Vec3, q2: math.Vec3, lattice_T: math.Matrix3x3) {
  const delta = math.subtract(q1, q2)
  // lattice_T: pre-transposed lattice matrix to avoid repeated transposition in loops
  const cart = math.mat3x3_vec3_multiply(lattice_T, delta)
  return Math.hypot(...cart)
}

// Transform raw phonon band structure to expected format
function transform_band_structure(raw: RawPhononBandStructure): PhononBandStructure {
  // Guard against invalid/incomplete data
  if (
    !raw || !raw.lattice_rec?.matrix || !raw.qpoints || !raw.bands || !raw.labels_dict
  ) throw new Error(`Invalid or incomplete phonon band structure data`)

  const { lattice_rec: { matrix: lattice }, qpoints, bands, labels_dict } = raw
  const [n_qpoints, n_bands] = [qpoints.length, bands.length]

  // Guard against empty data
  if (n_qpoints === 0 || n_bands === 0) {
    throw new Error(
      `Empty phonon band structure data: n_qpoints=${n_qpoints}, n_bands=${n_bands}`,
    )
  }

  const band_lens = bands.map((band) => band.length)
  if (new Set(band_lens).size !== 1) {
    throw new Error(
      `all bands should each have length ${n_qpoints}, received lengths=${
        [...new Set(band_lens)].join(`, `)
      }`,
    )
  }

  // Calculate cumulative distances
  // Pre-transpose lattice once to avoid repeated transposition per q-point
  const lattice_T = math.transpose_3x3_matrix(lattice)
  const distance: number[] = []
  qpoints.forEach((q_pt, idx) => {
    distance[idx] = idx === 0
      ? 0
      : distance[idx - 1] + calc_recip_distance(q_pt, qpoints[idx - 1], lattice_T)
  })

  // Find labeled points by matching coordinates with labels_dict
  // Note: A label like GAMMA can appear multiple times in the path (e.g., Γ→X→Γ→L)
  const LABEL_MATCH_EPS = 1e-5
  const labeled_indices = new Map<number, string>()
  for (const [label, coords] of Object.entries(labels_dict)) {
    // Find ALL occurrences of this label, not just the first
    qpoints.forEach((q_pt, idx) => {
      if (math.euclidean_dist(q_pt, coords) < LABEL_MATCH_EPS) {
        // Only set if not labeled yet to keep first-seen label in tie-break case
        // (If two labels share identical coords, first in Object.entries order takes precedence.)
        if (!labeled_indices.has(idx)) labeled_indices.set(idx, label)
      }
    })
  }

  // Detect branches (segments between labeled points)
  // Include head/tail segments if path doesn't start/end on a labeled point
  // Branch endpoints are inclusive (start_index and end_index both included in segment)
  const sorted_indices = [...labeled_indices.keys()].sort((a, b) => a - b)
  const branches: Branch[] = []
  if (sorted_indices.length === 0) {
    branches.push({ start_index: 0, end_index: n_qpoints - 1, name: `full` })
  } else if (sorted_indices.length === 1) {
    const label_idx = sorted_indices[0]
    const label = label_idx !== undefined ? labeled_indices.get(label_idx) : undefined
    if (label_idx !== undefined && label) {
      if (label_idx > 0) {
        branches.push({ start_index: 0, end_index: label_idx, name: `0-${label}` })
      }
      if (label_idx < n_qpoints - 1) {
        branches.push({
          start_index: label_idx,
          end_index: n_qpoints - 1,
          name: `${label}-end`,
        })
      }
    }
  } else { // Optional head segment (if path doesn't start at a labeled point)
    if (sorted_indices[0] > 0) {
      const name = `0-${labeled_indices.get(sorted_indices[0])}`
      branches.push({ start_index: 0, end_index: sorted_indices[0], name })
    }
    // Labeled segments (between consecutive labeled points)
    for (let idx = 0; idx < sorted_indices.length - 1; idx++) {
      const start_idx = sorted_indices[idx]
      const end_idx = sorted_indices[idx + 1]
      const name = `${labeled_indices.get(start_idx)}-${labeled_indices.get(end_idx)}`
      branches.push({ start_index: start_idx, end_index: end_idx, name })
    }
    // Optional tail segment (if path doesn't end at a labeled point)
    const last_idx = sorted_indices.at(-1)
    if (last_idx !== undefined && last_idx < n_qpoints - 1) {
      const name = `${labeled_indices.get(last_idx)}-end`
      branches.push({ start_index: last_idx, end_index: n_qpoints - 1, name })
    }
  }

  // Transform qpoints to QPoint objects
  const q_points: QPoint[] = qpoints.map((coords, idx) => ({
    label: labeled_indices.get(idx) ?? null,
    frac_coords: coords,
    distance: distance[idx],
  }))

  return {
    lattice_rec: raw.lattice_rec,
    qpoints: q_points,
    branches,
    labels_dict,
    distance,
    nb_bands: n_bands,
    bands,
    has_nac: raw.has_nac,
    has_imaginary_modes: raw.has_imaginary_modes,
  }
}

type PhononData = {
  phonon_bandstructure?: RawPhononBandStructure
  phonon_dos?: PhononDos
  primitive?: unknown
  [key: string]: unknown
}

// Import all phonon data files (uncompressed for dev, gzipped in git)
const raw_imports = import.meta.glob([`./*.json`, `./*.json.gz`], {
  eager: true,
  import: `default`,
}) as Record<string, PhononData>

// Extract filename without extension as the key
export const phonon_data: Record<string, PhononData> = {}
export const phonon_bands: Record<string, PhononBandStructure> = {}
export const phonon_dos: Record<string, PhononDos> = {}

for (const [path, data] of Object.entries(raw_imports)) {
  const id = path.match(/\/([^/]+)\.json(?:\.gz)?$/)?.[1] ?? path
  phonon_data[id] = data
  if (data?.phonon_bandstructure) {
    phonon_bands[id] = transform_band_structure(data.phonon_bandstructure)
  }
  if (data?.phonon_dos) {
    phonon_dos[id] = data.phonon_dos
  }
}
