export const DEFAULT_OPTIMADE_ID = `mp-1`

const DEFAULT_OPTIMADE_ROUTE = `/optimade`
const PARSE_BASE_URL = `https://matterviz.local`

export function optimade_permalink(
  id: string,
  route: string = DEFAULT_OPTIMADE_ROUTE,
): string {
  const params = new URLSearchParams({ id: id.trim() || DEFAULT_OPTIMADE_ID })
  return `${route}?${params}`
}

export function parse_optimade_id(url: string | URL): string {
  try {
    const parsed = url instanceof URL ? url : new URL(url, PARSE_BASE_URL)
    return parsed.searchParams.get(`id`)?.trim() || DEFAULT_OPTIMADE_ID
  } catch {
    return DEFAULT_OPTIMADE_ID
  }
}
