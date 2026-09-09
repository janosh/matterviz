import Viewer from '../../../src/site/OptimadeStructureViewer.svelte'
import {
  detect_provider_from_id,
  encode_structure_id,
  fetch_optimade_providers,
  fetch_optimade_structure,
  fetch_suggested_structures,
} from '$lib/api/optimade'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { MOCK_PROVIDERS, MOCK_STRUCTURES } from '../../fixtures/optimade-mocks'

vi.mock(`$lib/structure/Structure.svelte`, async () => ({
  default: (await import(`$lib/EmptyState.svelte`)).default,
}))

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
    const decoded = decodeURIComponent(encoded)
    expect(decoded).toBe(id)
  })

  test(`should encode dots as %2E and slashes as %2F`, () => {
    expect(encode_structure_id(`odbx.9/1.2`)).toBe(`odbx%2E9%2F1%2E2`)
  })

  test.each([
    [`odbx-9.1`, `odbx`],
    [`mp-123`, `mp`],
    [`cod-456`, `cod`],
    [`odbx-9.1/2`, `odbx`],
    [`mp-100%`, `mp`],
    [`mp-%2F`, `mp`], // The literal ID must not be decoded again
    [`MP-149`, `mp`],
  ])(`should detect provider from slug %s (expected: %s)`, (slug, expected_provider) => {
    const provider = detect_provider_from_id(slug, MOCK_PROVIDERS)
    expect(provider).toBe(expected_provider)
  })

  test.each([
    [`unknown-123`, `unknown provider`],
    [`123`, `slug without provider prefix`],
  ])(`should return empty string for %s`, (slug) => {
    const provider = detect_provider_from_id(slug, MOCK_PROVIDERS)
    expect(provider).toBe(``)
  })
})

test.each([true, false])(
  `clearing the input discards a structure (settled=%s)`,
  async (settled) => {
    const api = await import(`$lib/api/optimade`)
    const pending = Promise.withResolvers<(typeof MOCK_STRUCTURES)[string]>()
    vi.spyOn(api, `fetch_optimade_providers`).mockResolvedValue(MOCK_PROVIDERS)
    vi.spyOn(api, `fetch_suggested_structures`).mockResolvedValue([])
    const fetch_structure = vi
      .spyOn(api, `fetch_optimade_structure`)
      .mockReturnValue(pending.promise)
    const component = mount(Viewer, { target: document.body, props: { structure_id: `mp-1` } })
    try {
      await vi.waitFor(() => expect(fetch_structure).toHaveBeenCalled())
      if (settled) {
        pending.resolve(MOCK_STRUCTURES[`mp-1`])
        await vi.waitFor(() =>
          expect(document.querySelector(`.structure-column h2`)).not.toBeNull(),
        )
      }
      const input = document.querySelector<HTMLInputElement>(`input.structure-input`)
      if (!input) throw new Error(`Structure input missing`)
      input.value = ``
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      pending.resolve(MOCK_STRUCTURES[`mp-1`])
      await tick()
      expect(document.querySelector(`.structure-column h2`)).toBeNull()
      expect(document.querySelector(`.structure-column`)?.textContent).not.toContain(`Loading`)
    } finally {
      await unmount(component)
      vi.restoreAllMocks()
    }
  },
)

