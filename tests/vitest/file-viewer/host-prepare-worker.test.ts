import { host_prepare_transfers, type HostPrepareInput } from '#lib/file-viewer/host-bridge.js'
import { frame_from_wire, frame_to_wire } from '#lib/file-viewer/host-protocol.js'
import { select_frame_channels } from '#lib/trajectory/frame.js'
import { open_trajectory } from '#lib/trajectory/open.js'
import type { PrepareReply, PrepareRequest } from '#lib/trajectory/prepare-pool.js'
import { FramePreparer } from '#lib/trajectory/prepare.js'
import { expect, test, vi } from 'vite-plus/test'
import { read_binary_test_file } from '../test-fixtures'

const PREPARATION = {
  bonding_strategy: `electroneg_ratio`,
  bonding_options: {},
  channels: { vectors: [`force`], precision: `display` },
} as const

// The worker module serves on import; a stub `self` stands in for its global scope
test(`decodes host replies (or frame 0) in the worker and prepares them`, async () => {
  const scope = Object.assign(new EventTarget(), { postMessage: vi.fn() })
  vi.stubGlobal(`self`, scope)
  vi.resetModules()
  await import(`#lib/file-viewer/host-prepare-worker.js`)
  const run = await open_trajectory(read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`), {
    filename: `relax.traj`,
    index_above_bytes: 0,
  })
  const frame = await run.read_frame(1)
  const preview = await run.read_frame(0)
  if (!(preview.sites instanceof Uint8Array)) throw new TypeError(`Expected numeric sites`)
  const preview_sites = preview.sites.slice()
  // all three vector channels on the wire, as a host may send more than asked for
  const reply = frame_to_wire(frame, `display`, preview_sites)
  expect(reply.sites).toBe(`preview`)
  const expected_frame = select_frame_channels(
    frame_from_wire(structuredClone(reply), preview_sites),
    PREPARATION.channels,
  )
  const inputs: HostPrepareInput[] = [{ reply, preview_sites }, { frame: preview }]
  // every buffer of either input moves to the worker
  expect(host_prepare_transfers(inputs[0])).toHaveLength(2) // xyz and vectors; sites reused
  expect(host_prepare_transfers(inputs[1]).length).toBeGreaterThan(0)
  for (const [idx, input] of inputs.entries()) {
    const request: PrepareRequest<HostPrepareInput> = {
      id: idx,
      input: structuredClone(input),
      preparation: PREPARATION,
    }
    scope.dispatchEvent(new MessageEvent(`message`, { data: request }))
  }
  const [[decoded], [local]] = scope.postMessage.mock.calls as [PrepareReply][]
  if (`error` in decoded || `error` in local) throw new Error(`worker failed`)
  const expected = new FramePreparer().prepare(expected_frame, PREPARATION)
  expect(decoded.display.frame.vector_keys).toEqual([`force`])
  expect(decoded.display.frame.approximate).toBe(true)
  expect(decoded.display.frame.coordinates).toEqual(expected.frame.coordinates)
  expect(decoded.display.bonds).toEqual(expected.bonds)
  expect(local.display.frame.vector_keys).toEqual([`force`])
  // a reply that reuses preview sites without them fails that job only
  scope.dispatchEvent(
    new MessageEvent(`message`, {
      data: { id: 9, input: { reply }, preparation: PREPARATION },
    }),
  )
  expect(scope.postMessage).toHaveBeenLastCalledWith({
    id: 9,
    error: `Malformed host frame: it reuses preview sites, but there is no preview`,
  })
  run.dispose()
  vi.unstubAllGlobals()
})
