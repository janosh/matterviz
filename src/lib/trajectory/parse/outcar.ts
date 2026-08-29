// VASP OUTCAR trajectory parsing: one frame per `POSITION / TOTAL-FORCE` table (ionic step)
// with the cell printed just before it and the energies, stress and MD thermostat lines
// printed around it.
import type { ElementSymbol } from '$lib/element'
import { is_elem_symbol } from '$lib/element/helpers'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { parse_float_token } from '$lib/structure/parsers/shared'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import {
  calc_force_stats,
  create_trajectory_frame,
  expand_ion_types,
  split_lines,
} from '$lib/trajectory/helpers'
import type { ParsedTrajectory, WarnFn } from './shared'
import { vasp_run, vasp_stress_metadata } from './shared'

const NUMBER = `(?<value>-?\\d+\\.?\\d*(?:[EeDd][+-]?\\d+)?)`
const num_after = (label: string): RegExp => new RegExp(`${label}\\s*=\\s*${NUMBER}`)
// Standard runs print `free  energy   TOTEN`, machine-learned force field steps `ML TOTEN`
const TOTEN_RE = new RegExp(`free\\s+energy\\s+(?:ML\\s+)?TOTEN\\s*=\\s*${NUMBER}`)
const WO_ENTROPY_RE = num_after(`energy\\s+without\\s+entropy`)
const SIGMA_0_RE = num_after(`energy\\(sigma->0\\)`)
const EKIN_RE = num_after(`kinetic energy EKIN`)
const ETOTAL_RE = num_after(`total energy\\s+ETOTAL`)
const TEMPERATURE_RE = new RegExp(`\\(temperature\\s+${NUMBER}\\s*K\\)`)
const ITERATION_RE = /Iteration\s+\d+\(\s*(?<scf>\d+)\)/
const POTIM_RE = num_after(`POTIM`)
// Energies printed after a frame's position table, keyed by the metadata field they fill
const FRAME_ENERGY_RES: [RegExp, string][] = [
  [TOTEN_RE, `energy`],
  [WO_ENTROPY_RE, `energy_wo_entropy`],
  [SIGMA_0_RE, `energy_sigma_0`],
  [EKIN_RE, `kinetic_energy`],
  [TEMPERATURE_RE, `temperature`],
  [ETOTAL_RE, `total_energy`],
]

const numbers_of = (line: string): number[] => line.trim().split(/\s+/).map(parse_float_token)

// Species per ion: one `VRHFIN =Si:` line per POTCAR in the header, in the same order as the
// `ions per type` counts. Older OUTCARs without VRHFIN fall back to the `POTCAR:` echo,
// whose `Si_pv`-style names drop their suffix; it is printed twice, so only the first
// `n_types` lines count.
const parse_species = (
  lines: string[],
): { elements: ElementSymbol[]; atom_masses: number[] | undefined } => {
  const counts_line = lines.find((line) => line.includes(`ions per type`))
  if (!counts_line) throw new Error(`OUTCAR has no "ions per type" line`)
  const counts = numbers_of(counts_line.split(`=`)[1] ?? ``)
  if (counts.length === 0 || counts.some((count) => !Number.isInteger(count) || count <= 0)) {
    throw new Error(
      `OUTCAR "ions per type" line is not a list of positive counts: "${counts_line}"`,
    )
  }
  let symbols = lines.flatMap((line) => {
    const symbol = /VRHFIN\s*=\s*(?<symbol>[A-Za-z]+)\s*:/.exec(line)?.groups?.symbol
    return symbol ? [symbol] : []
  })
  if (symbols.length === 0) {
    symbols = lines
      .flatMap((line) => {
        const name = /^\s*POTCAR:\s+\S+\s+(?<name>\S+)/.exec(line)?.groups?.name
        return name ? [name.split(`_`)[0]] : []
      })
      .slice(0, counts.length)
  }
  if (symbols.length !== counts.length) {
    throw new Error(
      `OUTCAR lists ${symbols.length} species (${symbols.join(`, `)}) but ${counts.length} ion counts`,
    )
  }
  for (const symbol of symbols) {
    if (!is_elem_symbol(symbol))
      throw new Error(`Unknown element symbol in OUTCAR: "${symbol}"`)
  }
  const elements = expand_ion_types(symbols, counts)
  // `POMASS =   28.085; ZVAL   =    4.000` once per species in the header
  const masses = lines.flatMap((line) => {
    const mass = /POMASS\s*=\s*(?<mass>[\d.]+)\s*;\s*ZVAL/.exec(line)?.groups?.mass
    return mass ? [Number(mass)] : []
  })
  const atom_masses =
    masses.length === counts.length && masses.every((mass) => mass > 0)
      ? counts.flatMap((count, type_idx) => Array<number>(count).fill(masses[type_idx]))
      : undefined
  return { elements, atom_masses }
}