describe(`OPTIMADE requests`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test(`unknown provider rejects suggested structures without fetching`, async () => {
    const mock_fetch = vi.fn()
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_suggested_structures(`unknown`, MOCK_PROVIDERS)).rejects.toThrow(
      `Unknown provider: unknown`,
    )
    expect(mock_fetch).not.toHaveBeenCalled()
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
      const mock_fetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => ({ data: url.endsWith(`/links`) ? [] : payload }),
      }))
      vi.stubGlobal(`fetch`, mock_fetch)
      await expect(fetch_optimade_structure(`mp-0`, `mp`, MOCK_PROVIDERS)).rejects.toThrow(
        `Structure mp-0 not found`,
      )
    },
  )

  test(`network failures surface without contacting third-party proxies`, async () => {
    const error = new TypeError(`Failed to fetch`)
    const mock_fetch = vi.fn().mockRejectedValue(error)
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_optimade_providers()).rejects.toBe(error)
    const calls = mock_fetch.mock.calls as [string, RequestInit][]
    const target = `https://providers.optimade.org/v1/links`
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(target)
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(calls[0][1].headers).toEqual({ Accept: `application/vnd.api+json` })
  })

  test.each([``, `/`, `/v1`, `/v1/`, `/v1.2`, `/v1.2.0/`])(
    `normalizes provider URLs with suffix %s and caches successful discovery`,
    async (suffix) => {
      const base = `https://example.org/${encodeURIComponent(suffix) || `bare`}`
      const version = suffix.includes(`v1`) ? suffix.replace(/\/$/, ``) : `/v1`
      const api_base = `${base}${version}`
      const providers = [
        { ...MOCK_PROVIDERS[0], attributes: { name: `Test`, base_url: `${base}${suffix}` } },
      ]
      const mock_fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
      vi.stubGlobal(`fetch`, mock_fetch)
      await expect(fetch_suggested_structures(`mp`, providers)).resolves.toEqual([])
      await expect(fetch_suggested_structures(`mp`, providers)).resolves.toEqual([])
      expect(mock_fetch.mock.calls.map(([url]) => url)).toEqual([
        `${api_base}/links`,
        `${api_base}/structures?page_limit=12&page_offset=0`,
        `${api_base}/structures?page_limit=12&page_offset=0`,
      ])
    },
  )

  test(`discovery failures reject and can be retried; child URLs retain their version`, async () => {
    const providers = [
      {
        ...MOCK_PROVIDERS[0],
        attributes: { name: `Index`, base_url: `https://index.example.org` },
      },
    ]
    const mock_fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error(`offline`))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              type: `links`,
              attributes: { link_type: `child`, base_url: `https://child.example.org/v1.2/` },
            },
          ],
        }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    vi.stubGlobal(`fetch`, mock_fetch)
    await expect(fetch_suggested_structures(`mp`, providers)).rejects.toThrow(`offline`)
    expect(mock_fetch).toHaveBeenCalledTimes(1)
    await expect(fetch_suggested_structures(`mp`, providers)).resolves.toEqual([])
    expect(mock_fetch.mock.calls.map(([url]) => url)).toEqual([
      `https://index.example.org/v1/links`,
      `https://index.example.org/v1/links`,
      `https://child.example.org/v1.2/structures?page_limit=12&page_offset=0`,
    ])
  })

  test.each([`providers`, `discovery`] as const)(
    `coalesces concurrent %s requests, retries failures and starts TTL on completion`,
    async (kind) => {
      // Isolate the cache so this test exercises both misses and expiry explicitly.
      vi.resetModules()
      const api = await import(`$lib/api/optimade`)
      let now = 0
      vi.spyOn(Date, `now`).mockImplementation(() => now)
      const pending = Promise.withResolvers<Response>()
      const mock_fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error(`offline`))
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
      vi.stubGlobal(`fetch`, mock_fetch)
      const request =
        kind === `providers`
          ? () => api.fetch_optimade_providers()
          : () => api.fetch_suggested_structures(`mp`, MOCK_PROVIDERS)
      const failed = await Promise.allSettled([request(), request()])
      expect(failed.every((result) => result.status === `rejected`)).toBe(true)
      expect(mock_fetch).toHaveBeenCalledTimes(1)
      const first = request()
      now = 6 * 60 * 1000 // A pending request does not expire while waiting for its response.
      const second = request()
      expect(mock_fetch).toHaveBeenCalledTimes(2)
      pending.resolve(new Response(JSON.stringify({ data: [] })))
      await Promise.all([first, second])
      const links_count = () =>
        mock_fetch.mock.calls.filter(([url]) => String(url).endsWith(`/links`)).length
      expect(links_count()).toBe(2)
      now += 4 * 60 * 1000
      await request()
      expect(links_count()).toBe(2)
      now += 60 * 1000
      await Promise.all([request(), request()])
      expect(links_count()).toBe(3)
    },
  )

  test.each([null, {}, `not a list`])(
    `rejects malformed links data %j without caching it`,
    async (data) => {
      const base_url = `https://invalid-${typeof data}-${data === null}.example.org`
      const providers = [{ ...MOCK_PROVIDERS[0], attributes: { name: `Test`, base_url } }]
      const mock_fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data }) })
        .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
      vi.stubGlobal(`fetch`, mock_fetch)
      await expect(fetch_suggested_structures(`mp`, providers)).rejects.toThrow(
        `Invalid links response from ${base_url}/v1/links`,
      )
      await expect(fetch_suggested_structures(`mp`, providers)).resolves.toEqual([])
      expect(mock_fetch).toHaveBeenCalledTimes(3)
    },
  )
})
