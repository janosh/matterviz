// Web Worker branch of analyze_structure_symmetry (see structure-id/worker-path.test.ts for why
// a stub Worker is installed before the import): moyo's analyze_cell held the main thread for
// 16-19 s on a 47k-site supercell, so it must run in the worker whenever one can be created.
import type * as Analyze from '#lib/symmetry/analyze.js'
import type { MoyoWorkerOptions } from '#lib/symmetry/analyze.js'
import type * as MoyoWasm from '@spglib/moyo-wasm'
import type { MoyoCell } from '@spglib/moyo-wasm'
import { analyze_cell } from '@spglib/moyo-wasm'
import { wyckoff_positions_from_moyo } from '#lib/symmetry/wyckoff.js'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { expect_module_worker, install_stub_worker } from '../setup'
import { init_moyo_for_tests, make_rocksalt } from '../test-fixtures'

// The worker's compute is the real moyo build; the module's own import is a spy that must stay
// untouched while the worker path is taken
const { real_analyze_cell } = vi.hoisted(() => ({
  real_analyze_cell: { current: null as null | typeof analyze_cell },
}))
vi.mock(`@spglib/moyo-wasm`, async (import_original) => {
  const actual = await import_original<typeof MoyoWasm>()
  real_analyze_cell.current = actual.analyze_cell
  return { ...actual, analyze_cell: vi.fn(actual.analyze_cell) }
})

const stub = install_stub_worker<{
  id: number
  input: { cell: MoyoCell }
  options: MoyoWorkerOptions
}>(({ input, options }) =>
  real_analyze_cell.current?.(JSON.stringify(input.cell), options.symprec, options.setting),
)
let analyze: typeof Analyze

beforeAll(async () => {
  analyze = await import(`#lib/symmetry/analyze.js`)
  await init_moyo_for_tests()
})
afterEach(() => {
  stub.reset()
  vi.mocked(analyze_cell).mockClear()
})

test(`analyzes in the moyo worker, never on the main thread, with the main-thread result`, async () => {
  const crystal = make_rocksalt()
  // a viewer's structure is $state, whose proxies cannot be structured-cloned
  for (const site of crystal.sites) site.abc = new Proxy(site.abc, {})
  const sym_data = await analyze.analyze_structure_symmetry(crystal, { symprec: 1e-4 })
  expect_module_worker(stub.instances, `src/lib/symmetry/moyo-worker.ts`)
  expect(analyze_cell).not.toHaveBeenCalled()
  const [{ message }] = stub.posted
  expect(message.options).toEqual({ symprec: 1e-4, setting: `Standard` })
  expect(message.input.cell.positions).toEqual(crystal.sites.map((site) => site.abc))
  const { cell } = message.input
  const main_thread = real_analyze_cell.current?.(JSON.stringify(cell), 1e-4, `Standard`)
  expect([sym_data.number, sym_data.operations]).toEqual([225, main_thread?.operations])
  // the Wyckoff legend reads its rows off the worker's dataset
  expect(sym_data.wyckoffs).toEqual(main_thread?.wyckoffs)
  const rows = wyckoff_positions_from_moyo(sym_data)
  expect(rows.map(({ wyckoff, elem }) => `${elem} ${wyckoff}`)).toEqual([`Na 4a`, `Cl 4b`])
})

// A superseded viewer run must not queue another multi-second analysis behind the live one
test(`an aborted analysis rejects without posting to the worker`, async () => {
  const controller = new AbortController()
  const pending = analyze.analyze_structure_symmetry(make_rocksalt(), {}, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow(`aborted`)
  expect(stub.posted).toEqual([])
})

// Last in this file: a registered source cannot be unregistered.
// The worker loads the WASM from its default location, so a host serving it elsewhere runs here:
// the VS Code webview (its workers fetch nothing), bytes, or a relative URL the worker would
// resolve against itself instead of the page
test.each([
  [`a registered URL`, async () => analyze.set_moyo_wasm_source(`./assets/moyo.wasm`)],
  [`registered bytes`, async () => analyze.set_moyo_wasm_source(new Uint8Array([0]))],
  [
    `a source passed to ensure_moyo_wasm_ready`,
    () => analyze.ensure_moyo_wasm_ready(`/m.wasm`),
  ],
])(`%s keeps the analysis on the main thread`, async (_label, register) => {
  await register()
  await analyze.analyze_structure_symmetry(make_rocksalt(), { symprec: 1e-4 })
  expect(stub.posted).toEqual([])
  expect(analyze_cell).toHaveBeenCalledOnce()
})
