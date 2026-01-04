import type { OptimadeProvider, OptimadeStructure } from '$lib/api/optimade'

// Complete mock structures for testing with full lattice, species, and positions
export const MOCK_STRUCTURES: Record<string, OptimadeStructure> = {
  'mp-1': {
    id: `mp-1`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `H2O`,
      lattice_vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      species: [{ name: `H`, chemical_symbols: [`H`], concentration: [1] }],
      species_at_sites: [`H`],
      cartesian_site_positions: [[0, 0, 0]],
    },
  },
  'mp-149': {
    id: `mp-149`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `Si`,
      lattice_vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      species: [{ name: `Si`, chemical_symbols: [`Si`], concentration: [1] }],
      species_at_sites: [`Si`],
      cartesian_site_positions: [[0, 0, 0]],
    },
  },
  'mp-1226325': {
    id: `mp-1226325`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `LiFePO4`,
      lattice_vectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
      species: [
        { name: `Li`, chemical_symbols: [`Li`], concentration: [1] },
        { name: `Fe`, chemical_symbols: [`Fe`], concentration: [1] },
        { name: `P`, chemical_symbols: [`P`], concentration: [1] },
        { name: `O`, chemical_symbols: [`O`], concentration: [1] },
      ],
      species_at_sites: [`Li`, `Fe`, `P`, `O`],
      cartesian_site_positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]],
    },
  },
  'cod-456': {
    id: `cod-456`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `Fe2O3`,
      lattice_vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
      species: [
        { name: `Fe`, chemical_symbols: [`Fe`], concentration: [1] },
        { name: `O`, chemical_symbols: [`O`], concentration: [1] },
      ],
      species_at_sites: [`Fe`, `O`],
      cartesian_site_positions: [[0, 0, 0], [1, 1, 1]],
    },
  },
  'odbx-9.1': {
    id: `odbx-9.1`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `Cu`,
      lattice_vectors: [[2.5, 0, 0], [0, 2.5, 0], [0, 0, 2.5]],
      species: [{ name: `Cu`, chemical_symbols: [`Cu`], concentration: [1] }],
      species_at_sites: [`Cu`],
      cartesian_site_positions: [[0, 0, 0]],
    },
  },
}

// Mock providers data shared across tests
export const MOCK_PROVIDERS: OptimadeProvider[] = [
  {
    id: `mp`,
    type: `links`,
    attributes: {
      name: `Materials Project`,
      base_url: `https://optimade.materialsproject.org`,
      description: `The Materials Project`,
      homepage: `https://materialsproject.org`,
    },
  },
  {
    id: `cod`,
    type: `links`,
    attributes: {
      name: `Crystallography Open Database`,
      description: `Crystallography Open Database`,
      base_url: `https://www.crystallography.net/cod/optimade`,
      homepage: `https://www.crystallography.net/cod`,
    },
  },
  {
    id: `oqmd`,
    type: `links`,
    attributes: {
      name: `OQMD`,
      description:
        `The OQMD is a database of DFT calculated thermodynamic and structural properties.`,
      base_url: `https://oqmd.org/optimade`,
      homepage: `https://oqmd.org`,
    },
  },
  {
    id: `odbx`,
    type: `links`,
    attributes: {
      name: `Open Database of Xtals`,
      base_url: `https://odbx.io`,
      description: `Open Database of Xtals`,
    },
  },
]

// Suggested structures for testing
export const MOCK_SUGGESTIONS: OptimadeStructure[] = [
  {
    id: `mp-149`,
    type: `structures`,
    attributes: { chemical_formula_descriptive: `Si` },
  },
  {
    id: `oqmd-1234`,
    type: `structures`,
    attributes: { chemical_formula_descriptive: `Fe` },
  },
]
