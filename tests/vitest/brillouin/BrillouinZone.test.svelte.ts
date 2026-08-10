import BrillouinZone from '$lib/brillouin/BrillouinZone.svelte'
import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

let mounted_component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
})

const poscar = `cubic\n1.0\n3 0 0\n0 3 0\n0 0 3\nSi\n1\nDirect\n0 0 0\n`

// Without mark_owned, the first parsed structure looks caller-supplied and prevents the
// loader from fetching a second URL.
test(`loads a second data_url after the first has produced a structure`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))

  const on_file_load = vi.fn()
  const props = $state({ data_url: `http://x/a.poscar`, on_file_load })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
  expect(on_file_load.mock.calls.map(([payload]) => payload.filename)).toEqual([
    `a.poscar`,
    `b.poscar`,
  ])
})

test(`ignores a stale async on_file_drop failure`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))
  const first_drop = Promise.withResolvers<undefined>()
  const second_drop = Promise.withResolvers<undefined>()
  const completed_filenames: string[] = []
  const on_file_drop = vi.fn(async (_content: string | ArrayBuffer, filename: string) => {
    await (filename === `a.poscar` ? first_drop.promise : second_drop.promise)
    completed_filenames.push(filename)
  })
  const on_error = vi.fn()
  const props = $state({
    data_url: `http://x/a.poscar`,
    on_file_drop,
    on_error,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(1))

  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(2))
  first_drop.reject(new Error(`stale parse failure`))
  second_drop.resolve(undefined)
  await vi.waitFor(() => {
    expect(completed_filenames).toEqual([`b.poscar`])
    expect(on_error).not.toHaveBeenCalled()
  })
})
