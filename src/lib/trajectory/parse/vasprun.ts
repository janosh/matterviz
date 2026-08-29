// VASP vasprun.xml trajectory parsing: one frame per <calculation> (ionic step) with the
// step's final structure, forces, stress and energies.
// The file is scanned as text rather than parsed as XML: parsing runs in a worker without
// DOMParser, and a DOM of a multi-hundred-MB vasprun (projected DOS, eigenvalues per
// k-point) would dwarf the few tags a trajectory needs.
import type { ElementSymbol } from '$lib/element'
import { is_elem_symbol } from '$lib/element/helpers'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { parse_float_token } from '$lib/structure/parsers/shared'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { calc_force_stats, create_trajectory_frame } from '$lib/trajectory/helpers'
import type { ParsedTrajectory, WarnFn } from './shared'
import { vasp_run, vasp_stress_metadata } from './shared'

// Inner text of the first `<tag ... name="name">…</tag>` after `from`, or null when the tag
// is absent or unclosed. The close tag is looked up after the open tag, so a torn file never
// matches an earlier close tag by accident.
type TagBody = { body: string; end: number }
const tag_body = (text: string, tag: string, name = ``, from = 0): TagBody | null => {
  const attrs = name ? `[^>]*name="${name}"` : ``
  const open_pattern = new RegExp(`<${tag}${attrs}[^>]*>`, `g`)
  open_pattern.lastIndex = from
  const open = open_pattern.exec(text)
  if (!open) return null
  const close_tag = `</${tag}>`
  const body_start = open.index + open[0].length
  const close = text.indexOf(close_tag, body_start)
  if (close === -1) return null
  return { body: text.slice(body_start, close), end: close + close_tag.length }
}

// The last `<tag ...>…</tag>` in `text`, e.g. the final <structure> of an ionic step
const last_tag_body = (text: string, tag: string): TagBody | null => {
  const last_open = text.lastIndexOf(`<${tag}`)
  return last_open === -1 ? null : tag_body(text, tag, ``, last_open)
}

// Rows of a `<varray name="…">`: every `<v>` line as a number triple
const parse_varray = (text: string, name: string): Vec3[] | null => {
  const found = tag_body(text, `varray`, name)
  if (!found) return null
  const rows: Vec3[] = []
  for (const match of found.body.matchAll(/<v>(?<row>[^<]*)<\/v>/g)) {
    const raw = match.groups?.row ?? ``
    const tokens = raw.trim().split(/\s+/)
    if (tokens.length !== 3) {
      throw new Error(`vasprun.xml <varray name="${name}"> row is not a triple: "${raw}"`)
    }
    const row = tokens.map(parse_float_token) as Vec3
    if (row.some((val) => !Number.isFinite(val))) {
      throw new Error(`vasprun.xml <varray name="${name}"> row is not numeric: "${raw}"`)
    }
    rows.push(row)
  }
  return rows
}

// `<i name="key">value</i>` anywhere in `text`, as a number or null
const scalar_of = (text: string, key: string): number | null => {
  const value = parse_float_token(tag_body(text, `i`, key)?.body)
  return Number.isFinite(value) ? value : null
}

// `<rc><c>a</c><c>b</c>…</rc>` rows of an <array>, as their cell strings
const array_rows = (text: string, name: string): string[][] | null => {
  const found = tag_body(text, `array`, name)
  if (!found) return null
  return [...found.body.matchAll(/<rc>(?<row>.*?)<\/rc>/gs)].map((row) =>
    [...(row.groups?.row ?? ``).matchAll(/<c>(?<cell>[^<]*)<\/c>/g)].map((cell) =>
      (cell.groups?.cell ?? ``).trim(),
    ),
  )
}

// Species per ion plus the mass of each ion's type, from <atominfo>
const parse_atominfo = (
  content: string,
): { elements: ElementSymbol[]; atom_masses: number[] | undefined } => {
  const atominfo = tag_body(content, `atominfo`)
  if (!atominfo) throw new Error(`vasprun.xml has no complete <atominfo> block`)
  const atoms = array_rows(atominfo.body, `atoms`)
  if (!atoms || atoms.length === 0) {
    throw new Error(`vasprun.xml <atominfo> lists no atoms`)
  }
  const elements = atoms.map(([symbol]) => {
    if (!is_elem_symbol(symbol)) {
      throw new Error(`Unknown element symbol in vasprun.xml <atominfo>: "${symbol}"`)
    }
    return symbol
  })
  // atomtypes rows: atomspertype, element, mass, valence, pseudopotential
  const masses_by_type = (array_rows(atominfo.body, `atomtypes`) ?? []).map((row) =>
    parse_float_token(row[2]),
  )
  const atom_masses = atoms.map(
    ([_symbol, type_idx]) => masses_by_type[parse_float_token(type_idx) - 1],
  )
  const masses_ok = atom_masses.every((mass) => Number.isFinite(mass) && mass > 0)
  return { elements, atom_masses: masses_ok ? atom_masses : undefined }
}

