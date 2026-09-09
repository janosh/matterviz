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
    species?: {
      name: string
      chemical_symbols?: string[]
      concentration?: number[]
      mass?: number[]
      original_name?: string
    }[]
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

const REQUEST_TIMEOUT_MS = 8000

const CACHE_DURATION = 5 * 60 * 1000
// Cache in-flight requests too: suggestions, structure loads and separate viewers often
// discover the same provider at once. Each successful response gets its own TTL.
const links_cache = new Map<
  string,
  { promise: Promise<OptimadeProvider[]>; expires: number }
>()

// Contact only the requested provider. Network/CORS failures stay visible to the caller.
async function fetch_optimade(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: `application/vnd.api+json` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`)
  }
  return response
}

const versioned_base_url = (base_url: string): string => {
  const clean = base_url.replace(/\/+$/, ``)
  return /\/v\d+(?:\.\d+)*$/.test(clean) ? clean : `${clean}/v1`
}

async function resolve_provider_url(provider_base_url: string): Promise<string> {
  const api_base = versioned_base_url(provider_base_url)
  const links = await fetch_links(`${api_base}/links`)
  const child = links.find((link) => link.attributes.link_type === `child`)
  // Index providers point to a child database; database providers already serve structures.
  return child ? versioned_base_url(child.attributes.base_url) : api_base
}

async function fetch_links(url: string): Promise<OptimadeProvider[]> {
  const cached = links_cache.get(url)
  if (cached && Date.now() < cached.expires) return cached.promise
  const promise = fetch_optimade(url).then(async (response) => {
    const body: { data: OptimadeProvider[] } = await response.json()
    if (!Array.isArray(body.data)) throw new Error(`Invalid links response from ${url}`)
    return body.data.filter((link) => link.type === `links` && link.attributes.base_url)
  })
  const entry = { promise, expires: Infinity }
  links_cache.set(url, entry)
  try {
    const links = await promise
    entry.expires = Date.now() + CACHE_DURATION
    return links
  } catch (error) {
    links_cache.delete(url)
    throw error
  }
}

export const fetch_optimade_providers = (): Promise<OptimadeProvider[]> =>
  fetch_links(`https://providers.optimade.org/v1/links`)

// URL encoding for structure IDs with special characters (encodeURIComponent
// leaves dots alone, but a trailing `.` in a path segment is routinely stripped by servers)
export const encode_structure_id = (id: string) =>
  encodeURIComponent(id).replaceAll(`.`, `%2E`)

export function detect_provider_from_id(structure_id: string, providers: OptimadeProvider[]) {
  const prefix = structure_id.split(`-`)[0].toLowerCase()
  return providers.find((provider) => provider.id === prefix)?.id ?? ``
}

// Resolve a provider id to its versioned API base URL (throws on unknown provider)
async function get_api_base(provider: string, providers: OptimadeProvider[]): Promise<string> {
  const provider_config = providers.find((entry) => entry.id === provider)
  if (!provider_config) throw new Error(`Unknown provider: ${provider}`)

  return resolve_provider_url(provider_config.attributes.base_url)
}

export async function fetch_optimade_structure(
  structure_id: string,
  provider: string,
  providers: OptimadeProvider[],
): Promise<OptimadeStructure> {
  const api_base = await get_api_base(provider, providers)
  const encoded_id = encode_structure_id(structure_id)
  const response = await fetch_optimade(`${api_base}/structures/${encoded_id}`)
  const data = await response.json()

  // An empty array is a valid "no such entry" answer, not a hit: `!data.data` misses it
  // (`[]` is truthy) and `data.data[0]` then handed callers `undefined` typed as a
  // structure, so the viewer kept showing the previously loaded one with no error.
  const entry = Array.isArray(data.data) ? data.data[0] : data.data
  if (!entry) throw new Error(`Structure ${structure_id} not found`)
  return entry
}

export async function fetch_suggested_structures(
  provider: string,
  providers: OptimadeProvider[],
  limit: number = 12,
): Promise<OptimadeStructure[]> {
  const api_base = await get_api_base(provider, providers)
  const response = await fetch_optimade(
    `${api_base}/structures?page_limit=${limit}&page_offset=0`,
  )
  const data: { data: OptimadeStructure[] } = await response.json()
  if (!Array.isArray(data.data))
    throw new Error(`Invalid structures response from ${api_base}`)
  return data.data
}
