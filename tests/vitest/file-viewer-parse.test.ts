import { parse_file_content, set_large_file_requester } from '$lib/file-viewer/parse'
import { expect, test } from 'vitest'

test(`parses a POSCAR structure through the worker-safe entry`, async () => {
  const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
  const result = await parse_file_content(poscar, `POSCAR`)

  expect(result.type).toBe(`structure`)
  expect((result.data as { sites: unknown[] }).sites).toHaveLength(2)
})

test(`large-file markers require an embedding-host requester`, async () => {
  set_large_file_requester(null)
  await expect(
    parse_file_content(`LARGE_FILE:/tmp/movie.traj:10`, `movie.traj`),
  ).rejects.toThrow(`No large-file requester registered`)
})

test.each([`zip`, `xz`, `bz2`] as const)(
  `rejects unsupported %s compression with an extraction hint`,
  async (format) => {
    await expect(
      parse_file_content(btoa(`content`), `data.json.${format}`, true),
    ).rejects.toThrow(`${format.toUpperCase()} decompression is not supported`)
  },
)

test(`rejects nested compression before parsing the inner payload`, async () => {
  await expect(parse_file_content(btoa(`content`), `movie.xyz.gz.gz`, true)).rejects.toThrow(
    `Nested compression is not supported`,
  )
})
