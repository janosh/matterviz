import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

it.each([``, `.json`, `.review`])(
  `rejects an occupied movie destination %j before launching the viewer`,
  async (suffix) => {
    const directory = await mkdtemp(`${tmpdir()}/movie-cli-test-`)
    const output = `${directory}/movie.mp4`
    const destination = `${output}${suffix}`
    const spec = `${directory}/movie.json`
    try {
      await writeFile(destination, `preserve this file`)
      await writeFile(
        spec,
        JSON.stringify({ source: { url: `https://example.invalid/run.h5` } }),
      )
      await expect(
        execute(process.execPath, [
          resolve(`src/scripts/movie.mjs`),
          `render`,
          spec,
          `--output`,
          output,
          `--url`,
          `http://127.0.0.1:1`,
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stdout: ``,
        stderr: `${JSON.stringify({
          stage: `error`,
          message: `Error: Output already exists: ${destination}`,
        })}\n`,
      })
      expect(await readFile(destination, `utf8`)).toBe(`preserve this file`)
      if (suffix) await expect(readFile(output)).rejects.toMatchObject({ code: `ENOENT` })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