// Energies of an ionic step's final <energy> block, keyed by the metadata field they fill
const ENERGY_KEYS: [string, string][] = [
  [`e_fr_energy`, `energy`], // free energy TOTEN, VASP's headline energy
  [`e_wo_entrp`, `energy_wo_entropy`],
  [`e_0_energy`, `energy_sigma_0`],
  [`kinetic`, `kinetic_energy`], // MD only
  [`total`, `total_energy`], // MD only: free energy plus kinetic and thermostat terms
]

export function parse_vasprun_xml(content: string, warn: WarnFn): ParsedTrajectory {
  if (!content.includes(`<modeling>`)) {
    throw new Error(`Not a vasprun.xml file: missing <modeling> root element`)
  }
  const { elements, atom_masses } = parse_atominfo(content)

  const frames: TrajectoryFrame[] = []
  const open_tag = `<calculation>`
  const close_tag = `</calculation>`
  let cursor = content.indexOf(open_tag)
  while (cursor !== -1) {
    const body_start = cursor + open_tag.length
    const close = content.indexOf(close_tag, body_start)
    const step = frames.length + 1
    if (close === -1) {
      // VASP appends the block as the ionic step runs, so a missing close tag is a run
      // still writing (or killed): drop the partial step rather than half-report it
      warn(`Dropping incomplete final vasprun.xml <calculation> block (ionic step ${step})`)
      break
    }
    const block = content.slice(body_start, close)
    cursor = content.indexOf(open_tag, close + close_tag.length)

    // The last <structure> in the block is the geometry the forces and energies belong to
    const structure = last_tag_body(block, `structure`)
    if (!structure) {
      throw new Error(`vasprun.xml <calculation> block ${step} has no <structure>`)
    }
    const basis = parse_varray(structure.body, `basis`)
    const frac_positions = parse_varray(structure.body, `positions`)
    if (basis?.length !== 3) {
      throw new Error(`vasprun.xml ionic step ${step}: <varray name="basis"> is not 3 rows`)
    }
    if (!frac_positions || frac_positions.length !== elements.length) {
      throw new Error(
        `vasprun.xml ionic step ${step}: ${frac_positions?.length ?? 0} positions for ${elements.length} atoms`,
      )
    }
    const lattice_matrix = basis as Matrix3x3
    const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
    const positions = frac_positions.map(frac_to_cart)

    const metadata: Record<string, unknown> = {}
    // Forces and stress sit after the structure; energies of the step are the last
    // <energy> block, the earlier ones belong to individual <scstep>s
    const after_structure = block.slice(structure.end)
    let forces = parse_varray(after_structure, `forces`)
    if (forces && forces.length !== elements.length) {
      warn(
        `vasprun.xml ionic step ${step}: ${forces.length} force rows for ${elements.length} atoms, forces dropped`,
      )
      forces = null
    }
    const site_properties = forces?.map((force) => ({ force }))
    if (forces) Object.assign(metadata, { forces }, calc_force_stats(forces))
    const stress = parse_varray(after_structure, `stress`)
    if (stress?.length === 3)
      Object.assign(metadata, vasp_stress_metadata(stress as Matrix3x3))
    const energy_block = last_tag_body(block, `energy`)?.body ?? ``
    for (const [xml_key, key] of ENERGY_KEYS) {
      const value = scalar_of(energy_block, xml_key)
      if (value !== null) metadata[key] = value
    }
    const n_scf_steps = block.split(`<scstep>`).length - 1
    if (n_scf_steps > 0) metadata.n_scf_steps = n_scf_steps

    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        [true, true, true],
        step,
        metadata,
        site_properties,
        warn,
      ),
    )
  }
  if (frames.length === 0) throw new Error(`vasprun.xml contains no complete <calculation>`)

  const version = tag_body(content, `i`, `version`)?.body.trim()
  // The <parameters> echo carries every INCAR tag with its default, the <incar> echo only
  // what the user set, so the tags are read from the former and fall back to the whole file
  const parameters = tag_body(content, `parameters`)?.body ?? content
  return vasp_run(`vasprun`, frames, atom_masses, {
    ibrion: scalar_of(parameters, `IBRION`),
    potim: scalar_of(parameters, `POTIM`),
    version,
  })
}