// Direct lattice vectors: three lines of `a_x a_y a_z  b*_x b*_y b*_z`, the first three
// numbers of each being the real-space vector
const parse_lattice = (lines: string[], start: number): Matrix3x3 | null => {
  const rows: Vec3[] = []
  for (let offset = 1; offset <= 3; offset++) {
    const values = numbers_of(lines[start + offset] ?? ``)
    if (values.length < 3 || values.slice(0, 3).some((val) => !Number.isFinite(val)))
      return null
    rows.push([values[0], values[1], values[2]])
  }
  return rows as Matrix3x3
}

export function parse_vasp_outcar(content: string, warn: WarnFn): ParsedTrajectory {
  const lines = split_lines(content)
  const version = lines
    .find((line) => /^\s*vasp\./.test(line))
    ?.trim()
    .split(/\s+/)[0]
  if (!version) throw new Error(`Not an OUTCAR file: missing "vasp.<version>" banner`)
  const { elements, atom_masses } = parse_species(lines)
  const n_atoms = elements.length
  // INCAR tags are echoed once, ahead of the first ionic step
  const header_end = lines.findIndex((line) => ITERATION_RE.test(line))
  const header = lines.slice(0, header_end === -1 ? lines.length : header_end).join(`\n`)
  const ibrion_match = /IBRION\s*=\s*(?<value>-?\d+)/.exec(header)
  const ibrion = ibrion_match ? Number(ibrion_match.groups?.value) : null
  const potim_match = POTIM_RE.exec(header)
  const potim = potim_match ? parse_float_token(potim_match.groups?.value) : null

  const frames: TrajectoryFrame[] = []
  let lattice: Matrix3x3 | null = null
  // Stress is printed before the position table it belongs to, energies and MD thermostat
  // lines after it, so a frame stays open until the next ionic step's first SCF iteration
  let pending: Record<string, unknown> = {}
  let current: Record<string, unknown> | null = null
  let n_scf_steps = 0

  for (let line_idx = 0; line_idx < lines.length; line_idx++) {
    const line = lines[line_idx]
    if (line.includes(`direct lattice vectors`)) {
      const parsed = parse_lattice(lines, line_idx)
      if (parsed) lattice = parsed
      continue
    }
    const iteration = ITERATION_RE.exec(line)
    if (iteration) {
      n_scf_steps = Number(iteration.groups?.scf)
      // per-SCF energies of the next step must not overwrite the closed frame's
      current = null
      continue
    }
    if (/^\s*in kB\s/.test(line)) {
      // XX YY ZZ XY YZ ZX in kB, VASP's sign convention (positive = compressive)
      const [xx, yy, zz, xy, yz, zx] = numbers_of(line.replace(/^\s*in kB/, ``))
      if ([xx, yy, zz, xy, yz, zx].every(Number.isFinite)) {
        pending = vasp_stress_metadata([
          [xx, xy, zx],
          [xy, yy, yz],
          [zx, yz, zz],
        ])
      }
      continue
    }
    if (line.includes(`POSITION`) && line.includes(`TOTAL-FORCE`)) {
      if (!lattice) {
        throw new Error(
          `OUTCAR line ${line_idx + 1}: position table before any lattice vectors`,
        )
      }
      const step = frames.length + 1
      const first_row = line_idx + 2 // skip the dashed rule under the header
      if (first_row + n_atoms > lines.length) {
        warn(
          `Dropping truncated final OUTCAR frame ${step} (line ${line_idx + 1}): ${Math.max(0, lines.length - first_row)} of ${n_atoms} position lines`,
        )
        break
      }
      const positions: Vec3[] = []
      const forces: Vec3[] = []
      for (let row = first_row; row < first_row + n_atoms; row++) {
        const values = numbers_of(lines[row])
        if (values.length !== 6 || values.some((val) => !Number.isFinite(val))) {
          throw new Error(
            `OUTCAR frame ${step} line ${row + 1} is not a position + force sextet: "${lines[row]}"`,
          )
        }
        positions.push([values[0], values[1], values[2]])
        forces.push([values[3], values[4], values[5]])
      }
      line_idx = first_row + n_atoms - 1
      const metadata: Record<string, unknown> = {
        ...pending,
        forces,
        ...calc_force_stats(forces),
      }
      if (n_scf_steps > 0) metadata.n_scf_steps = n_scf_steps
      pending = {}
      n_scf_steps = 0
      const frame = create_trajectory_frame(
        positions,
        elements,
        lattice,
        [true, true, true],
        step,
        metadata,
        forces.map((force) => ({ force })),
        warn,
      )
      frames.push(frame)
      // the energies printed after the table land on this frame's own metadata object
      current = frame.metadata ?? null
      continue
    }
    if (!current) continue
    for (const [pattern, key] of FRAME_ENERGY_RES) {
      const match = pattern.exec(line)
      if (match) current[key] = parse_float_token(match.groups?.value)
    }
  }
  if (frames.length === 0) throw new Error(`OUTCAR contains no POSITION / TOTAL-FORCE table`)

  return vasp_run(`outcar`, frames, atom_masses, { ibrion, potim, version })
}
