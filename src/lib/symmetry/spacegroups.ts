// Space group to crystal system mappings and utilities

export type CrystalSystem =
  | `triclinic`
  | `monoclinic`
  | `orthorhombic`
  | `tetragonal`
  | `trigonal`
  | `hexagonal`
  | `cubic`

// Crystal system ranges: [min, max] space group numbers (inclusive)
export const CRYSTAL_SYSTEM_RANGES: Record<CrystalSystem, [number, number]> = {
  triclinic: [1, 2],
  monoclinic: [3, 15],
  orthorhombic: [16, 74],
  tetragonal: [75, 142],
  trigonal: [143, 167],
  hexagonal: [168, 194],
  cubic: [195, 230],
}

// Colors matching pymatviz's spacegroup_bar
export const CRYSTAL_SYSTEM_COLORS: Record<CrystalSystem, string> = {
  triclinic: `red`,
  monoclinic: `teal`,
  orthorhombic: `blue`,
  tetragonal: `green`,
  trigonal: `orange`,
  hexagonal: `purple`,
  cubic: `darkred`,
}

// Ordered list of crystal systems (by space group number range)
export const CRYSTAL_SYSTEMS: CrystalSystem[] = [
  `triclinic`,
  `monoclinic`,
  `orthorhombic`,
  `tetragonal`,
  `trigonal`,
  `hexagonal`,
  `cubic`,
]

// Convert space group number to crystal system
export function spacegroup_number_to_crystal_system(
  spacegroup: number,
): CrystalSystem | null {
  for (const [system, [min, max]] of Object.entries(CRYSTAL_SYSTEM_RANGES)) {
    if (spacegroup >= min && spacegroup <= max) {
      return system as CrystalSystem
    }
  }
  return null
}

// Basic mapping of common Hermann-Mauguin symbols to space group numbers
// This is a subset - full mapping would be much larger
export const SPACEGROUP_SYMBOL_TO_NUMBER: Record<string, number> = {
  // Triclinic
  'P1': 1,
  'P-1': 2,
  // Monoclinic
  'P2': 3,
  'P21': 4,
  'C2': 5,
  'Pm': 6,
  'Pc': 7,
  'Cm': 8,
  'Cc': 9,
  'P2/m': 10,
  'P21/m': 11,
  'C2/m': 12,
  'P2/c': 13,
  'P21/c': 14,
  'C2/c': 15,
  // Orthorhombic (common ones)
  'P222': 16,
  'P2221': 17,
  'P21212': 18,
  'P212121': 19,
  'C2221': 20,
  'C222': 21,
  'F222': 22,
  'I222': 23,
  'I212121': 24,
  'Pmm2': 25,
  'Pmc21': 26,
  'Pcc2': 27,
  'Pma2': 28,
  'Pca21': 29,
  'Pnc2': 30,
  'Pmn21': 31,
  'Pba2': 32,
  'Pna21': 33,
  'Pnn2': 34,
  'Cmm2': 35,
  'Cmc21': 36,
  'Ccc2': 37,
  'Amm2': 38,
  'Aem2': 39,
  'Ama2': 40,
  'Aea2': 41,
  'Fmm2': 42,
  'Fdd2': 43,
  'Imm2': 44,
  'Iba2': 45,
  'Ima2': 46,
  'Pmmm': 47,
  'Pnnn': 48,
  'Pccm': 49,
  'Pban': 50,
  'Pmma': 51,
  'Pnna': 52,
  'Pmna': 53,
  'Pcca': 54,
  'Pbam': 55,
  'Pccn': 56,
  'Pbcm': 57,
  'Pnnm': 58,
  'Pmmn': 59,
  'Pbcn': 60,
  'Pbca': 61,
  'Pnma': 62,
  'Cmcm': 63,
  'Cmce': 64,
  'Cmmm': 65,
  'Cccm': 66,
  'Cmme': 67,
  'Ccce': 68,
  'Fmmm': 69,
  'Fddd': 70,
  'Immm': 71,
  'Ibam': 72,
  'Ibca': 73,
  'Imma': 74,
  // Tetragonal (common ones)
  'P4': 75,
  'P41': 76,
  'P42': 77,
  'P43': 78,
  'I4': 79,
  'I41': 80,
  'P-4': 81,
  'I-4': 82,
  'P4/m': 83,
  'P42/m': 84,
  'P4/n': 85,
  'P42/n': 86,
  'I4/m': 87,
  'I41/a': 88,
  // Trigonal (common ones)
  'P3': 143,
  'P31': 144,
  'P32': 145,
  'R3': 146,
  'P-3': 147,
  'R-3': 148,
  // Hexagonal (common ones)
  'P6': 168,
  'P61': 169,
  'P65': 170,
  'P62': 171,
  'P64': 172,
  'P63': 173,
  'P-6': 174,
  'P6/m': 175,
  'P63/m': 176,
  // Cubic (common ones)
  'P23': 195,
  'F23': 196,
  'I23': 197,
  'P213': 198,
  'I213': 199,
  'Pm-3': 200,
  'Pn-3': 201,
  'Fm-3': 202,
  'Fd-3': 203,
  'Im-3': 204,
  'Pa-3': 205,
  'Ia-3': 206,
  'P432': 207,
  'P4232': 208,
  'F432': 209,
  'F4132': 210,
  'I432': 211,
  'P4332': 212,
  'P4132': 213,
  'I4132': 214,
  'P-43m': 215,
  'F-43m': 216,
  'I-43m': 217,
  'P-43n': 218,
  'F-43c': 219,
  'I-43d': 220,
  'Pm-3m': 221,
  'Pn-3n': 222,
  'Pm-3n': 223,
  'Pn-3m': 224,
  'Fm-3m': 225,
  'Fm-3c': 226,
  'Fd-3m': 227,
  'Fd-3c': 228,
  'Im-3m': 229,
  'Ia-3d': 230,
}

// Convert space group (number or symbol) to crystal system
export function spacegroup_to_crystal_system(
  spacegroup: number | string,
): CrystalSystem | null {
  if (typeof spacegroup === `number`) {
    return spacegroup_number_to_crystal_system(spacegroup)
  }

  // Try to parse as symbol
  const number = SPACEGROUP_SYMBOL_TO_NUMBER[spacegroup]
  if (number !== undefined) {
    return spacegroup_number_to_crystal_system(number)
  }

  // Try to parse string as number
  const parsed = parseInt(spacegroup, 10)
  if (!isNaN(parsed)) {
    return spacegroup_number_to_crystal_system(parsed)
  }

  return null
}

// Convert space group symbol to number
export function spacegroup_symbol_to_number(symbol: string): number | null {
  const number = SPACEGROUP_SYMBOL_TO_NUMBER[symbol]
  if (number !== undefined) return number

  // Try to parse as number
  const parsed = parseInt(symbol, 10)
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 230) return parsed

  return null
}

// Normalize space group input to number
export function normalize_spacegroup(spacegroup: number | string): number | null {
  if (typeof spacegroup === `number`) {
    return spacegroup >= 1 && spacegroup <= 230 ? spacegroup : null
  }
  return spacegroup_symbol_to_number(spacegroup)
}
