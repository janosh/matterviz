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

// Helper to calculate distance between two points in reciprocal space
function calc_distance(q1: math.Vec3, q2: math.Vec3, lattice: math.Matrix3x3): number {
  const delta = q1.map((val, idx) => val - q2[idx]) as math.Vec3
  const cart = math.mat3x3_vec3_multiply(math.transpose_3x3_matrix(lattice), delta)
  return Math.hypot(...cart)
}

// Transform raw phonon band structure to expected format
function transform_band_structure(raw: RawPhononBandStructure): PhononBandStructure {
  const { lattice_rec: { matrix: lattice }, qpoints, bands, labels_dict } = raw
  const nb_qpoints = qpoints.length
  const nb_bands = bands.length

  // Calculate cumulative distances
  const distance: number[] = []
  qpoints.forEach((q, idx) => {
    distance[idx] = idx === 0
      ? 0
      : distance[idx - 1] + calc_distance(q, qpoints[idx - 1], lattice)
  })

  // Find labeled points by matching coordinates with labels_dict
  const labeled_indices = new Map(
    Object.entries(labels_dict).flatMap(([label, coords]) => {
      const idx = qpoints.findIndex((q) => math.euclidean_dist(q, coords) < 1e-5)
      return idx >= 0 ? [[idx, label]] : []
    }),
  )

  // Detect branches (segments between labeled points)
  const sorted_indices = [...labeled_indices.keys()].sort((a, b) => a - b)
  const branches: Branch[] = sorted_indices.length > 1
    ? sorted_indices.slice(0, -1).map((start_idx, idx) => ({
      start_index: start_idx,
      end_index: sorted_indices[idx + 1],
      name: `${labeled_indices.get(start_idx)}-${
        labeled_indices.get(sorted_indices[idx + 1])
      }`,
    }))
    : [{ start_index: 0, end_index: nb_qpoints - 1, name: `full` }]

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
    nb_bands,
    bands,
    has_nac: raw.has_nac,
    has_imaginary_modes: raw.has_imaginary_modes,
  }
}

type PhononData = {
  phonon_bandstructure?: RawPhononBandStructure
  phonon_dos?: PhononDos
}

// Import all phonon data files (excluding compressed .xz files)
const phonon_data = Object.fromEntries(
  Object.entries(
    import.meta.glob(`./*.json`, { eager: true, import: `default` }) as Record<
      string,
      PhononData
    >,
  ).map(([path, data]) => [path.split(`/`).pop()?.replace(`.json`, ``) ?? path, data]),
)

export const phonon_bands = Object.fromEntries(
  Object.entries(phonon_data).flatMap(([id, data]) =>
    data.phonon_bandstructure
      ? [[id, transform_band_structure(data.phonon_bandstructure)]]
      : []
  ),
)

export const phonon_dos = Object.fromEntries(
  Object.entries(phonon_data).flatMap(([id, data]) =>
    data.phonon_dos ? [[id, data.phonon_dos]] : []
  ),
)
