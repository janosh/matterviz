import * as parse_worker from '#lib/file-viewer/parse-in-worker.js'
import { deliver_raw_file, MaterialOpenError, open_material } from '#lib/file-viewer/open.js'
import type { ParseResult } from '#lib/file-viewer/parse.js'
import { afterEach, expect, test, vi } from 'vitest'
import { gzip_bytes, make_run, utf16_bom } from '../test-fixtures'

afterEach(() => vi.restoreAllMocks())

// file_size is the inflated payload's own size (UTF-16 here: 2 bytes per char plus a BOM),
// carried from decompression rather than measured by re-encoding the decoded text as UTF-8.
// Text reaches the worker as the inflated Blob: decoding it on the main thread blocked it.
test(`URL and File acquisition decompress once and record source provenance`, async () => {
  const utf16 = utf16_bom(`structure text`)
  const gzipped = await gzip_bytes(utf16)
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

  expect(parse).toHaveBeenCalledWith(expect.any(Blob), `si.cif`, false, expect.anything())
  expect(opened.provenance).toEqual({
    filename: `si.cif`,
    source_filename: `si.cif.gz`,
    source_url: `https://example.com/si.cif.gz`,
    file_size,
  })
  const dropped = await open_material(new File([gzipped], `si.cif.gz`))
  expect(dropped.provenance.file_size).toBe(file_size)
  const plain = new File([utf16], `si.cif`)
  await open_material(plain)
  const [url_blob, gz_blob, plain_blob] = parse.mock.calls.map(([data]) => data as Blob)
  expect(plain_blob).toBe(plain)
  for (const blob of [url_blob, gz_blob, plain_blob])
    expect(new Uint16Array(await blob.arrayBuffer())).toEqual(utf16)
})

// Raw readers still get text decoded (UTF-16 by its BOM) and HDF5 as bytes, not the Blobs the
// parse worker takes
test.each([
  [`si.cif`, false],
  [`si.cif.gz`, true],
  [`run.h5`, false],
])(`deliver_raw_file decodes %s (gzipped: %s)`, async (name, gzipped) => {
  const is_text = !name.endsWith(`.h5`)
  const bytes = is_text
    ? utf16_bom(`data_Si`)
    : new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
  const file = new File([gzipped ? await gzip_bytes(bytes) : bytes], name)
  const on_file = vi.fn()
  await deliver_raw_file(file, on_file)
  const [content, filename, metadata] = on_file.mock.calls[0]
  expect([filename, metadata]).toEqual([
    name.replace(/\.gz$/, ``),
    { source_filename: name, file, source_url: undefined },
  ])
  if (is_text) expect(content).toBe(`data_Si`)
  else expect(new Uint8Array(content)).toEqual(bytes)
})

test(`deliver_raw_file rejects empty payloads`, async () => {
  const on_file = vi.fn()
  for (const data of [``, new Blob([])]) {
    await expect(deliver_raw_file({ data, filename: `run.h5` }, on_file)).rejects.toThrow(
      `file is empty`,
    )
  }
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
