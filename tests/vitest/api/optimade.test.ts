import {
  decode_structure_id,
  detect_provider_from_slug,
  encode_structure_id,
  fetch_optimade_providers,
} from '$lib/api/optimade'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MOCK_PROVIDERS } from '../../fixtures/optimade-mocks'

describe(`OPTIMADE API utilities`, () => {
  test.each([
    [`mp-123`],
    [`odbx.9`],
    [`odbx/9`],
    [`odbx-9.1/2`],
    [`odbx 9`],
    [`odbx-9-αβγ`],
    [`odbx-9?param=value`],
    [`odbx-9#fragment`],
    [`odbx.9/1.2`],
    [`odbx.9.1.2.3`],
    [`mp-1226325`],
    [`odbx+9`],
    [`odbx%25`],
    [`me:42`],
    [`user@id`],
    [``],
  ])(`should round-trip encode/decode: %s`, (id) => {
    const encoded = encode_structure_id(id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(id)
  })

  test(`should encode dots as %2E`, () => {
    const id_with_dots = `odbx.9.1.2`
    const encoded = encode_structure_id(id_with_dots)
    // Case-insensitive check for %2e and verify count matches original dots
    const dotCount = id_with_dots.match(/\./g)?.length ?? 0
    const encodedDotCount = encoded.match(/%2e/gi)?.length ?? 0
    expect(encodedDotCount).toBe(dotCount)
    expect(encoded).not.toContain(`.`)
  })

  test(`should encode forward slashes as %2F`, () => {
    const id_with_slashes = `odbx/9/1.2`
    const encoded = encode_structure_id(id_with_slashes)
    expect(encoded).toContain(`%2F`)
    expect(encoded).not.toContain(`/`)
  })

  test(`should handle complex IDs`, () => {
    const complex_id = `odbx.9/1.2-3_4?param=value#fragment`
    const encoded = encode_structure_id(complex_id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(complex_id)
  })

  test(`should extract provider prefix from slug`, () => {
    const cases = [`odbx-9.1`, `mp-1226325`]
    for (const slug of cases) {
      const decoded = decode_structure_id(slug)
      const provider = detect_provider_from_slug(decoded, MOCK_PROVIDERS)
      expect(provider).toBe(slug.split(`-`)[0].toLowerCase())
    }
  })

  test.each([
    [`odbx-9.1`, `odbx`],
    [`mp-123`, `mp`],
    [`cod-456`, `cod`],
    [`odbx-9.1/2`, `odbx`], // Test encoded slug
  ])(`should detect provider from slug %s (expected: %s)`, (slug, expected_provider) => {
    const provider = detect_provider_from_slug(slug, MOCK_PROVIDERS)
    expect(provider).toBe(expected_provider)
  })

  test.each([
    [`unknown-123`, `unknown provider`],
    [`123`, `slug without provider prefix`],
  ])(`should return empty string for %s`, (slug) => {
    const provider = detect_provider_from_slug(slug, MOCK_PROVIDERS)
    expect(provider).toBe(``)
  })
})

describe(`fetch_with_cors_proxy behavior (via fetch_optimade_providers)`, () => {
  afterEach(() => vi.unstubAllGlobals())

  test(`HTTP error status from direct fetch surfaces instead of hammering proxies`, async () => {
    // A 404 is a definitive server answer — surface the real status, not an opaque
    // JSON.parse failure from a caller and not masked by 5 proxy attempts
    const mock_fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: `Not Found` })
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_optimade_providers()).rejects.toThrow(`404`)
    expect(mock_fetch).toHaveBeenCalledTimes(1) // no proxy fallback
  })

  test(`path-suffix proxies receive the raw URL, query proxies the encoded one`, async () => {
    // Network failure (thrown) triggers the proxy fallback chain
    const mock_fetch = vi.fn().mockRejectedValue(new TypeError(`Failed to fetch`))
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_optimade_providers()).rejects.toThrow(`All CORS proxies failed`)
    const urls = mock_fetch.mock.calls.map(([url]) => url as string)
    const target = `https://providers.optimade.org/v1/links`
    expect(urls[0]).toBe(target) // direct attempt first
    // Query-style proxies must percent-encode the target; path-suffix proxies must not
    expect(urls.some((url) => url.endsWith(encodeURIComponent(target)))).toBe(true)
    expect(urls).toContain(`https://cors-anywhere.herokuapp.com/${target}`)
    expect(urls).toContain(`https://thingproxy.freeboard.io/fetch/${target}`)
  })
})
