// Electronic-structure results (DOS + band eigenvalues) from VASP 6.x vaspout.h5.
//
// Reads results/electron_dos* into the ElectronicDos shape and
// results/electron_eigenvalues* (incl. the _kpoints_opt variants written for
// band paths from KPOINTS_OPT, e.g. by phelel) into the matterviz
// ElectronicBandStructure shape consumed by the spectral components.
//
// Schema reference: ferrox src/io/vasp/hdf5/mod.rs path constants (which follow
// py4vasp's VASP 6.x schema definitions).
import {
  create_frac_to_cart,
  euclidean_dist,
  matrix_inverse_3x3,
  type Matrix3x3,
  transpose_3x3_matrix,
  type Vec3,
} from '$lib/math'
import { pretty_sym_point } from '$lib/spectral/helpers'
import type { Branch, ElectronicBandStructure, ElectronicDos, QPoint } from '$lib/spectral'
import type * as h5wasm from 'h5wasm'
import { validate_3x3_matrix } from '$lib/trajectory/helpers'
import { read_dataset, scale_matrix, to_scalar_number, to_string_array } from './h5-utils'

const DOS_GROUPS = [`results/electron_dos`, `results/electron_dos_kpoints_opt`]
const DOS_ENERGY_NAMES = [`energies`, `energy`]
const DOS_TOTAL_NAMES = [`dos`, `total`]
const BANDS_GROUPS = [
  `results/electron_eigenvalues`,
  `results/electron_eigenvalues_kpoints_opt`,
]
const EIGENVALUE_NAMES = [`eigenvalues`, `eigenvalue`]
const KPOINT_COORD_NAMES = [`kpoints`, `kpoint_coords`]
const KPOINT_COORD_FALLBACKS = [`results/kpoints/coordinates`]
const KPOINT_LABEL_PATHS = [
  `results/kpoints/labels`,
  `input/kpoints_opt/labels_kpoints`,
  `input/kpoints/labels_kpoints`,
]
const KPOINTS_PER_SEGMENT_PATHS = [
  `input/kpoints_opt/number_kpoints`,
  `input/kpoints/number_kpoints`,
]

export interface VaspoutElectronicData {
  dos: ElectronicDos | null
  bands: ElectronicBandStructure | null
}

const read_first_dataset = (h5_file: h5wasm.File, paths: string[]): unknown => {
  for (const path of paths) {
    const data = read_dataset(h5_file, path)
    if (data !== null) return data
  }
  return null
}

const is_number_array = (data: unknown): data is number[] =>
  Array.isArray(data) && data.every((val) => typeof val === `number`)

export const read_vaspout_dos = (h5_file: h5wasm.File): ElectronicDos | null => {
  for (const group of DOS_GROUPS) {
    const energies = read_first_dataset(
      h5_file,
      DOS_ENERGY_NAMES.map((name) => `${group}/${name}`),
    )
    const total = read_first_dataset(
      h5_file,
      DOS_TOTAL_NAMES.map((name) => `${group}/${name}`),
    )
    if (!is_number_array(energies) || !Array.isArray(total)) continue

    // Total DOS is (n_spin, n_energies) in real files but tolerate a flat array
    const spin_channels = is_number_array(total) ? [total] : (total as number[][])
    const densities = spin_channels[0]
    if (!is_number_array(densities) || densities.length !== energies.length) continue
    const spin_down = spin_channels[1]
    const spin_polarized = is_number_array(spin_down) && spin_down.length === energies.length

    const efermi = to_scalar_number(read_dataset(h5_file, `${group}/efermi`))
    return {
      type: `electronic`,
      energies,
      densities,
      ...(spin_polarized ? { spin_down_densities: spin_down, spin_polarized } : {}),
      ...(efermi !== null ? { efermi } : {}),
    }
  }
  return null
}

// Real (row-vector) lattice for k-path distances: prefer the relaxed structure's
// lattice, fall back to the POSCAR input one (bands-only files keep only the latter)
const read_lattice = (h5_file: h5wasm.File): Matrix3x3 | null => {
  for (const [lattice_path, scale_path] of [
    [`results/positions/lattice_vectors`, `results/positions/scale`],
    [`input/poscar/lattice_vectors`, `input/poscar/scale`],
  ]) {
    const lattice_data = read_dataset(h5_file, lattice_path)
    if (!lattice_data) continue
    try {
      const scale = to_scalar_number(read_dataset(h5_file, scale_path)) ?? 1
      return scale_matrix(validate_3x3_matrix(lattice_data), scale)
    } catch {
      continue
    }
  }
  return null
}

// B = 2π (A⁻¹)ᵀ for row-vector real lattice A; falls back to 2π·identity so
// bands-only files without any (invertible) lattice still get monotonic path
// distances.
const reciprocal_lattice = (lattice: Matrix3x3 | null): Matrix3x3 => {
  let recip: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  try {
    if (lattice) recip = transpose_3x3_matrix(matrix_inverse_3x3(lattice))
  } catch {
    /* singular lattice: keep identity */
  }
  return recip.map((row) => row.map((val) => val * 2 * Math.PI)) as Matrix3x3
}

