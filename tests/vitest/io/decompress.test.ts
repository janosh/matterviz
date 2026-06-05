import { decompress_file } from '$lib/io/decompress'
import { expect, test } from 'vitest'

test(`decompress_file resolves empty (0-byte) files to empty content`, async () => {
  // FileReader returns '' for empty text files, which is falsy but valid
  const result = await decompress_file(new File([], `empty.txt`))
  expect(result).toEqual({ content: ``, filename: `empty.txt` })
})
