import {
  DEFAULT_OPTIMADE_ID,
  optimade_permalink,
  parse_optimade_id,
} from '$site/optimade-routing'
import { describe, expect, test } from 'vitest'

describe(`OPTIMADE routing helpers`, () => {
  test(`builds static-route permalinks with the structure ID in the query string`, () => {
    expect(optimade_permalink(`mp-149`)).toBe(`/optimade?id=mp-149`)
    expect(optimade_permalink(`cod-1000000`, `/matterviz/optimade`)).toBe(
      `/matterviz/optimade?id=cod-1000000`,
    )
  })

  test(`encodes structure IDs as query params instead of dynamic path segments`, () => {
    expect(optimade_permalink(`mp/149.1`)).toBe(`/optimade?id=mp%2F149.1`)
  })

  test(`parses the selected structure ID from absolute and relative URLs`, () => {
    expect(parse_optimade_id(`https://example.test/optimade?id=mp-149`)).toBe(`mp-149`)
    expect(parse_optimade_id(`/matterviz/optimade?id=cod-1000000`)).toBe(`cod-1000000`)
  })

  test(`falls back to the default structure ID when the query has no usable id`, () => {
    expect(DEFAULT_OPTIMADE_ID).toBe(`mp-1`)
    expect(parse_optimade_id(`/optimade`)).toBe(DEFAULT_OPTIMADE_ID)
    expect(parse_optimade_id(`/optimade?id=`)).toBe(DEFAULT_OPTIMADE_ID)
  })
})
