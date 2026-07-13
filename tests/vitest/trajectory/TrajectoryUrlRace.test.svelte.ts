import type { TrajHandlerData } from '$lib/trajectory'
import type * as TrajectoryParse from '$lib/trajectory/parse'
import { mount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Deferred = { promise: Promise<void>; resolve: () => void }

const parse_controls = vi.hoisted(() => {
  const deferred = (): Deferred => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => (resolve = done))
    return { promise, resolve }
  }
  return {
    deferred,
    gates: new Map<string, Deferred>(),
    starts: new Map<string, Deferred>(),
    reset() {
      this.gates.clear()
      this.starts.clear()
    },
  }
})

vi.mock(`$lib/trajectory/parse`, async (import_original) => {
  const original = await import_original<typeof TrajectoryParse>()
  return {
    ...original,
    parse_trajectory_async: vi.fn(
      async (...args: Parameters<typeof original.parse_trajectory_async>) => {
        const filename = args[1]
        parse_controls.starts.get(filename)?.resolve()
        await parse_controls.gates.get(filename)?.promise
        return original.parse_trajectory_async(...args)
      },
    ),
  }
})

const { default: Trajectory } = await import('$lib/trajectory/Trajectory.svelte')

const xyz = (element: string) => `1\n${element} frame\n${element} 0 0 0\n`
const loaded_element = (data: TrajHandlerData) =>
  data.trajectory?.frames[0]?.structure.sites[0]?.species[0]?.element ?? ``

afterEach(() => {
  vi.unstubAllGlobals()
  parse_controls.reset()
})

describe(`Trajectory URL parse races`, () => {
  test(`ignores stale trajectory URL after parsing has started`, async () => {
    const a_parse_started = parse_controls.deferred()
    const release_a_parse = parse_controls.deferred()
    parse_controls.starts.set(`a.xyz`, a_parse_started)
    parse_controls.gates.set(`a.xyz`, release_a_parse)
    const fetch_mock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === `string` ? url : url instanceof URL ? url.href : url.url
      return new Response(xyz(href.includes(`b.xyz`) ? `He` : `H`))
    })
    vi.stubGlobal(`fetch`, fetch_mock)

    const on_file_load = vi.fn()
    const props = $state({
      data_url: `/a.xyz`,
      display_mode: `structure` as const,
      show_controls: `never` as const,
      on_file_load,
    })
    mount(Trajectory, { target: document.body, props })
    await a_parse_started.promise

    props.data_url = `/b.xyz`
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
    expect(loaded_element(on_file_load.mock.calls[0][0])).toBe(`He`)

    release_a_parse.resolve()
    let stale_load_finished = false
    try {
      await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2), {
        timeout: 250,
      })
      stale_load_finished = true
    } catch {
      stale_load_finished = false
    }
    expect(stale_load_finished).toBe(false)
    expect(on_file_load).toHaveBeenCalledTimes(1)
  })
})
