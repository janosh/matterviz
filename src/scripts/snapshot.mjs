// Agent-facing structure stills: one image per structure file, rendered by the same
// Structure viewer, file loader and PNG export path as the app (/structure/render).
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { start_viewer } from './viewer.mjs'

const usage = `Usage: pnpm snapshot <structure files...> --out-dir <dir> [options]
Any file the viewer opens, compressed or not: CIF, POSCAR, (ext)xyz, pymatgen/ASE/OPTIMADE
JSON, PDB, LAMMPS, CHGCAR/cube (with isosurfaces), trajectories (one frame), ... One image
each, named after its input: <out-dir>/<file name without extensions>.<format>
Options:
  --props <json|file.json>  Structure props, e.g. '{"cell_type":"conventional",
                            "supercell_scaling":"2x2x2","background_color":"#ffffff",
                            "scene_props":{"show_bonds":"never"}}'. PNG and WebP
                            are transparent unless background_color is set.
  --format png|webp|jpeg    image format (default png)
  --quality 0.9             webp/jpeg quality in [0, 1]
  --frame 0                 trajectory frame to render
  --hdf5-group <path>       trajectory group of an HDF5 file holding several
  --width 900 --height 700  viewer size in CSS px
  --dpi 144                 resolution, 72 to 720 (72 = one pixel per CSS px)
  --overwrite               replace existing images
  --url <http://...>        use a running dev server instead of starting one
  --headed                  show the browser
One JSON line per file on stdout ({input, output, sites}); errors on stderr.`

// `pnpm snapshot` runs in the package root and records the caller's directory in INIT_CWD,
// which a plain `node` call inherits stale from any pnpm script that launched it
const caller_dir =
  (process.env.npm_lifecycle_event === `snapshot` && process.env.INIT_CWD) || process.cwd()
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  )
let viewer
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'out-dir': { type: `string`, short: `o` },
      props: { type: `string` },
      width: { type: `string`, default: `900` },
      height: { type: `string`, default: `700` },
      dpi: { type: `string`, default: `144` },
      format: { type: `string`, default: `png` },
      quality: { type: `string`, default: `0.9` },
      frame: { type: `string`, default: `0` },
      'hdf5-group': { type: `string` },
      overwrite: { type: `boolean` },
      url: { type: `string` },
      headed: { type: `boolean` },
      help: { type: `boolean`, short: `h` },
    },
  })
  if (values.help) {
    console.log(usage)
    process.exit(0)
  }
  if (!positionals.length || !values[`out-dir`])
    throw new Error(`structure files and --out-dir are required\n\n${usage}`)
  const number = (name, min, max) => {
    const value = Number(values[name])
    if (!(value >= min && value <= max))
      throw new Error(`--${name} must be in [${min}, ${max}]`)
    return value
  }
  const [width, height] = [number(`width`, 1, 16_384), number(`height`, 1, 16_384)]
  const [png_dpi, quality] = [number(`dpi`, 72, 720), number(`quality`, 0, 1)]
  const { format } = values
  if (![`png`, `webp`, `jpeg`].includes(format))
    throw new Error(`--format must be png, webp or jpeg`)
  const frame = Number(values.frame)
  if (!Number.isInteger(frame) || frame < 0)
    throw new Error(`--frame must be a non-negative integer`)
  const props_arg = values.props?.trim()
  const props = !props_arg
    ? {}
    : JSON.parse(
        props_arg.startsWith(`{`)
          ? props_arg
          : await readFile(resolve(caller_dir, props_arg), `utf8`),
      )
  const out_dir = resolve(caller_dir, values[`out-dir`])
  const extension = { png: `png`, webp: `webp`, jpeg: `jpg` }[format]
  const jobs = positionals.map((input) => {
    const path = resolve(caller_dir, input)
    // CHGCAR.gz -> CHGCAR, Fe.cif.bz2 -> Fe
    const name = basename(path).replace(/\.(?:gz|bz2|xz|zst|zip)$/i, ``)
    return { path, output: resolve(out_dir, `${basename(name, extname(name))}.${extension}`) }
  })
  const outputs = jobs.map(({ output }) => output.toLowerCase()) // case-insensitive disks
  const repeated = jobs.find((_job, idx) => outputs.indexOf(outputs[idx]) !== idx)
  if (repeated) throw new Error(`Two inputs would both write ${repeated.output}`)
  for (const { path } of jobs)
    if (!(await exists(path))) throw new Error(`No such file: ${path}`)
  for (const { output } of jobs)
    if (!values.overwrite && (await exists(output)))
      throw new Error(`Output already exists: ${output} (pass --overwrite to replace it)`)
  await mkdir(out_dir, { recursive: true })

  viewer = await start_viewer({
    url: values.url,
    headed: values.headed,
    viewport: { width, height },
    color_scheme: `light`,
  })
  const { page } = viewer
  page.on(`pageerror`, (error) => console.error(`browser error: ${error.message}`))
  await page.goto(`${viewer.url}/structure/render`)
  await page.waitForFunction(() => Boolean(window.matterviz_snapshot), undefined, {
    timeout: 120_000,
  })
  const source = page.locator(`#snapshot-source`)
  const snapshot = { png_dpi, format, quality, frame, hdf5_group_path: values[`hdf5-group`] }
  for (const { path, output } of jobs) {
    try {
      // by path, like pnpm movie: the browser reads the file itself, so large or binary
      // inputs are never copied through JavaScript strings
      await source.setInputFiles(path)
      const { data_url, sites } = await source.evaluate(
        (input, args) => window.matterviz_snapshot.render(input.files[0], ...args),
        [snapshot, props],
      )
      const flag = values.overwrite ? `w` : `wx`
      await writeFile(output, Buffer.from(data_url.split(`,`)[1], `base64`), { flag })
      console.log(JSON.stringify({ input: path, output, sites }))
    } catch (error) {
      // the page's own message, without Playwright's wrapper and the browser stack
      const message = String(error.message ?? error).split(`\n`)[0]
      console.error(`${path}: ${message.replace(/^\w+\.evaluate: (?:\w*Error: )?/, ``)}`)
      process.exitCode = 1
    }
  }
} catch (error) {
  console.error(String(error.message ?? error))
  process.exitCode = 1
} finally {
  await viewer?.browser.close()
  await viewer?.server?.close()
}
