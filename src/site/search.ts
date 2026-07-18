import { normalize_static_url } from '$site/state.svelte'

export type SiteSearchAction = {
  id: string
  label: string
  description: string
  url: string
  action: (label: string) => void
}

type SearchLoaderParams = { search: string; offset: number; limit: number }

type PagefindResultData = {
  url: string
  plain_excerpt: string
  meta: Record<string, string>
  sub_results: { title: string; url: string; plain_excerpt: string }[]
}

type PagefindResult = { id: string; data: () => Promise<PagefindResultData> }

type PagefindApi = { search: (query: string) => Promise<{ results: PagefindResult[] } | null> }

type SearchLoaderOptions = {
  route_actions: SiteSearchAction[]
  navigate: (url: string) => unknown
  load_pagefind?: () => Promise<PagefindApi>
}

const DEFAULT_PAGEFIND_PATH = `/pagefind/pagefind.js`
const MAX_DESCRIPTION_LENGTH = 240

const load_pagefind_api = async (): Promise<PagefindApi> =>
  (await import(/* @vite-ignore */ DEFAULT_PAGEFIND_PATH)) as PagefindApi

const decode_html_entities = (text: string): string => {
  const textarea = document.createElement(`textarea`)
  textarea.innerHTML = text
  return textarea.value
}

const page_title_from_url = (url: string): string => {
  const path = url.split(`#`)[0].replace(/(?:\/index)?\.html$/, ``)
  if (!path || path === `/`) return `Home`
  const final_segment = path.slice(path.lastIndexOf(`/`) + 1) || path
  return decodeURIComponent(final_segment)
    .replaceAll(`-`, ` `)
    .replaceAll(/\b\w/g, (character) => character.toUpperCase())
}

const paginate_actions = (actions: SiteSearchAction[], offset: number, limit: number) => ({
  options: actions.slice(offset, offset + limit),
  hasMore: offset + limit < actions.length,
})

const pagefind_result_to_action = (
  result_id: string,
  result: PagefindResultData,
  navigate: (url: string) => unknown,
): SiteSearchAction => {
  const section = result.sub_results.find(({ url }) => url.includes(`#`))
  const url = normalize_static_url(section?.url ?? result.url)
  const page_title = result.meta.title || page_title_from_url(result.url)
  const section_title = section?.title.trim()
  const label =
    section_title && section_title !== page_title
      ? `${page_title} › ${section_title}`
      : page_title
  const full_description = decode_html_entities(section?.plain_excerpt ?? result.plain_excerpt)
    .replaceAll(/\s+/g, ` `)
    .trim()
  const description =
    full_description.length > MAX_DESCRIPTION_LENGTH
      ? `${full_description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
      : full_description

  return {
    id: `search:${result_id}:${url}`,
    label,
    description,
    url,
    action: (_label) => void navigate(url),
  }
}

export const create_site_search_loader = ({
  route_actions,
  navigate,
  load_pagefind = load_pagefind_api,
}: SearchLoaderOptions) => {
  let pagefind_api_promise: Promise<PagefindApi> | undefined

  return async ({ search, offset, limit }: SearchLoaderParams) => {
    const query = search.trim()
    if (!query) return paginate_actions(route_actions, offset, limit)

    try {
      const pagefind_api = await (pagefind_api_promise ??= load_pagefind())
      const page_results = (await pagefind_api.search(query))?.results ?? []
      const result_slice = page_results.slice(offset, offset + limit)
      const settled_results = await Promise.allSettled(
        result_slice.map(async (result) =>
          pagefind_result_to_action(result.id, await result.data(), navigate),
        ),
      )
      const options = settled_results.flatMap((result) =>
        result.status === `fulfilled` ? [result.value] : [],
      )

      return { options, hasMore: offset + limit < page_results.length }
    } catch {
      // Pagefind is generated after production builds and is absent in the dev server.
      // Keep route-title navigation available locally instead of failing the palette.
      pagefind_api_promise = undefined
      const normalized_query = query.toLowerCase()
      const matching_routes = route_actions.filter(({ label, description }) =>
        `${label} ${description}`.toLowerCase().includes(normalized_query),
      )
      return paginate_actions(matching_routes, offset, limit)
    }
  }
}
