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

// CORS proxies for fallback reliability. Query-style proxies need the target URL
// percent-encoded; path-suffix proxies need it verbatim (encoded can never succeed).
const CORS_PROXIES: { prefix: string; encode: boolean }[] = [
  { prefix: `https://corsproxy.io/?`, encode: true },
  { prefix: `https://api.allorigins.win/raw?url=`, encode: true },
  { prefix: `https://cors-anywhere.herokuapp.com/`, encode: false },
  { prefix: `https://thingproxy.freeboard.io/fetch/`, encode: false },
  { prefix: `https://cors.bridged.cc/`, encode: false },
]

let cached_providers: OptimadeProvider[] | null = null
let providers_cache_time = 0
const CACHE_DURATION = 5 * 60 * 1000

// Per-key timestamps: a shared one would let any resolution refresh every entry's TTL
const resolved_provider_urls: Record<string, { url: string; time: number }> = {}
const RESOLVED_URLS_CACHE_DURATION = 10 * 60 * 1000

async function fetch_with_cors_proxy(url: string): Promise<Response> {
  try {
    // An HTTP error status (e.g. 404) is a definitive server answer — return it so
    // callers see the real error; only thrown (network/CORS) errors warrant proxies
    return await fetch(url, {
      headers: { Accept: `application/vnd.api+json`, 'User-Agent': `MatterViz/1.0` },
    })
  } catch {
    // Direct access failed, will try CORS proxies
  }

  for (const { prefix, encode } of CORS_PROXIES) {
    try {
      const response = await fetch(`${prefix}${encode ? encodeURIComponent(url) : url}`, {
        headers: { Accept: `application/vnd.api+json`, 'User-Agent': `MatterViz/1.0` },
      })
      if (response.ok) return response
    } catch {
      // Try next proxy
    }
  }

  throw new Error(`All CORS proxies failed for ${url}`)
}

async function resolve_provider_url(provider_base_url: string): Promise<string> {
  const now = Date.now()
  const cached = resolved_provider_urls[provider_base_url]
  if (cached && now - cached.time < RESOLVED_URLS_CACHE_DURATION) {
    return cached.url
  }

  for (const endpoint of [`/links`, `/v1/links`]) {
    try {
      const response = await fetch_with_cors_proxy(`${provider_base_url}${endpoint}`)
      const data = await response.json()

      const self_link = data.data?.find(
        (link: { type: string; attributes?: { base_url?: string; link_type?: string } }) =>
          link.type === `links` &&
          link.attributes?.base_url &&
          link.attributes.link_type === `child`,
      )

      const url = self_link?.attributes.base_url
      if (url) {
        resolved_provider_urls[provider_base_url] = { url, time: now }
        return url
      }
    } catch {
      // Try next endpoint
    }
  }

  resolved_provider_urls[provider_base_url] = { url: provider_base_url, time: now }
  return provider_base_url
}

export async function fetch_optimade_providers(): Promise<OptimadeProvider[]> {
  const now = Date.now()
  if (cached_providers && now - providers_cache_time < CACHE_DURATION) {
    return cached_providers
  }

  try {
    const response = await fetch_with_cors_proxy(`https://providers.optimade.org/v1/links`)
    const data: { data: OptimadeProvider[] } = await response.json()
    const providers = data.data
      .filter((provider) => provider.attributes.base_url)
      .map((provider) => ({
        id: provider.id,
        type: `links` as const,
        attributes: {
          name: provider.attributes.name,
          description: provider.attributes.description,
          base_url: provider.attributes.base_url,
          homepage: provider.attributes.homepage,
          version: provider.attributes.version,
        },
      }))

    cached_providers = providers
    providers_cache_time = now
    return providers
  } catch (error) {
    console.warn(`Failed to fetch OPTIMADE providers:`, error)
    throw error
  }
}

// URL encode/decode utilities for structure IDs with special characters
export const encode_structure_id = (id: string) =>
  encodeURIComponent(id).replaceAll('.', `%2E`).replaceAll('/', `%2F`)

export const decode_structure_id = (encoded_id: string) => decodeURIComponent(encoded_id)

export function detect_provider_from_slug(slug: string, providers: OptimadeProvider[]) {
  const decoded_slug = decode_structure_id(slug)
  const prefix = decoded_slug.split(`-`)[0].toLowerCase()
  return providers.find((provider) => provider.id === prefix)?.id ?? ``
}

export async function fetch_optimade_structure(
  structure_id: string,
  provider: string,
  providers: OptimadeProvider[],
): Promise<OptimadeStructure | null> {
  const provider_config = providers.find((entry) => entry.id === provider)
  if (!provider_config) throw new Error(`Unknown provider: ${provider}`)

  const base_url = await resolve_provider_url(provider_config.attributes.base_url)
  const api_base = base_url.endsWith(`/v1`) ? base_url : `${base_url}/v1`
  const encoded_id = encode_structure_id(structure_id)
  const response = await fetch_with_cors_proxy(`${api_base}/structures/${encoded_id}`)
  const data = await response.json()

  if (!data.data) throw new Error(`Structure ${structure_id} not found`)
  return Array.isArray(data.data) ? data.data[0] : data.data
}

export async function fetch_suggested_structures(
  provider: string,
  providers: OptimadeProvider[],
  limit: number = 12,
): Promise<OptimadeStructure[]> {
  const provider_config = providers.find((entry) => entry.id === provider)
  if (!provider_config) throw new Error(`Unknown provider: ${provider}`)

  try {
    const base_url = await resolve_provider_url(provider_config.attributes.base_url)
    const api_base = base_url.endsWith(`/v1`) ? base_url : `${base_url}/v1`
    const response = await fetch_with_cors_proxy(
      `${api_base}/structures?page_limit=${limit}&page_offset=0`,
    )
    const data = await response.json()
    return Array.isArray(data.data) ? data.data : []
  } catch (error) {
    console.warn(`Failed to fetch suggested structures for ${provider}:`, error)
    return []
  }
}
