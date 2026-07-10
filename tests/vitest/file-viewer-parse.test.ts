import { parse_file_content, set_large_file_requester } from '$lib/file-viewer/parse'
import { expect, test } from 'vitest'

test(`large-file markers require an embedding-host requester`, async () => {
  set_large_file_requester(null)
  await expect(
    parse_file_content(`LARGE_FILE:/tmp/movie.traj:10`, `movie.traj`),
  ).rejects.toThrow(`No large-file requester registered`)
})
