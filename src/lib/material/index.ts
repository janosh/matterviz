import type { PymatgenStructure } from '..'

export type BuilderMeta = {
  emmet_version: string
  pymatgen_version: string
  pull_request: number
  database_version: string
  build_date: {
    $date: string
  }
}

export type Symmetry = {
  crystal_system: string
  symbol: string
  number: number
  point_group: string
  symprec: number
  version: string
}

export type XAS = {
  edge: string
  absorbing_element: string
  spectrum_type: string
}

export type SummaryDoc = {
  builder_meta: BuilderMeta
  nsites: number
  elements: string[]
  nelements: number
  composition: { [key: string]: number }
  composition_reduced: { [key: string]: number }
  formula_pretty: string
  formula_anonymous: string
  chemsys: string
  volume: number
  density: number
  density_atomic: number
  symmetry: Symmetry
  property_name: string
  material_id: string
  deprecated: boolean
  deprecation_reasons: null | string
  last_updated: { $date: string }
  origins: unknown[]
  warnings: unknown[]
  structure: PymatgenStructure
  task_ids: string[]
  uncorrected_energy_per_atom: number
  energy_per_atom: number
  formation_energy_per_atom: number
  energy_above_hull: number
  is_stable: boolean
  equilibrium_reaction_energy_per_atom: number
  decomposes_to: null | string
  xas: XAS[]
  grain_boundaries: null | string
  band_gap: number
  cbm: number
  vbm: number
  efermi: number
  is_gap_direct: boolean
  is_metal: boolean
  es_source_calc_id: string
  dos_energy_up: null | number
  dos_energy_down: null | number
  is_magnetic: boolean
  ordering: string
  total_magnetization: number
  total_magnetization_normalized_vol: number
  total_magnetization_normalized_formula_units: number
  num_magnetic_sites: number
  num_unique_magnetic_sites: number
  types_of_magnetic_species: string[]
  k_voigt: number
  k_reuss: number
  k_vrh: number
  g_voigt: number
  g_reuss: number
  g_vrh: number
  universal_anisotropy: number
  homogeneous_poisson: number
  e_total: number
  e_ionic: number
  e_electronic: number
  n: number
  e_ij_max: null | number
  weighted_surface_energy_EV_PER_ANG2: number
  weighted_surface_energy: number
  weighted_work_function: number
  surface_anisotropy: number
  shape_factor: number
  has_reconstructed: boolean
  possible_species: string[]
  has_props: string[]
  theoretical: boolean
  database_IDs: {
    icsd: string[]
  }
}
