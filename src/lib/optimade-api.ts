// OPTIMADE API utilities for fetching structure data
// Based on OPTIMADE 1.2.0 specification

export interface OptimadeStructure {
  id: string
  type: `structures`
  attributes: {
    chemical_formula_descriptive?: string
    chemical_formula_reduced?: string
    chemical_formula_anonymous?: string
    dimension_types?: number[]
    nperiodic_dimensions?: number
    lattice_vectors?: number[][]
    cartesian_site_positions?: number[][]
    species_at_sites?: string[]
    species?: Array<{
      name: string
      chemical_symbols?: string[]
      concentration?: number[]
      mass?: number[]
      original_name?: string
    }>
    n_sites?: number
    last_modified?: string
    immutable_id?: string
    [key: string]: unknown
  }
  relationships?: Record<string, unknown>
  links?: Record<string, unknown>
}

export interface OptimadeProvider {
  id: string
  type: `links`
  attributes: {
    name: string
    description?: string
    base_url: string
    homepage?: string
    version?: string
    [key: string]: unknown
  }
}

// Fetch providers
export async function fetch_optimade_providers(): Promise<OptimadeProvider[]> {
  try {
    const response = await fetch(`/api/optimade?endpoint=providers`)
    const data = await response.json()
    return data.data || []
  } catch {
    return []
  }
}

// Provider detection from slug prefix using live provider data
export async function detect_provider_from_slug(slug: string): Promise<string> {
  const prefix = slug.split(`-`)[0].toLowerCase()

  // Get live provider list to check if prefix matches any provider
  const providers = await fetch_optimade_providers()
  const found_provider = providers.find((p) => p.id === prefix)

  // Default to mp if no match found
  return found_provider?.id ?? ``
}

// Fetch structure data
export async function fetch_optimade_structure(
  structure_id: string,
  provider: string,
): Promise<OptimadeStructure | null> {
  try {
    const response = await fetch(
      `/api/optimade?structure_id=${
        encodeURIComponent(structure_id)
      }&provider=${provider}`,
    )

    if (!response.ok) {
      console.error(`Failed to fetch OPTIMADE structure: ${response.status}`)
      return null
    }

    const data = await response.json()
    return Array.isArray(data.data) ? data.data[0] : data.data
  } catch (error) {
    console.error(`Error fetching OPTIMADE structure:`, error)
    return null
  }
}

// Fetch suggested structures for a provider
export async function fetch_suggested_structures(
  provider: string,
  limit: number = 12,
): Promise<OptimadeStructure[]> {
  try {
    const response = await fetch(
      `/api/optimade?endpoint=suggestions&provider=${provider}&limit=${limit}`,
    )

    if (!response.ok) {
      console.error(`Failed to fetch suggested structures: ${response.status}`)
      return []
    }

    const data = await response.json()
    return Array.isArray(data.data) ? data.data : []
  } catch (error) {
    console.error(`Error fetching suggested structures:`, error)
    return []
  }
}
