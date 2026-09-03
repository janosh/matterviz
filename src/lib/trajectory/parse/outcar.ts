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
// First `<label> = <number>` in `text`, or null when the tag is absent
const num_tag = (text: string, label: string): number | null => {
  const match = num_after(label).exec(text)
  return match ? parse_float_token(match.groups?.value) : null
}
const ITERATION_RE = /Iteration\s+\d+\(\s*(?<scf>\d+)\)/
// Energies printed after a frame's position table, keyed by the metadata field they fill
const FRAME_ENERGY_RES: [RegExp, string][] = [
  // standard runs print `free  energy   TOTEN`, machine-learned force field steps `ML TOTEN`
  [num_after(`free\\s+energy\\s+(?:ML\\s+)?TOTEN`), `energy`],
  [num_after(`energy\\s+without\\s+entropy`), `energy_wo_entropy`],
  [num_after(`energy\\(sigma->0\\)`), `energy_sigma_0`],
  [num_after(`kinetic energy EKIN`), `kinetic_energy`],
  [new RegExp(`\\(temperature\\s+${NUMBER}\\s*K\\)`), `temperature`],
  [num_after(`total energy\\s+ETOTAL`), `total_energy`],
]

const numbers_of = (line: string): number[] => line.trim().split(/\s+/).map(parse_float_token)
// The `value` capture group of `pattern` on every line that has one, in file order
const captures = (lines: string[], pattern: RegExp): string[] =>
  lines.flatMap((line) => pattern.exec(line)?.groups?.value ?? [])

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
  if (counts.some((count) => !Number.isInteger(count) || count <= 0)) {
    throw new Error(
      `OUTCAR "ions per type" line is not a list of positive counts: "${counts_line}"`,
    )
  }
  let symbols = captures(lines, /VRHFIN\s*=\s*(?<value>[A-Za-z]+)\s*:/)
  if (symbols.length === 0) {
    symbols = captures(lines, /^\s*POTCAR:\s+\S+\s+(?<value>\S+)/)
      .map((name) => name.split(`_`)[0])
      .slice(0, counts.length)
  }
  if (symbols.length !== counts.length) {
    throw new Error(
      `OUTCAR lists ${symbols.length} species (${symbols.join(`, `)}) but ${counts.length} ion counts`,
    )
  }
  const unknown = symbols.find((symbol) => !is_elem_symbol(symbol))
  if (unknown) throw new Error(`Unknown element symbol in OUTCAR: "${unknown}"`)
  // One position line per ion per ionic step, so the line count bounds the declared total
  const elements = expand_ion_types(symbols, counts, {
    max_ions: lines.length,
    source: `OUTCAR lines`,
  })
  // `POMASS =   28.085; ZVAL   =    4.000` once per species in the header
  const masses = captures(lines, /POMASS\s*=\s*(?<value>[\d.]+)\s*;\s*ZVAL/).map(Number)
  const atom_masses =
    masses.length === counts.length && masses.every((mass) => mass > 0)
      ? counts.flatMap((count, type_idx) => Array<number>(count).fill(masses[type_idx]))
      : undefined
  return { elements, atom_masses }
}

// Direct lattice vectors: three lines of `a_x a_y a_z  b*_x b*_y b*_z`, the first three
// numbers of each being the real-space vector
const parse_lattice = (lines: string[], start: number): Matrix3x3 | null => {
  const rows = [1, 2, 3].map((offset) => numbers_of(lines[start + offset] ?? ``).slice(0, 3))
  const is_row = (row: number[]) => row.length === 3 && row.every(Number.isFinite)
  return rows.every(is_row) ? (rows as Matrix3x3) : null
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
  const ibrion = num_tag(header, `IBRION`)
  const potim = num_tag(header, `POTIM`)

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
      // Skipping a corrupt block silently kept the PREVIOUS cell, wronging every volume and
      // fractional coordinate of the rest of an ISIF=3 run
      const parsed = parse_lattice(lines, line_idx)
      if (!parsed) {
        throw new Error(
          `OUTCAR line ${line_idx + 1}: "direct lattice vectors" is not followed by three ` +
            `rows of finite numbers: "${lines.slice(line_idx + 1, line_idx + 4).join(` | `)}"`,
        )
      }
      lattice = parsed
      continue
    }
    const iteration = ITERATION_RE.exec(line)
    if (iteration) {
      n_scf_steps = Number(iteration.groups?.scf)
      // per-SCF energies of the next step must not overwrite the closed frame's
      current = null
      continue
    }
    const kbar = /^\s*in kB\s(?<values>.*)/.exec(line)
    if (kbar) {
      // XX YY ZZ XY YZ ZX in kB, VASP's sign convention (positive = compressive)
      const [xx, yy, zz, xy, yz, zx] = numbers_of(kbar.groups?.values ?? ``)
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
