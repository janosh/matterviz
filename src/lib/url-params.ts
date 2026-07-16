import type { SortDir, TableSort } from '$lib/table'
import { parse_num_token } from '$lib/utils'

export type { SortDir, TableSort } from '$lib/table'

// To preserve an intentional `key=` value, pass a non-empty default as the third item.
export type UrlParamEntry = [key: string, value: string, default_value?: string]
export type ValidQueryValues<Value extends string> =
  | ReadonlySet<Value>
  | Record<string, unknown>
export type WeightsConfig = Record<string, { weight: number }>
export type UrlLocation = Pick<URL, `pathname` | `search` | `hash`>

const sort_dirs = new Set<SortDir>([`asc`, `desc`])
const round_weight = (weight: number): number => Math.round(weight * 1000) / 1000
const canonical_weight_keys = (
  config: WeightsConfig,
  default_config: WeightsConfig,
): string[] => {
  const keys = Object.keys(default_config)
  if (
    Object.keys(config).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(config, key))
  )
    throw new Error(`Weight config keys must exactly match defaults: ${keys.join(`, `)}`)
  return keys
}

// Boolean flags omit their default and encode the non-default as 0 or 1.
export const bool_from_param = (
  params: URLSearchParams,
  key: string,
  fallback = false,
): boolean => (fallback ? params.get(key) !== `0` : params.get(key) === `1`)

export const bool_url_entry = (
  key: string,
  value: boolean,
  fallback = false,
): UrlParamEntry => [key, value === fallback ? `` : value ? `1` : `0`]

export function valid_query_param<Value extends string>(
  params: URLSearchParams,
  key: string,
  fallback: Value,
  valid_values: ValidQueryValues<Value>,
): Value {
  const value = params.get(key)
  if (!value) return fallback
  const is_valid =
    valid_values instanceof Set ? valid_values.has(value) : Object.hasOwn(valid_values, value)
  return is_valid ? (value as Value) : fallback
}

export const sort_from_query = (
  params: URLSearchParams,
  default_sort: TableSort,
  valid_columns?: ValidQueryValues<string>,
): TableSort => {
  const column = params.get(`sort`)
  return {
    column: valid_columns
      ? valid_query_param(params, `sort`, default_sort.column, valid_columns)
      : column !== null && column !== ``
        ? column
        : default_sort.column,
    dir: valid_query_param(params, `dir`, default_sort.dir, sort_dirs),
  }
}

export const sort_url_entries = (
  sort: TableSort,
  default_sort: TableSort,
): UrlParamEntry[] => [
  [`sort`, sort.column, default_sort.column],
  [`dir`, sort.dir, default_sort.dir],
]

// Empty string denotes the default configuration so URL sync omits the parameter.
// Keys define the serialized value order and must match between both configurations.
export function weights_to_param(
  config: WeightsConfig,
  default_config: WeightsConfig,
): string {
  const keys = canonical_weight_keys(config, default_config)
  return keys.every(
    (key) => round_weight(config[key].weight) === round_weight(default_config[key].weight),
  )
    ? ``
    : keys.map((key) => round_weight(config[key].weight)).join(`,`)
}

// Mutate config with normalized weights. Missing or malformed input resets shared
// configuration state to defaults instead of retaining stale values from an earlier URL.
export function apply_weights_param(
  param: string | null,
  config: WeightsConfig,
  default_config: WeightsConfig,
): void {
  const keys = canonical_weight_keys(config, default_config)
  if (param) {
    const values = param.split(`,`).map(parse_num_token)
    const total = values.reduce((sum, value) => sum + value, 0)
    if (
      values.length === keys.length &&
      values.every((value) => Number.isFinite(value) && value >= 0) &&
      total > 0
    ) {
      for (const [idx, key] of keys.entries()) config[key].weight = values[idx] / total
      return
    }
  }
  for (const key of keys) config[key].weight = default_config[key].weight
}

// Return a relative URL with entries merged into its existing query parameters.
export function url_with_params(entries: UrlParamEntry[], current_url: UrlLocation): string {
  const params = new URLSearchParams(current_url.search)
  for (const [key, value, default_value = ``] of entries) {
    if (value === default_value) params.delete(key)
    else params.set(key, value)
  }
  // Commas are legal RFC 3986 sub-delimiters and aid readability in list values.
  const query = params.toString().replaceAll(`%2C`, `,`)
  return `${current_url.pathname}${query ? `?${query}` : ``}${current_url.hash}`
}

// Write only when entries produce a different relative URL.
export function sync_url_params(
  entries: UrlParamEntry[],
  current_url: UrlLocation,
  write_url: (url: string) => void,
): void {
  const next_url = url_with_params(entries, current_url)
  const current_path = url_with_params([], current_url)
  if (next_url !== current_path) write_url(next_url)
}