// VASP line-mode label layout: 2 labels per path segment of `per_segment` points
// (e.g. 12 labels + 51 points/segment = 306 k-points). Returns per-kpoint labels
// (null between endpoints) or null when the layout doesn't match. When the
// input/kpoints*/number_kpoints dataset is absent (not all writers emit it),
// the segment length is inferred from the label/k-point counts instead.
// Exported for unit tests only.
export const line_mode_labels = (
  labels: string[] | null,
  per_segment_dataset: number | null,
  n_kpoints: number,
): (string | null)[] | null => {
  if (!labels || labels.length < 2 || labels.length % 2 !== 0) return null
  const n_segments = labels.length / 2
  const per_segment = per_segment_dataset ?? n_kpoints / n_segments
  if (!Number.isInteger(per_segment) || per_segment < 2) return null
  if (n_segments * per_segment !== n_kpoints) return null

  const per_kpoint: (string | null)[] = Array.from({ length: n_kpoints }, () => null)
  for (let seg = 0; seg < n_segments; seg++) {
    per_kpoint[seg * per_segment] = pretty_sym_point(labels[2 * seg])
    per_kpoint[seg * per_segment + per_segment - 1] = pretty_sym_point(labels[2 * seg + 1])
  }
  return per_kpoint
}

export const read_vaspout_bands = (
  h5_file: h5wasm.File,
  dos: ElectronicDos | null = read_vaspout_dos(h5_file),
): ElectronicBandStructure | null => {
  for (const group of BANDS_GROUPS) {
    const eigenvalues = read_first_dataset(
      h5_file,
      EIGENVALUE_NAMES.map((name) => `${group}/${name}`),
    ) as number[][][] | null
    const kpoint_data = read_first_dataset(h5_file, [
      ...KPOINT_COORD_NAMES.map((name) => `${group}/${name}`),
      ...KPOINT_COORD_FALLBACKS,
    ]) as number[][] | null
    if (!Array.isArray(eigenvalues) || !Array.isArray(kpoint_data)) continue

    // eigenvalues shape: (n_spin, n_kpoints, n_bands)
    const n_kpoints = kpoint_data.length
    const spin_up = eigenvalues[0]
    if (!Array.isArray(spin_up) || spin_up.length !== n_kpoints || n_kpoints === 0) continue
    const n_bands = spin_up[0]?.length ?? 0
    if (n_bands === 0) continue

    // [n_kpoints][n_bands] -> [n_bands][n_kpoints] as the spectral components expect
    const transpose = (spin_eigs: number[][]): number[][] =>
      Array.from({ length: n_bands }, (_, band_idx) =>
        spin_eigs.map((kpt_eigs) => kpt_eigs[band_idx]),
      )
    const bands = transpose(spin_up)
    const spin_down = eigenvalues[1]
    const spin_down_bands =
      Array.isArray(spin_down) && spin_down.length === n_kpoints
        ? transpose(spin_down)
        : undefined

    const recip = reciprocal_lattice(read_lattice(h5_file))
    const labels = line_mode_labels(
      to_string_array(
        read_first_dataset(h5_file, [`${group}/kpoints_labels`, ...KPOINT_LABEL_PATHS]),
      ),
      to_scalar_number(read_first_dataset(h5_file, KPOINTS_PER_SEGMENT_PATHS)),
      n_kpoints,
    )

    const distance: number[] = []
    const qpoints: QPoint[] = []
    let path_length = 0
    let prev_cart: Vec3 | null = null
    const labels_dict: Record<string, Vec3> = {}
    const frac_to_cart = create_frac_to_cart(recip)
    for (const [kpt_idx, kpt] of kpoint_data.entries()) {
      const frac = [kpt[0] ?? 0, kpt[1] ?? 0, kpt[2] ?? 0] as Vec3
      const cart = frac_to_cart(frac)
      if (prev_cart) path_length += euclidean_dist(cart, prev_cart)
      prev_cart = cart
      distance.push(path_length)
      const label = labels?.[kpt_idx] ?? null
      qpoints.push({ label, frac_coords: frac })
      if (label) labels_dict[label] = frac
    }

    // One branch per labeled line-mode segment, else a single whole-path branch
    const per_segment = labels ? n_kpoints / (labels.filter(Boolean).length / 2) : 0
    const branches: Branch[] = []
    if (labels && Number.isInteger(per_segment) && per_segment >= 2) {
      for (let start = 0; start < n_kpoints; start += per_segment) {
        const end = start + per_segment - 1
        branches.push({
          start_index: start,
          end_index: end,
          name: `${qpoints[start]?.label ?? `?`}-${qpoints[end]?.label ?? `?`}`,
        })
      }
    } else branches.push({ start_index: 0, end_index: n_kpoints - 1, name: `path` })

    const efermi = dos?.efermi
    return {
      qpoints,
      branches,
      distance,
      bands,
      ...(spin_down_bands ? { spin_down_bands } : {}),
      nb_bands: n_bands,
      labels_dict,
      recip_lattice: { matrix: recip },
      is_spin_polarized: spin_down_bands !== undefined,
      ...(efermi !== undefined ? { efermi } : {}),
    }
  }
  return null
}

// Bundle DOS + bands; null when the file carries neither (so callers can keep
// their "no structure data" error for files with nothing to show).
export const read_vaspout_electronic = (
  h5_file: h5wasm.File,
): VaspoutElectronicData | null => {
  const dos = read_vaspout_dos(h5_file)
  const bands = read_vaspout_bands(h5_file, dos)
  return dos || bands ? { dos, bands } : null
}
