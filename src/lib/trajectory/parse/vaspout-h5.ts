// Parser for VASP 6.x HDF5 output (vaspout.h5, written with LH5=.TRUE.).
// Reads the ionic-relaxation trajectory from intermediate/ion_dynamics (with
// per-frame energy/forces so convergence plots come for free) and falls back
// to the final structure in results/positions for static (NSW=0) runs, which
// render as single-frame trajectories (structure only, plots hidden).
//
// Tolerates files from incomplete/running calculations: datasets flushed
// mid-write may disagree on step counts (e.g. 5 energies but 4 position
// frames), so frame count is the minimum over required datasets and per-step
// reads never index past any dataset's end.
//
// Electronic results (results/electron_dos, results/electron_eigenvalues*)
// are read by ./vaspout-electronic.ts and attached as metadata.electronic;
// vaspwave.h5 charge density is handled by isosurface/parse-vaspwave.ts.
//
// Schema reference: ferrox src/io/vasp/hdf5/mod.rs (which follows py4vasp's
// VASP 6.x schema definitions).
import { calc_lattice_params, create_frac_to_cart, type Vec3 } from '$lib/math'
import type * as h5wasm from 'h5wasm'
import {
  count_elements,
  create_trajectory_frame,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type { TrajectoryType } from '$lib/trajectory/index'
import {
  expand_ion_types,
  is_hdf5_group,
  read_dataset,
  scale_matrix,
  to_number_array,
  to_scalar_number,
  to_string_array,
  with_h5_file,
} from './h5-utils'
import { read_vaspout_dos, read_vaspout_electronic } from './vaspout-electronic'

const FINAL_ION_TYPES = `results/positions/ion_types`
const FINAL_ION_COUNTS = `results/positions/number_ion_types`
const FINAL_LATTICE = `results/positions/lattice_vectors`
const FINAL_POSITIONS = `results/positions/position_ions`
const FINAL_SCALE = `results/positions/scale`
const TRAJ_LATTICE = `intermediate/ion_dynamics/lattice_vectors`
const TRAJ_POSITIONS = `intermediate/ion_dynamics/position_ions`
const TRAJ_FORCES = `intermediate/ion_dynamics/forces`
const ENERGY_VALUES = `intermediate/ion_dynamics/energies`
const ENERGY_LABELS = `intermediate/ion_dynamics/energies_tags`
const OSZICAR_ROWS = `intermediate/ion_dynamics/oszicar`
const OSZICAR_LABELS = `intermediate/ion_dynamics/oszicar_label`
const ELECTRONIC_STEP_ENERGIES = `intermediate/electronic_steps/energies`

// vaspout.h5 root groups per the VASP 6.x schema. torch-sim files use flat
// dataset names (positions/atomic_numbers/...) and never these groups.
export const is_vaspout_h5_file = (h5_file: h5wasm.File): boolean =>
  [`results`, `intermediate`].some((name) => is_hdf5_group(h5_file.get(name))) &&
  [`input`, `version`, `results`, `intermediate`].filter((name) =>
    is_hdf5_group(h5_file.get(name)),
  ).length >= 2

// Final-structure datasets may carry a leading singleton step axis
// ([1, 3, 3] lattices, [1, n_atoms, 3] positions) depending on VASP version.
const squeeze_leading_axis = (data: unknown): unknown =>
  Array.isArray(data) &&
  data.length === 1 &&
  Array.isArray(data[0]) &&
  Array.isArray((data[0] as unknown[])[0])
    ? data[0]
    : data

// VASP writes several energy kinds per step; energies_tags names the columns.
// Prefer the free energy (TOTEN), then energy(sigma->0), then column 0.
const pick_energy_column = (tags: string[] | null): { idx: number; tag: string | null } => {
  if (!tags) return { idx: 0, tag: null }
  for (const needle of [`TOTEN`, `sigma->0`]) {
    const idx = tags.findIndex((tag) => tag.includes(needle))
    if (idx !== -1) return { idx, tag: tags[idx] }
  }
  return { idx: 0, tag: tags[0] ?? null }
}

// Per-SCF-step convergence data for one ionic step, from VASP's OSZICAR
// mirror in vaspout.h5. rms is the density residual, charge_rms the charge
// density residual (OSZICAR's rms(c) column — the "how converged is the
// charge density" signal).
interface ScfIonicStep {
  energies: number[]
  energy_deltas: (number | null)[]
  rms: (number | null)[]
  charge_rms: (number | null)[]
}

const finite_or_null = (value: unknown): number | null =>
  typeof value === `number` && Number.isFinite(value) ? value : null

// OSZICAR rows are [total_scf_rows, n_cols] with oszicar_label naming columns
// (N, E, dE, d eps, ncg, rms, rms(c)). The N counter resets to 1 at each new
// ionic step, which is how rows group into ionic steps (same as ferrox).
const read_oszicar_history = (h5_file: h5wasm.File): ScfIonicStep[] | null => {
  const rows = read_dataset(h5_file, OSZICAR_ROWS) as number[][] | null
  const labels = to_string_array(read_dataset(h5_file, OSZICAR_LABELS))
  if (!rows || !labels) return null
  const col = (name: string) => labels.findIndex((label) => label.trim() === name)
  const [n_col, energy_col] = [col(`N`), col(`E`)]
  if (n_col < 0 || energy_col < 0) return null
  const [delta_col, rms_col, charge_rms_col] = [col(`dE`), col(`rms`), col(`rms(c)`)]

  const ionic_steps: ScfIonicStep[] = []
  let current: ScfIonicStep | null = null
  let previous_scf_counter = Infinity
  for (const row of rows) {
    const scf_counter = row[n_col]
    const energy = finite_or_null(row[energy_col])
    if (energy === null || !Number.isFinite(scf_counter)) return null
    if (scf_counter <= previous_scf_counter || !current) {
      current = { energies: [], energy_deltas: [], rms: [], charge_rms: [] }
      ionic_steps.push(current)
    }
    current.energies.push(energy)
    current.energy_deltas.push(delta_col >= 0 ? finite_or_null(row[delta_col]) : null)
    current.rms.push(rms_col >= 0 ? finite_or_null(row[rms_col]) : null)
    current.charge_rms.push(charge_rms_col >= 0 ? finite_or_null(row[charge_rms_col]) : null)
    previous_scf_counter = scf_counter
  }
  return ionic_steps.length > 0 ? ionic_steps : null
}

// Fallback when the OSZICAR mirror is absent: the explicit per-ionic-step SCF
// energy dataset (shape [n_ionic, n_scf]); deltas derived from consecutive
// energies, no density residuals available.
const read_electronic_step_history = (h5_file: h5wasm.File): ScfIonicStep[] | null => {
  const rows = read_dataset(h5_file, ELECTRONIC_STEP_ENERGIES) as number[][] | null
  if (!rows) return null
  const ionic_steps = rows
    .map((row) => {
      const energies = (Array.isArray(row) ? row : [row]).filter(
        (val): val is number => typeof val === `number` && Number.isFinite(val),
      )
      return {
        energies,
        energy_deltas: energies.map((energy, idx) =>
          idx > 0 ? energy - energies[idx - 1] : null,
        ),
        rms: energies.map(() => null),
        charge_rms: energies.map(() => null),
      }
    })
    .filter((step) => step.energies.length > 0)
  return ionic_steps.length > 0 ? ionic_steps : null
}

const read_scf_history = (h5_file: h5wasm.File): ScfIonicStep[] | null =>
  read_oszicar_history(h5_file) ?? read_electronic_step_history(h5_file)

// Final-SCF-step summary attached to each ionic frame so relax trajectories
// plot SCF effort/residuals alongside energy and force_max.
const scf_frame_metadata = (scf: ScfIonicStep | undefined): Record<string, number> => {
  if (!scf || scf.energies.length === 0) return {}
  const metadata: Record<string, number> = { n_scf_steps: scf.energies.length }
  const last_delta =
    scf.energy_deltas.at(-1) ??
    (scf.energies.length >= 2
      ? (scf.energies.at(-1) as number) - (scf.energies.at(-2) as number)
      : null)
  if (last_delta !== null) metadata.scf_energy_delta = Math.abs(last_delta)
  const last_rms = scf.rms.at(-1)
  if (last_rms != null) metadata.scf_rms = last_rms
  const last_charge_rms = scf.charge_rms.at(-1)
  if (last_charge_rms != null) metadata.scf_charge_rms = last_charge_rms
  return metadata
}

// Bands/DOS-only outputs (e.g. phelel band-path files) carry no (complete)
// structure datasets but still have renderable electronic results: surface
// them as a zero-frame trajectory the webview routes to the spectral
// components. Files with neither structure nor electronic data throw.
const electronic_only_trajectory = (h5_file: h5wasm.File, missing: string): TrajectoryType => {
  const electronic = read_vaspout_electronic(h5_file)
  if (!electronic) {
    throw new Error(
      `vaspout.h5 file has no structure data (missing ${missing}) — ` +
        `and no electron_dos/electron_eigenvalues results either`,
    )
  }
  return {
    frames: [],
    metadata: {
      source_format: `vaspout_h5`,
      frame_count: 0,
      electronic,
      vaspout_electronic_only: true,
    },
  }
}

export function parse_vaspout_h5_file(h5_file: h5wasm.File): TrajectoryType {
  const ion_types = to_string_array(read_dataset(h5_file, FINAL_ION_TYPES))
  const ion_counts = to_number_array(read_dataset(h5_file, FINAL_ION_COUNTS))
  if (!ion_types || !ion_counts) {
    return electronic_only_trajectory(h5_file, `${FINAL_ION_TYPES} / ${FINAL_ION_COUNTS}`)
  }
  if (ion_types.length !== ion_counts.length) {
    throw new Error(
      `vaspout.h5 ion_types (${ion_types.length}) and number_ion_types (${ion_counts.length}) disagree`,
    )
  }
  const elements = expand_ion_types(ion_types, ion_counts)

  // POSCAR-style universal scaling factor; scalar in real files, but some
  // writers store it as a 1-element array.
  const scale = to_scalar_number(read_dataset(h5_file, FINAL_SCALE)) ?? 1

  const traj_positions = read_dataset(h5_file, TRAJ_POSITIONS) as number[][][] | null
  const traj_lattices = read_dataset(h5_file, TRAJ_LATTICE) as number[][][] | null
  const traj_forces = read_dataset(h5_file, TRAJ_FORCES) as number[][][] | null
  const energies = read_dataset(h5_file, ENERGY_VALUES) as number[][] | null
  const energy_tags = to_string_array(read_dataset(h5_file, ENERGY_LABELS))
  const { idx: energy_col, tag: energy_tag } = pick_energy_column(energy_tags)
  const scf_history = read_scf_history(h5_file)

  const frames: TrajectoryType[`frames`] = []
  let dropped_steps = 0

  // Shared frame assembly for the per-step trajectory path and the
  // final-structure fallback: validate + scale the lattice, convert fractional
  // positions to Cartesian, attach volume/SCF/energy (and optional forces).
  const build_frame = (
    lattice_data: unknown,
    frac_positions: number[][],
    step: number,
    scf: ScfIonicStep | undefined,
    raw_energy: unknown,
    forces?: unknown,
  ) => {
    const lattice = scale_matrix(validate_3x3_matrix(lattice_data), scale)
    const frac_to_cart = create_frac_to_cart(lattice)
    const positions = frac_positions.map((frac) => frac_to_cart(frac as Vec3))
    const metadata: Record<string, unknown> = {
      volume: calc_lattice_params(lattice).volume,
      ...scf_frame_metadata(scf),
    }
    const energy = finite_or_null(raw_energy)
    if (energy !== null) metadata.energy = energy
    if (Array.isArray(forces)) metadata.forces = forces
    return create_trajectory_frame(
      positions,
      elements,
      lattice,
      [true, true, true],
      step,
      metadata,
    )
  }

  if (traj_positions && traj_lattices) {
    // A torn file's datasets may disagree on step count; never index past the
    // shortest required one (forces/energies are optional per step).
    const n_steps = Math.min(traj_positions.length, traj_lattices.length)
    for (let step = 0; step < n_steps; step++) {
      try {
        frames.push(
          build_frame(
            traj_lattices[step],
            traj_positions[step],
            step,
            scf_history?.[step],
            energies?.[step]?.[energy_col],
            traj_forces?.[step],
          ),
        )
      } catch {
        // Torn final step: keep the frames parsed so far.
        dropped_steps = n_steps - step
        break
      }
    }
  }

  // Static (NSW=0) runs have no intermediate/ion_dynamics group at all; fall
  // back to the final structure so the file still opens as a 1-frame view.
  if (frames.length === 0) {
    const final_lattice_data = squeeze_leading_axis(read_dataset(h5_file, FINAL_LATTICE))
    const final_positions_data = squeeze_leading_axis(
      read_dataset(h5_file, FINAL_POSITIONS),
    ) as number[][] | null
    if (!final_lattice_data || !final_positions_data) {
      // Ion species exist but geometry is missing/torn — a bands/DOS-only
      // file can still render its electronic results.
      return electronic_only_trajectory(h5_file, `${TRAJ_POSITIONS} / ${FINAL_POSITIONS}`)
    }
    try {
      frames.push(
        build_frame(
          final_lattice_data,
          final_positions_data,
          0,
          scf_history?.at(-1),
          energies?.at(-1)?.[energy_col],
        ),
      )
    } catch {
      // Geometry datasets present but malformed (file torn mid-write): same
      // electronic-only fallback as when they're missing entirely.
      return electronic_only_trajectory(h5_file, `${FINAL_LATTICE} / ${FINAL_POSITIONS}`)
    }
  }

  // Static/single-point runs (one ionic step) get their SCF electronic steps
  // expanded into pseudo-frames: the structure stays fixed while energy, |dE|,
  // and the density residuals (incl. OSZICAR's rms(c) charge-density residual)
  // plot per SCF step — the convergence view that matters when watching a
  // running static job. Multi-point plots need >=2 frames, so this also makes
  // single-point files plottable at all.
  let frames_are_scf_steps = false
  const only_scf = scf_history?.length === 1 ? scf_history[0] : null
  if (frames.length === 1 && only_scf && only_scf.energies.length >= 2) {
    const base_frame = frames[0]
    frames.length = 0
    for (const [scf_idx, scf_energy] of only_scf.energies.entries()) {
      const metadata: Record<string, unknown> = {
        energy: scf_energy,
        volume: base_frame.metadata?.volume,
      }
      const delta = only_scf.energy_deltas[scf_idx]
      if (delta !== null) metadata.scf_energy_delta = Math.abs(delta)
      const rms = only_scf.rms[scf_idx]
      if (rms !== null) metadata.scf_rms = rms
      const charge_rms = only_scf.charge_rms[scf_idx]
      if (charge_rms !== null) metadata.scf_charge_rms = charge_rms
      frames.push({ structure: base_frame.structure, step: scf_idx, metadata })
    }
    frames_are_scf_steps = true
  }

  // Trajectory views only ever render the DOS panel, so skip reading the
  // (potentially large) eigenvalue arrays here — bands are read only on the
  // electronic-only paths above, which are the sole consumers.
  const dos = read_vaspout_dos(h5_file)

  return {
    frames,
    metadata: {
      source_format: `vaspout_h5`,
      frame_count: frames.length,
      num_atoms: elements.length,
      element_counts: count_elements(elements),
      periodic_boundary_conditions: [true, true, true],
      has_cell_info: true,
      ...(energy_tag ? { energy_tag } : {}),
      ...(dropped_steps > 0 ? { dropped_steps } : {}),
      ...(frames_are_scf_steps ? { frames_are_scf_steps: true } : {}),
      ...(dos ? { electronic: { dos, bands: null } } : {}),
    },
  }
}

export async function parse_vaspout_h5(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<TrajectoryType> {
  return with_h5_file(buffer, filename, parse_vaspout_h5_file)
}
