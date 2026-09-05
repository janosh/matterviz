import type { SortDir, TableSort } from '$lib/table'
import { parse_num_token } from '$lib/utils'
import {
  valid_query_param,
  type UrlParamEntry,
  type ValidQueryValues,
} from 'svelte-widgets/url-params'

export type WeightsConfig = Record<string, { weight: number }>

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

export const sort_from_query = (
  params: URLSearchParams,
  default_sort: TableSort,
  valid_columns?: ValidQueryValues<string>,
): TableSort => ({
  column: valid_columns
    ? valid_query_param(params, `sort`, default_sort.column, valid_columns)
    : valid_query_param(params, `sort`, default_sort.column),
  dir: valid_query_param(params, `dir`, default_sort.dir, sort_dirs),
})

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
  const values = param?.split(`,`).map(parse_num_token) ?? []
  const total = values.reduce((sum, value) => sum + value, 0)
  if (
    values.length === keys.length &&
    values.every((value) => Number.isFinite(value) && value >= 0) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    for (const [idx, key] of keys.entries()) config[key].weight = values[idx] / total
    return
  }
  for (const key of keys) config[key].weight = default_config[key].weight
}
