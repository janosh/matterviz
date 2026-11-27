// Metal–water systems for the Pourbaix demo. Standard Gibbs free energies of formation
// ΔfG° (kJ/mol, 298.15 K) from OpenStax Chemistry 2e (Flowers et al., 2019), Appendix G
// "Standard Thermodynamic Properties for Selected Substances"
// (https://openstax.org/books/chemistry-2e/pages/g-standard-thermodynamic-properties-for-selected-substances).
// That table lists no hydroxo-anions (HFeO2^-, HCuO2^-, ZnO2^2-), so these diagrams leave
// out the alkaline redissolution region of the full Pourbaix-atlas diagrams.
import { EV_TO_KJ_PER_MOL } from '#lib/constants'
import type { PourbaixConfig, PourbaixEntry } from '#lib/pourbaix/index'
import { import_pymatgen_pourbaix } from '#lib/pourbaix/pymatgen'
// Materials Project Ag–Te entries (DFT solids, experimental ions) from pymatgen's test files
// (test-files/analysis/pourbaix_diagram/pourbaix_test_data.json, MIT license), saved as the
// PourbaixDiagram(comp_dict={Ag: 0.5, Te: 0.5}, conc_dict={Ag: 1e-8, Te: 1e-8}) of
// pymatgen's binary Pourbaix test
import ag_te_mp from './pourbaix/Ag-Te-mp.json.gz'

// ΔfG°(H2O, l) = -237.1 kJ/mol in the same table, eV
export const water_energy = -237.1 / EV_TO_KJ_PER_MOL

// ΔfG° in kJ/mol by formula, in color order
const openstax = (kj_per_mol: Record<string, number>) => ({
  entries: Object.entries(kj_per_mol).map(([formula, kj]) => ({
    formula,
    energy: kj / EV_TO_KJ_PER_MOL,
  })),
  water_energy,
})

// oxfmt-ignore
export const pourbaix_systems: Record<string, PourbaixConfig & { entries: PourbaixEntry[] }> = {
  // Pourbaix's oxide set. Left out: FeO (-255.2), as wüstite is metastable below 570 °C
  // (eutectoid Fe + Fe3O4) though the table's stoichiometric value would give it a thin
  // domain; Fe(OH)2 (-486.5) and Fe(OH)3 (-696.5) never win with these values, as
  // 4Fe(OH)2 → Fe + Fe3O4 + 4H2O (ΔG = -17.8 kJ) and Fe(OH)3 → ½Fe2O3 + 3/2 H2O
  // (ΔG = -30.3 kJ) release no H+ or e-, so they hold at every (pH, E).
  'Fe–H2O': openstax({ Fe: 0, 'Fe^2+': -78.9, 'Fe^3+': -4.7, Fe3O4: -1015.4, Fe2O3: -742.2 }),
  'Cu–H2O': openstax({ Cu: 0, 'Cu^+': 50.2, 'Cu^2+': 65.49, Cu2O: -146.0, CuO: -129.7 }),
  'Zn–H2O': openstax({ Zn: 0, 'Zn^2+': -147.1, ZnO: -320.5 }),
  'Ag–Te–H2O (MP)': import_pymatgen_pourbaix(ag_te_mp),
}
