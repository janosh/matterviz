// Curated table of common commercial solid-state precursors with the handling data a recipe
// needs: decomposition and melting temperatures, volatiles released on heating, hygroscopicity
// and hazards. Temperatures are approximate literature values (±50 K) at ambient pressure and
// serve as heating-schedule guidance, not as thermodynamic input.
import { get_alphabetical_formula } from '$lib/composition/format'
import { parse_composition } from '$lib/composition/parse'
import { get_reduced_formula } from '$lib/composition/reduce'
import type { GasSpecies } from '$lib/convex-hull/types'

export interface PrecursorInfo {
  formula: string
  name: string
  // Onset of decomposition / volatile loss in air (K)
  decomposition_K?: number
  melting_K?: number
  // Gas released on decomposition
  releases?: GasSpecies[]
  hygroscopic?: boolean
  air_sensitive?: boolean
  hazards?: string[]
  notes?: string
}

// oxfmt-ignore
export const PRECURSOR_LIBRARY: readonly PrecursorInfo[] = [
  // === Carbonates ===
  { formula: `Li2CO3`, name: `lithium carbonate`, melting_K: 996, decomposition_K: 1000, releases: [`CO2`], notes: `Standard Li source; reacts with oxides well below its melting point. Volatile Li loss above ~1200 K, use slight excess.` },
  { formula: `Na2CO3`, name: `sodium carbonate`, melting_K: 1124, decomposition_K: 1120, releases: [`CO2`], hygroscopic: true, notes: `Dry at 470 K before weighing.` },
  { formula: `K2CO3`, name: `potassium carbonate`, melting_K: 1164, decomposition_K: 1160, releases: [`CO2`], hygroscopic: true, notes: `Very hygroscopic; dry before use and weigh quickly.` },
  { formula: `MgCO3`, name: `magnesium carbonate`, decomposition_K: 620, releases: [`CO2`] },
  { formula: `CaCO3`, name: `calcium carbonate`, decomposition_K: 1100, releases: [`CO2`], notes: `Decomposes to CaO near 1100 K in air (lower at reduced p_CO2).` },
  { formula: `SrCO3`, name: `strontium carbonate`, decomposition_K: 1400, releases: [`CO2`], notes: `Reacts with oxides from ~1100 K, full decomposition needs >1400 K.` },
  { formula: `BaCO3`, name: `barium carbonate`, decomposition_K: 1630, melting_K: 1084, releases: [`CO2`], hazards: [`toxic`], notes: `Reacts with oxides from ~1000 K although the pure carbonate is stable to ~1600 K.` },
  { formula: `MnCO3`, name: `manganese(II) carbonate`, decomposition_K: 520, releases: [`CO2`], notes: `Oxidizes to Mn oxides on heating in air.` },
  { formula: `CoCO3`, name: `cobalt(II) carbonate`, decomposition_K: 570, releases: [`CO2`], hazards: [`toxic`, `sensitizer`] },
  { formula: `NiCO3`, name: `nickel(II) carbonate`, decomposition_K: 570, releases: [`CO2`], hazards: [`toxic`, `carcinogen`] },
  { formula: `ZnCO3`, name: `zinc carbonate`, decomposition_K: 570, releases: [`CO2`] },
  { formula: `FeCO3`, name: `iron(II) carbonate (siderite)`, decomposition_K: 570, releases: [`CO2`], air_sensitive: true },
  // === Hydroxides ===
  { formula: `LiOH`, name: `lithium hydroxide`, melting_K: 735, decomposition_K: 1200, releases: [`H2O`], hygroscopic: true, hazards: [`corrosive`], notes: `Absorbs CO2 from air; store sealed.` },
  { formula: `NaOH`, name: `sodium hydroxide`, melting_K: 591, releases: [`H2O`], hygroscopic: true, hazards: [`corrosive`] },
  { formula: `KOH`, name: `potassium hydroxide`, melting_K: 633, releases: [`H2O`], hygroscopic: true, hazards: [`corrosive`] },
  { formula: `Mg(OH)2`, name: `magnesium hydroxide`, decomposition_K: 620, releases: [`H2O`] },
  { formula: `Ca(OH)2`, name: `calcium hydroxide`, decomposition_K: 850, releases: [`H2O`], hazards: [`corrosive`] },
  { formula: `Al(OH)3`, name: `aluminium hydroxide`, decomposition_K: 450, releases: [`H2O`] },
  { formula: `Ni(OH)2`, name: `nickel(II) hydroxide`, decomposition_K: 500, releases: [`H2O`], hazards: [`toxic`, `carcinogen`] },
  { formula: `Co(OH)2`, name: `cobalt(II) hydroxide`, decomposition_K: 440, releases: [`H2O`], hazards: [`toxic`] },
  { formula: `FeO(OH)`, name: `iron(III) oxyhydroxide (goethite)`, decomposition_K: 570, releases: [`H2O`] },
  { formula: `H3BO3`, name: `boric acid`, decomposition_K: 440, releases: [`H2O`], notes: `Loses water stepwise to B2O3; weigh as boric acid, count as B2O3.` },
  // === Oxides ===
  { formula: `Li2O`, name: `lithium oxide`, melting_K: 1711, hygroscopic: true, air_sensitive: true, hazards: [`corrosive`], notes: `Converts to LiOH/Li2CO3 in air; handle in glovebox. Li2CO3 is the usual substitute.` },
  { formula: `Li2O2`, name: `lithium peroxide`, decomposition_K: 570, releases: [`O2`], hygroscopic: true, air_sensitive: true, hazards: [`oxidizer`] },
  { formula: `Na2O`, name: `sodium oxide`, hygroscopic: true, air_sensitive: true, hazards: [`corrosive`], notes: `Rarely used directly; Na2CO3 is the practical Na source.` },
  { formula: `MgO`, name: `magnesium oxide`, melting_K: 3125, hygroscopic: true, notes: `Fire at 1200 K before weighing to remove adsorbed water/CO2.` },
  { formula: `CaO`, name: `calcium oxide`, melting_K: 2886, hygroscopic: true, hazards: [`corrosive`], notes: `Readily hydrates/carbonates in air; CaCO3 is the usual substitute.` },
  { formula: `SrO`, name: `strontium oxide`, melting_K: 2804, hygroscopic: true, air_sensitive: true, notes: `SrCO3 is the practical Sr source.` },
  { formula: `BaO`, name: `barium oxide`, melting_K: 2196, hygroscopic: true, air_sensitive: true, hazards: [`toxic`, `corrosive`], notes: `BaCO3 is the practical Ba source.` },
  { formula: `Al2O3`, name: `aluminium oxide (corundum)`, melting_K: 2345, notes: `Sluggish reactant; use fine (< 1 um) powder or long anneals.` },
  { formula: `SiO2`, name: `silicon dioxide`, melting_K: 1986, notes: `Use amorphous silica for faster kinetics.` },
  { formula: `TiO2`, name: `titanium dioxide`, melting_K: 2116, notes: `Anatase converts to rutile above ~900 K; both work as precursors.` },
  { formula: `ZrO2`, name: `zirconium dioxide`, melting_K: 2988, notes: `Very refractory; reactions need >1500 K or long anneals.` },
  { formula: `HfO2`, name: `hafnium dioxide`, melting_K: 3031 },
  { formula: `V2O5`, name: `vanadium pentoxide`, melting_K: 954, hazards: [`toxic`], notes: `Melts at 954 K and acts as a flux; volatile above ~1100 K.` },
  { formula: `Nb2O5`, name: `niobium pentoxide`, melting_K: 1785 },
  { formula: `Ta2O5`, name: `tantalum pentoxide`, melting_K: 2145 },
  { formula: `Cr2O3`, name: `chromium(III) oxide`, melting_K: 2708, notes: `Volatile CrO3 loss in air above ~1300 K.` },
  { formula: `MnO2`, name: `manganese dioxide`, decomposition_K: 810, releases: [`O2`], notes: `Loses O2 to Mn2O3 (~810 K) and Mn3O4 (~1350 K) in air.` },
  { formula: `Mn2O3`, name: `manganese(III) oxide`, decomposition_K: 1350, releases: [`O2`] },
  { formula: `Mn3O4`, name: `manganese(II,III) oxide (hausmannite)`, melting_K: 1840 },
  { formula: `MnO`, name: `manganese(II) oxide`, melting_K: 2218, air_sensitive: true, notes: `Oxidizes in air on heating; use inert atmosphere.` },
  { formula: `Fe2O3`, name: `iron(III) oxide (hematite)`, melting_K: 1838, notes: `Reduces to Fe3O4 above ~1650 K in air.` },
  { formula: `Fe3O4`, name: `iron(II,III) oxide (magnetite)`, melting_K: 1870, notes: `Oxidizes to Fe2O3 on heating in air; use inert/reducing atmosphere.` },
  { formula: `FeO`, name: `iron(II) oxide (wustite)`, melting_K: 1650, air_sensitive: true },
  { formula: `Co3O4`, name: `cobalt(II,III) oxide`, decomposition_K: 1170, releases: [`O2`], hazards: [`toxic`, `sensitizer`], notes: `Loses O2 to CoO above ~1170 K in air.` },
  { formula: `CoO`, name: `cobalt(II) oxide`, melting_K: 2206, hazards: [`toxic`], notes: `Oxidizes to Co3O4 below ~1170 K in air.` },
  { formula: `NiO`, name: `nickel(II) oxide`, melting_K: 2228, hazards: [`toxic`, `carcinogen`] },
  { formula: `CuO`, name: `copper(II) oxide`, melting_K: 1599, decomposition_K: 1300, releases: [`O2`], notes: `Reduces to Cu2O above ~1300 K in air.` },
  { formula: `Cu2O`, name: `copper(I) oxide`, melting_K: 1505, notes: `Oxidizes to CuO in air below ~1300 K.` },
  { formula: `ZnO`, name: `zinc oxide`, melting_K: 2247, notes: `Volatile above ~1500 K.` },
  { formula: `Ga2O3`, name: `gallium(III) oxide`, melting_K: 2080 },
  { formula: `In2O3`, name: `indium(III) oxide`, melting_K: 2185 },
  { formula: `GeO2`, name: `germanium dioxide`, melting_K: 1388, notes: `Volatile GeO loss under reducing conditions.` },
  { formula: `SnO2`, name: `tin(IV) oxide`, melting_K: 1903 },
  { formula: `PbO`, name: `lead(II) oxide`, melting_K: 1161, hazards: [`toxic`], notes: `Volatile above ~1100 K; use closed crucibles or PbO excess.` },
  { formula: `Sb2O3`, name: `antimony(III) oxide`, melting_K: 929, hazards: [`toxic`], notes: `Sublimes above ~800 K.` },
  { formula: `Bi2O3`, name: `bismuth(III) oxide`, melting_K: 1090, notes: `Low-melting, acts as a flux; volatile above ~1200 K.` },
  { formula: `MoO3`, name: `molybdenum trioxide`, melting_K: 1068, notes: `Sublimes significantly above ~950 K; pre-react at low T or use closed crucible.` },
  { formula: `WO3`, name: `tungsten trioxide`, melting_K: 1746 },
  { formula: `La2O3`, name: `lanthanum(III) oxide`, melting_K: 2580, hygroscopic: true, notes: `Forms La(OH)3/La2O2CO3 in air; fire at 1200 K before weighing.` },
  { formula: `CeO2`, name: `cerium(IV) oxide`, melting_K: 2670 },
  { formula: `Nd2O3`, name: `neodymium(III) oxide`, melting_K: 2545, hygroscopic: true, notes: `Fire at 1200 K before weighing.` },
  { formula: `Gd2O3`, name: `gadolinium(III) oxide`, melting_K: 2693, hygroscopic: true },
  { formula: `Y2O3`, name: `yttrium(III) oxide`, melting_K: 2698, hygroscopic: true, notes: `Fire at 1200 K before weighing.` },
  { formula: `Sc2O3`, name: `scandium(III) oxide`, melting_K: 2758 },
  { formula: `B2O3`, name: `boron trioxide`, melting_K: 723, hygroscopic: true, notes: `Melts at 723 K and acts as a flux; H3BO3 is the usual source.` },
  { formula: `P2O5`, name: `phosphorus pentoxide`, decomposition_K: 630, hygroscopic: true, hazards: [`corrosive`], notes: `Extremely hygroscopic and volatile; NH4H2PO4 or (NH4)2HPO4 are the usual P sources.` },
  // === Phosphates and ammonium salts ===
  { formula: `NH4H2PO4`, name: `ammonium dihydrogen phosphate`, decomposition_K: 460, releases: [`H2O`, `N2`, `H2`], notes: `Loses NH3 and H2O on heating, leaving P2O5; balance with N2/H2/H2O as open species.` },
  { formula: `(NH4)2HPO4`, name: `diammonium hydrogen phosphate`, decomposition_K: 430, releases: [`H2O`, `N2`, `H2`], notes: `Loses NH3 and H2O on heating, leaving P2O5.` },
  { formula: `Li3PO4`, name: `lithium phosphate`, melting_K: 1110 },
  { formula: `Na3PO4`, name: `sodium phosphate`, melting_K: 1613, hygroscopic: true },
  { formula: `FePO4`, name: `iron(III) phosphate`, melting_K: 1450 },
  // === Sulfides and sulfur ===
  { formula: `S`, name: `sulfur`, melting_K: 388, notes: `Volatile; seal in evacuated ampoule for sulfide synthesis.` },
  { formula: `Li2S`, name: `lithium sulfide`, melting_K: 1211, hygroscopic: true, air_sensitive: true, hazards: [`releases H2S with moisture`], notes: `Glovebox handling required.` },
  { formula: `Na2S`, name: `sodium sulfide`, melting_K: 1449, hygroscopic: true, air_sensitive: true, hazards: [`releases H2S with moisture`] },
  { formula: `P2S5`, name: `phosphorus pentasulfide`, melting_K: 561, air_sensitive: true, hazards: [`toxic`, `flammable`, `releases H2S with moisture`], notes: `Glovebox handling required.` },
  { formula: `FeS`, name: `iron(II) sulfide`, melting_K: 1467, air_sensitive: true },
  { formula: `ZnS`, name: `zinc sulfide`, melting_K: 2120 },
  { formula: `MnS`, name: `manganese(II) sulfide`, melting_K: 1883, air_sensitive: true },
  { formula: `SiS2`, name: `silicon disulfide`, melting_K: 1363, air_sensitive: true, hazards: [`releases H2S with moisture`] },
  { formula: `GeS2`, name: `germanium disulfide`, melting_K: 1113, air_sensitive: true },
  // === Halides ===
  { formula: `LiF`, name: `lithium fluoride`, melting_K: 1118, hazards: [`toxic`] },
  { formula: `NaF`, name: `sodium fluoride`, melting_K: 1266, hazards: [`toxic`] },
  { formula: `KF`, name: `potassium fluoride`, melting_K: 1131, hygroscopic: true, hazards: [`toxic`] },
  { formula: `MgF2`, name: `magnesium fluoride`, melting_K: 1536 },
  { formula: `CaF2`, name: `calcium fluoride`, melting_K: 1691 },
  { formula: `AlF3`, name: `aluminium fluoride`, melting_K: 1564, notes: `Sublimes above ~1500 K.` },
  { formula: `LiCl`, name: `lithium chloride`, melting_K: 878, hygroscopic: true, notes: `Common flux; very hygroscopic.` },
  { formula: `NaCl`, name: `sodium chloride`, melting_K: 1074 },
  { formula: `KCl`, name: `potassium chloride`, melting_K: 1044 },
  // === Elements ===
  { formula: `Li`, name: `lithium metal`, melting_K: 454, air_sensitive: true, hazards: [`flammable`, `corrosive`], notes: `Glovebox only; rarely used for oxide synthesis.` },
  { formula: `Na`, name: `sodium metal`, melting_K: 371, air_sensitive: true, hazards: [`flammable`, `corrosive`, `water-reactive`] },
  { formula: `Mg`, name: `magnesium metal`, melting_K: 923, hazards: [`flammable`] },
  { formula: `Al`, name: `aluminium metal`, melting_K: 933 },
  { formula: `Si`, name: `silicon`, melting_K: 1687 },
  { formula: `Ti`, name: `titanium metal`, melting_K: 1941, hazards: [`flammable as fine powder`] },
  { formula: `Fe`, name: `iron metal`, melting_K: 1811 },
  { formula: `Co`, name: `cobalt metal`, melting_K: 1768, hazards: [`toxic`, `sensitizer`] },
  { formula: `Ni`, name: `nickel metal`, melting_K: 1728, hazards: [`toxic`, `carcinogen`] },
  { formula: `Cu`, name: `copper metal`, melting_K: 1358 },
  { formula: `Zn`, name: `zinc metal`, melting_K: 693, notes: `Volatile above ~1000 K (boils 1180 K).` },
  { formula: `Sn`, name: `tin metal`, melting_K: 505 },
  { formula: `Ge`, name: `germanium`, melting_K: 1211 },
  { formula: `C`, name: `graphite (carbon)`, notes: `Reducing agent; burns off as CO/CO2 in air.` },
  { formula: `P`, name: `red phosphorus`, melting_K: 863, air_sensitive: true, hazards: [`flammable`, `toxic`], notes: `Sealed-ampoule synthesis only.` },
]

// Canonical key independent of element ordering, parentheses and formula-unit multiples, e.g.
// LiOH, HLiO, Li(OH) → HLiO and Li2O2 → LiO
export const precursor_key = (formula: string): string =>
  get_alphabetical_formula(get_reduced_formula(parse_composition(formula)), {
    plain_text: true,
    delim: ``,
  })

const library_by_key = new Map(
  PRECURSOR_LIBRARY.map((info) => [precursor_key(info.formula), info]),
)

// Library entry for a formula in any element ordering, or null when it is not a common precursor
export const lookup_precursor_info = (formula: string): PrecursorInfo | null => {
  try {
    return library_by_key.get(precursor_key(formula)) ?? null
  } catch {
    return null
  }
}
