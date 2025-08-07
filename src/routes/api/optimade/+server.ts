import { json } from '@sveltejs/kit'

const headers = {
  'Accept': `application/vnd.api+json`,
  'User-Agent': `MatterViz/1.0`,
}

// TypeScript interfaces for OPTIMADE API responses
interface OptimadeLink {
  id: string
  type: string
  attributes?: {
    base_url?: string
    link_type?: string
    [key: string]: unknown
  }
}

interface OptimadeResponse {
  data?: OptimadeLink[]
}

interface ResolvedProvider extends OptimadeLink {
  attributes: {
    base_url: string
    [key: string]: unknown
  }
}

// Get providers with resolved endpoints
async function get_resolved_providers(): Promise<ResolvedProvider[]> {
  try {
    const response = await fetch(`https://providers.optimade.org/v1/links`, { headers })
    const registry_data: OptimadeResponse = await response.json()

    // Resolve index URLs to actual endpoints
    const resolved_providers = await Promise.all(
      (registry_data.data || [])
        .filter((p) => p.attributes?.base_url?.toString().startsWith(`http`))
        .map(async (provider): Promise<ResolvedProvider> => {
          let base_url = provider.attributes?.base_url

          // Try to resolve index URLs
          if (base_url?.includes(`providers.optimade.org/index-metadbs/`)) {
            try {
              const index_response = await fetch(`${base_url}/v1/links`, { headers })
              if (index_response.ok) {
                const index_data: OptimadeResponse = await index_response.json()
                const child_link = index_data.data?.find(
                  (link: OptimadeLink) =>
                    link.attributes?.link_type === `child` && link.attributes?.base_url,
                )
                if (child_link?.attributes?.base_url) {
                  base_url = child_link.attributes.base_url
                  base_url = base_url.endsWith(`/v1`) ? base_url : `${base_url}/v1`
                }
              }
            } catch {
              // Keep original URL if resolution fails
            }
          }

          const attributes = { ...provider.attributes ?? {}, base_url }
          return { ...provider, attributes } as ResolvedProvider
        }),
    )

    return resolved_providers
  } catch {
    return []
  }
}

export const GET = async ({ url }: { url: URL }) => {
  const structure_id = url.searchParams.get(`structure_id`)
  const provider = url.searchParams.get(`provider`)
  const endpoint = url.searchParams.get(`endpoint`) || `structure`
  const limit = url.searchParams.get(`limit`) || `12`

  // Return provider data
  if (endpoint === `providers`) {
    const providers = await get_resolved_providers()
    return json({ data: providers })
  }

  // Return suggested structures for a provider
  if (endpoint === `suggestions`) {
    if (!provider) {
      return json({ error: `provider is required for suggestions` }, { status: 400 })
    }

    try {
      const providers = await get_resolved_providers()
      const provider_info = providers.find(({ id }) => id === provider)

      if (!provider_info?.attributes?.base_url) {
        return json({ error: `Provider ${provider} not found` }, { status: 400 })
      }

      const api_url =
        `${provider_info.attributes.base_url}/structures?page_limit=${limit}&page_offset=0`
      const response = await fetch(api_url, { headers })

      if (!response.ok) {
        return json({ error: `API request failed: ${response.status}` }, {
          status: response.status,
        })
      }

      const data = await response.json()
      return json(data)
    } catch (error) {
      return json({ error: `Failed to fetch suggestions: ${error}` }, { status: 500 })
    }
  }

  if (!structure_id) {
    return json({ error: `structure_id is required` }, { status: 400 })
  }

  try {
    // Find the provider and use its resolved endpoint
    const providers = await get_resolved_providers()
    const provider_info = providers.find(({ id }) => id === provider)

    if (!provider_info?.attributes?.base_url) {
      return json({ error: `Provider ${provider} not found` }, { status: 400 })
    }

    const api_url = `${provider_info.attributes.base_url}/structures/${structure_id}`
    const response = await fetch(api_url, { headers })

    if (!response.ok) {
      return json({ error: `API request failed: ${response.status}` }, {
        status: response.status,
      })
    }

    return json(await response.json())
  } catch {
    return json({ error: `Failed to fetch structure` }, { status: 500 })
  }
}
