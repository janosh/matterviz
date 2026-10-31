import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'

const run = promisify(execFile)
// primitive fcc Cu (1 site) and rock-salt NaCl (2 sites): their conventional cells hold 4 and 8
const cu_poscar = `Cu\n1.0\n0 1.8 1.8\n1.8 0 1.8\n1.8 1.8 0\nCu\n1\nDirect\n0 0 0\n`
const nacl_poscar = `NaCl\n1.0\n0 2.8 2.8\n2.8 0 2.8\n2.8 2.8 0\nNa Cl\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n`
// two frames of a stretching H2 molecule
const h2_xyz = `2\n\nH 0 0 0\nH 0.74 0 0\n2\n\nH 0 0 0\nH 1.6 0 0\n`
// PNG width and height from the IHDR chunk
const png_size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)]
// The JSON lines the CLI prints, one per rendered file
const results = (stdout: string): { input: string; output: string; sites: number }[] =>
  stdout
    .trim()
    .split(`\n`)
    .map((line) => JSON.parse(line))

test.describe(`snapshot CLI`, () => {
  // each CLI run launches its own browser, and software rendering on CI is slow
  test.describe.configure({ timeout: 300_000 })
  // Runs the CLI against the Playwright server on a 200x150 CSS px viewer
  const snapshot = (base_url: string | undefined, ...args: string[]) => {
    if (!base_url) throw new Error(`Snapshot CLI tests require the Playwright server URL`)
    const viewer_args = [`--url`, base_url, `--width`, `200`, `--height`, `150`]
    return run(process.execPath, [`src/scripts/snapshot.mjs`, ...args, ...viewer_args], {
      timeout: 90_000,
    })
  }

  test(`renders a batch at the requested DPI, applies cell props and guards existing images`, async ({
    baseURL: base_url,
    page,
  }, test_info) => {
    // NaCl arrives gzipped: the page opens files through the viewer's own loader
    const inputs = [test_info.outputPath(`Cu.vasp`), test_info.outputPath(`NaCl.vasp.gz`)]
    await writeFile(inputs[0], cu_poscar)
    await writeFile(inputs[1], gzipSync(nacl_poscar))
    const batch = (out_dir: string, ...args: string[]) =>
      snapshot(base_url, ...inputs, `--out-dir`, test_info.outputPath(out_dir), ...args)
    const read = (dir: string, name: string) =>
      readFile(test_info.outputPath(`${dir}/${name}.png`))

    const low_dpi = results((await batch(`low-dpi`, `--dpi`, `72`)).stdout)
    expect(low_dpi.map(({ input, sites }) => [input, sites])).toEqual([
      [inputs[0], 1],
      [inputs[1], 2],
    ])
    for (const name of [`Cu`, `NaCl`])
      expect(png_size(await read(`low-dpi`, name))).toEqual([200, 150])

    // a cell transform per structure in one batch (the second one used to hang)
    const conventional = await batch(`conventional`, `--props`, `{"cell_type":"conventional"}`)
    expect(results(conventional.stdout).map(({ sites }) => sites)).toEqual([4, 8])
    expect(png_size(await read(`conventional`, `NaCl`))).toEqual([400, 300])

    // the canvas is transparent; background_color is composited into the image
    await batch(`red`, `--props`, `{"background_color":"#ff0000"}`)
    const corner = await page.evaluate(
      async (base64) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
        const bitmap = await createImageBitmap(blob)
        const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext(`2d`)
        ctx?.drawImage(bitmap, 0, 0)
        return [...(ctx?.getImageData(1, 1, 1, 1).data ?? [])]
      },
      (await read(`red`, `Cu`)).toString(`base64`),
    )
    expect(corner).toEqual([255, 0, 0, 255])

    await expect(batch(`low-dpi`, `--dpi`, `72`)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`pass --overwrite to replace it`),
    })
    await batch(`low-dpi`, `--overwrite`)
    expect(png_size(await read(`low-dpi`, `Cu`))).toEqual([400, 300])
  })

  test(`writes webp and jpeg, picks trajectory frames and names unusable inputs`, async ({
    baseURL: base_url,
  }, test_info) => {
    const [cu, h2, not_structure] = [`Cu.vasp`, `H2.xyz`, `bands.json`].map((name) =>
      test_info.outputPath(name),
    )
    await writeFile(cu, cu_poscar)
    await writeFile(h2, h2_xyz)
    await writeFile(not_structure, JSON.stringify({ kpoints: [], bands: [] }))
    const out = (dir: string) => [`--out-dir`, test_info.outputPath(dir)]

    await snapshot(base_url, cu, ...out(`webp`), `--format`, `webp`)
    await snapshot(base_url, cu, ...out(`jpeg`), `--format`, `jpeg`, `--quality`, `0.5`)
    const webp = await readFile(test_info.outputPath(`webp/Cu.webp`))
    expect([webp.subarray(0, 4).toString(), webp.subarray(8, 12).toString()]).toEqual([
      `RIFF`,
      `WEBP`,
    ])
    const jpeg = await readFile(test_info.outputPath(`jpeg/Cu.jpg`))
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])

    await snapshot(base_url, h2, ...out(`frame-0`))
    await snapshot(base_url, h2, ...out(`frame-1`), `--frame`, `1`)
    const [frame_0, frame_1] = await Promise.all(
      [`frame-0`, `frame-1`].map((dir) => readFile(test_info.outputPath(`${dir}/H2.png`))),
    )
    expect(frame_0.equals(frame_1), `--frame 1 drew frame 0`).toBe(false)

    // Per-file failures name the file and the cause, and the run exits non-zero
    await expect(
      snapshot(base_url, h2, not_structure, ...out(`errors`), `--frame`, `2`),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(
        /H2\.xyz: 2 frames, no frame 2\n.*bands\.json: .*not a structure/,
      ),
    })
  })

  test(`waits for isosurfaces meshed in a worker before exporting`, async ({
    baseURL: base_url,
  }, test_info) => {
    // A grid this size meshes in the geometry worker, after the scene's first frames
    const chgcar = `src/site/isosurfaces/large-grid-CHGCAR.gz`
    // its header up to the first blank line is a POSCAR of the same atoms, without volumes
    const header = gunzipSync(await readFile(chgcar))
      .toString()
      .split(/\n\s*\n/)[0]
    const poscar = test_info.outputPath(`large-grid-CHGCAR.vasp`)
    await writeFile(poscar, `${header}\n`)
    await snapshot(base_url, chgcar, `--out-dir`, test_info.outputPath(`volume`))
    await snapshot(base_url, poscar, `--out-dir`, test_info.outputPath(`atoms`))
    const [volume, atoms] = await Promise.all(
      [`volume`, `atoms`].map((dir) =>
        readFile(test_info.outputPath(`${dir}/large-grid-CHGCAR.png`)),
      ),
    )
    expect(volume.equals(atoms), `the export ran before the isosurface was meshed`).toBe(false)
  })
})
