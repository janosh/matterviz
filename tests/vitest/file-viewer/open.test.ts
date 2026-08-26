import * as parse_worker from '$lib/file-viewer/parse-in-worker'
import { MaterialOpenError, open_material } from '$lib/file-viewer/open'
import type { ParseResult } from '$lib/file-viewer/parse'
import { afterEach, expect, test, vi } from 'vitest'
import { gzip_bytes, make_run } from '../setup'

afterEach(() => vi.restoreAllMocks())

test(`URL acquisition decompresses once and records source provenance`, async () => {
  const text = `structure text`
  vi.spyOn(globalThis, `fetch`).mockResolvedValue(new Response(await gzip_bytes(text)))
  const parse = vi
    .spyOn(parse_worker, `parse_in_worker`)
    .mockImplementation(async (data, filename): Promise<ParseResult> => ({
      type: `structure`,
      data: { sites: [] },
      filename,
    }))

  const opened = await open_material(`https://example.com/si.cif.gz`)

  expect(parse).toHaveBeenCalledWith(text, `si.cif`, false, expect.anything())
  expect(opened.provenance).toEqual({
    filename: `si.cif`,
    source_filename: `si.cif.gz`,
    source_url: `https://example.com/si.cif.gz`,
    file_size: new Blob([text]).size,
  })
})

test(`trajectory progress and disposal stay owned by the opened material`, async () => {
  const run = make_run(2)
  const dispose = vi.spyOn(run, `dispose`)
  const progress = vi.fn()
  vi.spyOn(parse_worker, `parse_in_worker`).mockImplementation(
    async (_data, filename, _is_base64, options): Promise<ParseResult> => {
      options?.on_progress?.({ current: 50, total: 100, stage: `Indexing` })
      return { type: `trajectory`, data: run, filename }
    },
  )

  const opened = await open_material(
    { data: new Uint8Array([1, 2, 3]).buffer, filename: `run.traj` },
    { on_progress: progress },
  )

  expect(progress).toHaveBeenCalledWith({ current: 50, total: 100, stage: `Indexing` })
  opened.dispose()
  opened.dispose()
  expect(dispose).toHaveBeenCalledOnce()
})

test(`parse failures retain their stage and source identity`, async () => {
  vi.spyOn(parse_worker, `parse_in_worker`).mockRejectedValue(new Error(`bad atoms`))

  const error = await open_material({ data: `broken`, filename: `bad.xyz` }).catch(
    (reason: unknown) => reason,
  )

  expect(error).toBeInstanceOf(MaterialOpenError)
  expect(error).toMatchObject({
    message: `bad atoms`,
    stage: `parse`,
    provenance: {
      filename: `bad.xyz`,
      source_filename: `bad.xyz`,
      file_size: 6,
    },
  })
})
