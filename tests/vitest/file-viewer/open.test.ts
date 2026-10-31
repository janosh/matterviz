import * as parse_worker from '#lib/file-viewer/parse-in-worker.js'
import { deliver_raw_file, MaterialOpenError, open_material } from '#lib/file-viewer/open.js'
import type { ParseResult } from '#lib/file-viewer/parse.js'
import { afterEach, expect, test, vi } from 'vitest'
import { make_run } from '../test-fixtures'

afterEach(() => vi.restoreAllMocks())

// file_size is the inflated payload's own size (UTF-16 here: 2 bytes per char plus a BOM),
// carried from decompression rather than measured by re-encoding the decoded text as UTF-8
test(`URL and File acquisition decompress once and record source provenance`, async () => {
  const text = `structure text`
  const utf16 = new Uint16Array([0xfeff, ...Array.from(text, (char) => char.charCodeAt(0))])
  const gzipped = await new Response(
    new Blob([utf16]).stream().pipeThrough(new CompressionStream(`gzip`)),
  ).arrayBuffer()
  const file_size = utf16.byteLength
  vi.spyOn(globalThis, `fetch`).mockResolvedValue(new Response(gzipped))
  const parse = vi
    .spyOn(parse_worker, `parse_in_worker`)
    .mockImplementation(async (_data, filename): Promise<ParseResult> => ({
      type: `structure`,
      data: { sites: [] },
      filename,
      warnings: [],
    }))

  const opened = await open_material(`https://example.com/si.cif.gz`)

  expect(parse).toHaveBeenCalledWith(text, `si.cif`, false, expect.anything())
  expect(opened.provenance).toEqual({
    filename: `si.cif`,
    source_filename: `si.cif.gz`,
    source_url: `https://example.com/si.cif.gz`,
    file_size,
  })
  const dropped = await open_material(new File([gzipped], `si.cif.gz`))
  expect(dropped.provenance.file_size).toBe(file_size)
})

// An empty Blob-backed (HDF5) payload is rejected before being read into an ArrayBuffer
test(`deliver_raw_file rejects empty payloads without reading them`, async () => {
  const on_file = vi.fn()
  const empty = new Blob([])
  const array_buffer = vi.spyOn(empty, `arrayBuffer`)
  for (const data of [``, empty]) {
    await expect(deliver_raw_file({ data, filename: `run.h5` }, on_file)).rejects.toThrow(
      `file is empty`,
    )
  }
  expect(array_buffer).not.toHaveBeenCalled()
  expect(on_file).not.toHaveBeenCalled()
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
    provenance: { filename: `bad.xyz`, source_filename: `bad.xyz`, file_size: 6 },
  })
})
