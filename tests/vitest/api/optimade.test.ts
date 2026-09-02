import {
  decode_structure_id,
  detect_provider_from_slug,
  encode_structure_id,
  fetch_optimade_providers,
  fetch_optimade_structure,
  fetch_suggested_structures,
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
    [`odbx.9/1.2-3_4?param=value#fragment`],
    [``],
  ])(`should round-trip encode/decode: %s`, (id) => {
    const encoded = encode_structure_id(id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(id)
  })

  test(`should encode dots as %2E and slashes as %2F`, () => {
    expect(encode_structure_id(`odbx.9/1.2`)).toBe(`odbx%2E9%2F1%2E2`)
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
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test(`unknown provider soft-fails suggested structures without fetching`, async () => {
    const mock_fetch = vi.fn()
    vi.stubGlobal(`fetch`, mock_fetch)
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    await expect(fetch_suggested_structures(`unknown`, MOCK_PROVIDERS)).resolves.toEqual([])
    expect(mock_fetch).not.toHaveBeenCalled()
    expect(warn_spy).toHaveBeenCalled()
  })

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

  // A miss can come back as `data: null` or as an empty `data: []`, depending on whether the
  // provider treats the single-entry endpoint as a filtered query. `[]` is truthy, so it used
  // to slip past the not-found check and resolve to `undefined` typed as a structure — the
  // viewer then kept the previously loaded structure on screen with no error.
  test.each([
    [`null data`, null],
    [`an empty data array`, []],
  ])(
    `reports a missing structure when the provider answers with %s`,
    async (_case, payload) => {
      const mock_fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: payload }),
      })
      vi.stubGlobal(`fetch`, mock_fetch)
      await expect(fetch_optimade_structure(`mp-0`, `mp`, MOCK_PROVIDERS)).rejects.toThrow(
        `Structure mp-0 not found`,
      )
    },
  )

  test(`proxies percent-encode the target and carry a timeout`, async () => {
    // Network failure (thrown) triggers the proxy fallback chain
    const mock_fetch = vi.fn().mockRejectedValue(new TypeError(`Failed to fetch`))
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_optimade_providers()).rejects.toThrow(`All CORS proxies failed`)
    const calls = mock_fetch.mock.calls as [string, RequestInit][]
    const target = `https://providers.optimade.org/v1/links`
    expect(calls[0][0]).toBe(target) // direct attempt first
    const proxy_calls = calls.slice(1)
    expect(proxy_calls.length).toBeGreaterThan(0)
    for (const [url, init] of proxy_calls) {
      expect(url.endsWith(encodeURIComponent(target))).toBe(true)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.headers).not.toHaveProperty(`User-Agent`)
    }
  })
})
