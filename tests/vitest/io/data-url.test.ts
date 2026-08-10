import { create_data_url_loader, type DataUrlRequest } from '$lib/io/data-url'
import type * as url_drop from '$lib/io/url-drop'
import { load_from_url } from '$lib/io/url-drop'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/url-drop`, async (import_original) => ({
  ...(await import_original<typeof url_drop>()),
  load_from_url: vi.fn(),
}))

type Deferred = { resolve: () => Promise<void>; reject: (err: Error) => Promise<void> }

// Queue a load_from_url call that only delivers `content` once the test says so, so two
// requests can be put in flight and completed out of order.
function defer_next_load(content = ``): Deferred {
  let deliver: () => Promise<void> = () => Promise.resolve()
  let fail: (err: Error) => Promise<void> = () => Promise.resolve()
  vi.mocked(load_from_url).mockImplementationOnce(
    (url, callback) =>
      new Promise<void>((resolve, reject) => {
        deliver = async () => {
          await callback(content, `f.xyz`, { source_filename: `f.xyz`, source_url: url })
          resolve()
          await Promise.resolve()
        }
        fail = async (err) => {
          reject(err)
          await Promise.resolve()
        }
      }),
  )
  // Wrappers, not the bindings themselves: the executor runs when load_from_url is called,
  // which is after this returns, so returning `deliver` directly would capture the no-op.
  return { resolve: () => deliver(), reject: (err) => fail(err) }
}

// Minimal harness recording what a component would have rendered
function make_harness() {
  const state = { loading: false, error: undefined as string | undefined, value: `` }
  const request = (
    overrides: Partial<DataUrlRequest<string>> & Pick<DataUrlRequest<string>, `url`>,
  ): DataUrlRequest<string> => ({
    set_loading: (value) => {
      state.loading = value
    },
    clear_error: () => {
      state.error = undefined
    },
    on_load: ({ content, mark_owned }) => {
      state.value = content as string
      mark_owned(state.value)
    },
    on_error: (error, filename) => {
      state.error = `${filename}: ${error.message}`
    },
    ...overrides,
  })
  return { state, request }
}

describe(`create_data_url_loader`, () => {
  beforeEach(() => vi.mocked(load_from_url).mockReset())

  test(`ignores a stale response that lands after a newer request`, async () => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()

    const first = defer_next_load(`stale`)
    const teardown = loader.request(request({ url: `https://x.test/a.xyz` }))
    expect(state.loading).toBe(true)

    teardown() // effect re-runs: the a.xyz load is now superseded
    const second = defer_next_load(`fresh`)
    loader.request(request({ url: `https://x.test/b.xyz` }))

    await second.resolve()
    await first.resolve()

    expect(state.value).toBe(`fresh`)
    expect(loader.loaded_url).toBe(`https://x.test/b.xyz`)
    expect(state.loading).toBe(false)
  })

  test(`does not refetch a URL it already loaded`, async () => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()
    const url = `https://x.test/a.xyz`

    const load = defer_next_load(`payload`)
    loader.request(request({ url }))
    await load.resolve()
    expect(state.value).toBe(`payload`)

    // second pass sees the value it produced, so ownership stays with the URL
    loader.request(request({ url, current_value: loader.owned_value }))
    expect(load_from_url).toHaveBeenCalledTimes(1)
  })

  test.each([
    [`caller-supplied value`, { current_value: `caller` }],
    [`skip flag`, { skip: true }],
    [`no url`, { url: undefined }],
  ])(`does not fetch for %s`, (_label, overrides) => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()
    loader.request(request({ url: `https://x.test/a.xyz`, ...overrides }))
    expect(load_from_url).not.toHaveBeenCalled()
    expect(state.loading).toBe(false)
  })

  test(`teardown clears loading and blocks a later completion`, async () => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()

    const load = defer_next_load(`payload`)
    const teardown = loader.request(request({ url: `https://x.test/a.xyz` }))
    expect(state.loading).toBe(true)

    teardown()
    expect(state.loading).toBe(false)
    await load.resolve()
    expect(state.value).toBe(``)
    expect(loader.loaded_url).toBeUndefined()
  })

  test(`claim keeps an edited value attributed to the URL`, async () => {
    const loader = create_data_url_loader<string>()
    const { request } = make_harness()
    const url = `https://x.test/a.xyz`

    const load = defer_next_load(`payload`)
    loader.request(request({ url }))
    await load.resolve()

    loader.claim(`payload edited in place`)
    expect(loader.owned_value).toBe(`payload edited in place`)
    // the edit is still URL-owned, so it does not read as a caller override
    loader.request(request({ url, current_value: `payload edited in place` }))
    expect(load_from_url).toHaveBeenCalledTimes(1)
    expect(loader.loaded_url).toBe(url)
  })

  // The context's central contract: an on_load that awaits must be able to tell it has been
  // superseded, otherwise a slow parse commits over a newer URL's result.
  test(`is_current goes false for an on_load still awaiting when a newer request lands`, async () => {
    const loader = create_data_url_loader<string>()
    const { request } = make_harness()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let seen_current: boolean | undefined

    const first = defer_next_load(`stale`)
    loader.request(
      request({
        url: `https://x.test/a.xyz`,
        on_load: async ({ is_current }) => {
          await gate
          seen_current = is_current()
        },
      }),
    )
    const parked = first.resolve() // on_load is now waiting on the gate
    await Promise.resolve()

    defer_next_load()
    loader.request(request({ url: `https://x.test/b.xyz` }))
    release()
    await parked

    expect(seen_current).toBe(false)
  })

  test(`mark_owned() without a value still marks the URL loaded`, async () => {
    const loader = create_data_url_loader<string>()
    const { request } = make_harness()
    const url = `https://x.test/a.xyz`

    const load = defer_next_load(`payload`)
    loader.request(request({ url, on_load: ({ mark_owned }) => mark_owned() }))
    await load.resolve()

    expect(loader.loaded_url).toBe(url)
    expect(loader.owned_value).toBeUndefined()
    // still not refetched, even though no value was attributed to the URL
    loader.request(request({ url }))
    expect(load_from_url).toHaveBeenCalledTimes(1)
  })

  test(`routes a transport failure to on_error with the URL basename`, async () => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()

    const load = defer_next_load()
    loader.request(request({ url: `https://x.test/dir/a.xyz?token=1` }))
    await load.reject(new Error(`404`))

    expect(state.error).toBe(`a.xyz: 404`)
    expect(state.loading).toBe(false)
    expect(loader.loaded_url).toBeUndefined()
  })

  test(`does not route an on_load rejection through the transport error callback`, async () => {
    const loader = create_data_url_loader<string>()
    const { state, request } = make_harness()
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})

    const load = defer_next_load(`bad payload`)
    loader.request(
      request({
        url: `https://x.test/a.xyz`,
        on_load: () => Promise.reject(new Error(`parse failed`)),
      }),
    )
    await load.resolve()

    expect(state.error).toBeUndefined()
    expect(console_error).toHaveBeenCalledWith(
      `Failed to process loaded URL 'f.xyz':`,
      expect.objectContaining({ message: `parse failed` }),
    )
    expect(state.loading).toBe(false)
    console_error.mockRestore()
  })
})
