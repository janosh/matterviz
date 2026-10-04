import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

it(`starts its private viewer from the checkout when invoked elsewhere`, async () => {
  const root = resolve(`.`)
  const directory = await mkdtemp(`${tmpdir()}/movie-cli-root-`)
  const spec = `${directory}/movie.json`
  const loader = `${directory}/viewer-loader.mjs`
  try {
    await writeFile(
      spec,
      JSON.stringify({ source: { url: `https://example.invalid/run.h5` } }),
    )
    // Stop before opening a browser and inspect the directory used at the server boundary.
    await writeFile(
      loader,
      `import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next_resolve) {
    if (specifier === 'vite') return { url: 'mock:viewer', shortCircuit: true };
    return next_resolve(specifier, context);
  },
  load(url, context, next_load) {
    if (url === 'mock:viewer') return { format: 'module', shortCircuit: true,
      source: 'export const createServer = () => { throw new Error("VIEWER_ROOT:" + process.cwd()); };' };
    return next_load(url, context);
  }
});`,
    )
    await expect(
      execute(
        process.execPath,
        [
          `--import`,
          loader,
          `${root}/src/scripts/movie.mjs`,
          `preview`,
          spec,
          `-o`,
          `preview.png`,
        ],
        { cwd: directory },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: `${JSON.stringify({ stage: `error`, message: `Error: VIEWER_ROOT:${root}` })}\n`,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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
