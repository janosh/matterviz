// Pourbaix entries from pymatgen's serialized (as_dict) data, without pymatgen: a list of
// PourbaixEntry, IonEntry or solid (ComputedEntry, PDEntry, ...) dicts, as MPRester's
// get_pourbaix_entries returns them, or a PourbaixDiagram dict with its comp_dict and
// conc_dict. Solids are filtered as pymatgen's filter_solids does, polymorphs reduced to the
// most stable one per formula.
import { get_electro_neg_formula } from '#lib/composition/format.js'
import { get_reduced_formula } from '#lib/composition/reduce.js'
import { HULL_STABILITY_TOL } from '#lib/convex-hull/entry-stability.js'
import { compute_e_above_hull } from '#lib/convex-hull/thermodynamics.js'
import type { PourbaixConfig, PourbaixEntry } from './types'

// pymatgen's ΔfG°(H2O, l) MU_H2O (eV), to which its entry energies are referenced
export const PYMATGEN_WATER_ENERGY = -2.4583

type Amounts = Record<string, number>
const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null && !Array.isArray(value)
const is_amounts = (value: unknown): value is Amounts =>
  is_record(value) && Object.values(value).every((amount) => typeof amount === `number`)
const count_atoms = (amounts: Amounts) =>
  Object.values(amounts).reduce((sum, val) => sum + val)

// Composition, charge and energy (eV per that composition) of one entry dict
function read_species(dict: unknown, idx: number) {
  const fail = (need: string) =>
    new Error(`pymatgen Pourbaix entry ${idx} needs ${need}, got ${JSON.stringify(dict)}`)
  // a PourbaixEntry wraps an IonEntry (entry_type Ion) or a solid entry
  const inner = is_record(dict) && `entry_type` in dict ? dict.entry : dict
  if (!is_record(inner) || typeof inner.energy !== `number`) throw fail(`a numeric energy`)
  if (is_record(inner.ion)) {
    const { charge = 0, ...composition } = inner.ion
    if (!Number.isInteger(charge) || !is_amounts(composition)) throw fail(`an integer charge`)
    return { composition, charge: charge as number, energy: inner.energy, ion: true }
  }
  if (!is_amounts(inner.composition)) throw fail(`an ion or a composition (no MultiEntry)`)
  // ComputedEntry stores its uncorrected energy and the sum of its corrections apart
  const energy = inner.energy + (typeof inner.correction === `number` ? inner.correction : 0)
  return { composition: inner.composition, charge: 0, energy, ion: false }
}

export function import_pymatgen_pourbaix(
  json: unknown,
): PourbaixConfig & { entries: PourbaixEntry[] } {
  const diagram = is_record(json) && Array.isArray(json.entries) ? json : null
  const list = diagram ? diagram.entries : json
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `Expected a non-empty list of pymatgen PourbaixEntry, IonEntry or ComputedEntry dicts, or a PourbaixDiagram dict`,
    )
  }
  const species = (list as unknown[]).map(read_species)
  // pymatgen's filter_solids: keep the solids on the hull of their energies relative to
  // water, ΔfG° - n_O·MU_H2O, with references H at 0 and O at 2.46 eV/atom
  const solids = species.filter(({ ion }) => !ion)
  const shifted = solids.map(({ composition, energy }) => ({
    composition,
    energy: energy - (composition.O ?? 0) * PYMATGEN_WATER_ENERGY,
  }))
  const refs = [
    { composition: { H: 1 }, energy: 0 },
    { composition: { O: 1 }, energy: 2.46 },
  ]
  const filter = diagram?.filter_solids !== false
  const e_above_hull = filter ? compute_e_above_hull(shifted, [...shifted, ...refs]) : []
  if (e_above_hull.some(Number.isNaN)) {
    throw new Error(`pymatgen filter_solids needs a solid of each element besides H and O`)
  }
  const kept = species.filter(
    (sp) => sp.ion || !filter || e_above_hull[solids.indexOf(sp)] <= HULL_STABILITY_TOL,
  )
  // formula of the reduced solid or of the ion as given, energy scaled to it
  const by_formula = new Map<string, PourbaixEntry>()
  for (const { composition, charge, energy, ion } of kept) {
    const formula_comp = ion ? composition : (get_reduced_formula(composition) as Amounts)
    const sign = charge > 0 ? `+` : `-`
    const suffix = charge ? `^${Math.abs(charge) === 1 ? `` : Math.abs(charge)}${sign}` : ``
    const formula = `${get_electro_neg_formula(formula_comp, { plain_text: true, delim: `` })}${suffix || (ion ? `(aq)` : ``)}`
    const scaled = energy * (count_atoms(formula_comp) / count_atoms(composition))
    const kept_energy = by_formula.get(formula)?.energy ?? Infinity
    if (scaled < kept_energy) by_formula.set(formula, { formula, energy: scaled })
  }
  // conc_dict: one shared activity, or one per element
  const conc = is_amounts(diagram?.conc_dict) ? Object.entries(diagram.conc_dict) : []
  const log_concs = conc.map(([el, molar]) => [el, Math.log10(molar)] as const)
  const shared = new Set(log_concs.map(([, val]) => val)).size === 1
  return {
    entries: [...by_formula.values()],
    water_energy: PYMATGEN_WATER_ENERGY,
    ...(is_amounts(diagram?.comp_dict) && { composition: diagram.comp_dict }),
    ...(shared && { log_conc: log_concs[0][1] }),
    ...(log_concs.length > 0 &&
      !shared && { element_log_conc: Object.fromEntries(log_concs) }),
  }
}
