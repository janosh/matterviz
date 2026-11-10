// Usage: node src/scripts/capture-screenshots.mjs <readme|polyhedra> [polyhedra_out_dir]
// readme: the readme.md gallery (dark mode, 2x), uploaded with --clobber to the release its
// links name (RELEASE_TAG overrides; SHOTS=name,name picks images). The JupyterLab readme shot
// needs a running Lab, so it isn't covered here.
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)
const profile = process.argv[2]
if (![`readme`, `polyhedra`].includes(profile)) {
  throw new Error(`Expected screenshot profile "readme" or "polyhedra", got ${profile}`)
}

const port = process.env.PORT ?? (profile === `polyhedra` ? `3017` : `3000`)
const base_url = `http://localhost:${port}`
const output_dir =
  profile === `readme`
    ? `/tmp/matterviz-screenshots`
    : (process.argv[3] ?? `/tmp/polyhedra-shots`)

const navigate = async (page, url) => {
  const response = await page.goto(url, { waitUntil: `networkidle` })
  if (response?.ok() !== false) return
  throw new Error(
    `Navigation failed: ${response.status()} ${response.statusText()} for ${url}`,
  )
}

// README gallery: each shot clips a component (lazy demos are scrolled into view first) to the
// union of its descendants' boxes, since full-bleed children overflow their wrapper. Options:
// - after: the first sibling after that heading id holding a sizeable canvas/svg
// - selector: a CSS match, inside the section after `anchor` when given
// - own_box: clip to the target's own box instead
// - crop_x: keep that centered fraction of the clip's width (content floating in blank space)
// - hover: [x, y] fractions of the target's largest svg to point the cursor at (fills linked plots)
// - hide: selectors to hide (e.g. that hover's tooltip)
// - transparent: drop the page background and headings, so gaps between viewers take the
//   README's own background in light and dark mode
// File names match readme.md.
const README_SHOTS = [
  { name: `structure-viewer`, url: `/`, after: `structure-viewer`, transparent: true },
  { name: `trajectory-viewer`, url: `/`, after: `trajectory-viewer`, wait: 10_000 },
  {
    name: `isosurface`,
    url: `/structure/isosurface?file=pymatgen-CHGCAR.Fe3O4.gz`,
    selector: `div.structure`,
    wait: 10_000,
  },
  {
    name: `phonon-bz-bands-dos`,
    url: `/`,
    after: `phonon-spectra-brillouin-zone-bands-dos`,
    width: 1500,
  },
  {
    name: `phase-diagram-comparison`,
    url: `/phase-diagram`,
    after: `benchmark-view`,
    hover: [0.3, 0.42], // fills the Gibbs plot below, which is empty without a cursor
    hide: [`.plot-tooltip`], // the hover's tooltip would cover the diagram and legend
  },
  {
    name: `quaternary-convex-hulls`,
    url: `/convex-hull`,
    after: `quaternary-chemical-systems`,
  },
  {
    name: `fermi-surface`,
    url: `/reciprocal/fermi-surface`,
    selector: `div.fermi-surface`,
    own_box: true, // its file picker overflows above the viewer
    crop_x: 0.5, // the zone sits mid-canvas with blank space either side
  },
  {
    name: `periodic-table-heatmap`,
    url: `/`,
    anchor: `#multi-value-heatmap`,
    selector: `.periodic-table`,
  },
]

const readme_target = async (page, { after, anchor, selector, wait }) => {
  if (after) {
    await page.locator(`#${after}`).scrollIntoViewIfNeeded()
    await page.waitForTimeout(wait)
    const handle = await page.evaluateHandle((id) => {
      const big = (node) =>
        [...node.querySelectorAll(`canvas, svg`)].some(
          (el) => el.clientWidth * el.clientHeight > 60_000,
        )
      let el = document.getElementById(id)?.nextElementSibling
      while (el && !big(el)) el = el.nextElementSibling
      return el
    }, after)
    return handle.asElement()
  }
  if (anchor) {
    await page.locator(anchor).scrollIntoViewIfNeeded()
    await page.waitForTimeout(wait)
    return page.locator(`${anchor} ~ * ${selector}`).first()
  }
  await page.waitForTimeout(wait)
  return page.locator(selector).first()
}

const VIEWPORT_HEIGHT = 860
// SHOTS=name,name captures (and uploads) only those images
const only_shots = process.env.SHOTS?.split(`,`)
const unknown_shots = only_shots?.filter(
  (shot) => !README_SHOTS.some(({ name }) => name === shot),
)
if (unknown_shots?.length) {
  throw new Error(
    `Unknown SHOTS ${unknown_shots}, expected some of ${README_SHOTS.map(({ name }) => name)}`,
  )
}

const capture_readme = async (browser) => {
  // the release readme.md's image links name, so new shots replace the ones it shows
  const readme_tag = (await readFile(`readme.md`, `utf8`)).match(
    /janosh\/matterviz\/releases\/download\/(v[\d.]+)\//,
  )?.[1]
  const release_tag = process.env.RELEASE_TAG ?? readme_tag
  if (!release_tag)
    throw new Error(`readme.md links no release images and RELEASE_TAG is unset`)
  const output_paths = []
  for (const {
    name,
    url,
    width = 1280,
    wait = 8000,
    own_box = false,
    crop_x = 1,
    hover,
    hide = [],
    transparent = false,
    ...spec
  } of README_SHOTS.filter(({ name }) => !only_shots || only_shots.includes(name))) {
    console.info(`Capturing: ${name}`)
    const context = await browser.newContext({
      viewport: { width, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: 2,
      colorScheme: `dark`,
    })
    const page = await context.newPage()
    await navigate(page, `${base_url}${url}`)
    // transparent: viewers keep an opaque tile (their themed bg, #26272b composited on the
    // dark page, is translucent)
    const transparent_css = `html, body, main { background: transparent !important }
      div.structure { --struct-bg: #26272b !important }
      main h3 { visibility: hidden !important }`
    await page.addStyleTag({
      content: [
        `.theme-control, .site-search-btn { display: none !important }`,
        hide.length ? `${hide.join(`, `)} { visibility: hidden !important }` : ``,
        transparent ? transparent_css : ``,
      ].join(`\n`),
    })
    const target = await readme_target(page, { ...spec, wait })
    if (!target) throw new Error(`No capture target for ${name} on ${url}`)
    // centered, a target shorter than the viewport fits whole, so no fullPage shot is needed
    await target.evaluate((el) => el.scrollIntoView({ block: `center` }))
    await page.waitForTimeout(300)
    if (hover) {
      // viewport coordinates, as page.mouse expects (target is a Locator or an ElementHandle)
      const box = await target.evaluate((el) => {
        // the largest svg is the plot (smaller ones are icons and legend swatches)
        const area = (node) => node.clientWidth * node.clientHeight
        const svg = [...el.querySelectorAll(`svg`)].sort((a, b) => area(b) - area(a))[0]
        const rect = svg?.getBoundingClientRect()
        return rect && { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      })
      if (!box) throw new Error(`No svg to hover in ${name}`)
      // glide in: the plot updates on pointermove after pointerenter, not on a single jump
      await page.mouse.move(0, 0)
      await page.mouse.move(box.x + hover[0] * box.width, box.y + hover[1] * box.height, {
        steps: 8,
      })
    } else await page.mouse.move(0, 0)
    await page.waitForTimeout(800)
    const clip = await target.evaluate((el, own) => {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const node of own ? [el] : [el, ...el.querySelectorAll(`*`)]) {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        if (!rect.width || !rect.height || style.visibility === `hidden`) continue
        x0 = Math.min(x0, rect.left)
        y0 = Math.min(y0, rect.top)
        x1 = Math.max(x1, rect.right)
        y1 = Math.max(y1, rect.bottom)
      }
      x0 = Math.max(0, x0)
      x1 = Math.min(document.documentElement.clientWidth, x1)
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    }, own_box)
    if (crop_x < 1) {
      clip.x += (clip.width * (1 - crop_x)) / 2
      clip.width *= crop_x
    }
    const png_path = `${output_dir}/${name}.png`
    const webp_path = `${output_dir}/${name}.webp`
    // a viewport shot keeps the cursor over a hovered plot (fullPage resizes and scrolls, which
    // ends the hover); a clip taller than the viewport needs fullPage and page coordinates
    const full_page = clip.y < 0 || clip.y + clip.height > VIEWPORT_HEIGHT
    if (full_page) clip.y += await page.evaluate(() => scrollY)
    await page.screenshot({
      path: png_path,
      clip,
      fullPage: full_page,
      omitBackground: transparent,
    })
    await context.close()
    // cap at 2000 px wide (README images render far smaller), never upscaling
    const resize = clip.width * 2 > 2000 ? [`-resize`, `2000`, `0`] : []
    await exec_file(`cwebp`, [`-q`, `88`, ...resize, png_path, `-o`, webp_path])
    await unlink(png_path)
    output_paths.push(webp_path)
    console.info(`  -> ${webp_path}`)
  }

  const upload_args = [
    `release`,
    `upload`,
    release_tag,
    ...output_paths,
    `--repo`,
    `janosh/matterviz`,
    `--clobber`,
  ]
  try {
    await exec_file(`gh`, upload_args)
    console.info(`\nUploaded to ${release_tag} (readme.md links ${release_tag}/<name>.webp)`)
  } catch (error) {
    console.error(`\nUpload failed: ${error}`)
    console.error(`Run manually:\ngh ${upload_args.join(` `)}`)
    process.exitCode = 1
  }
  console.info(`\nSaved to: ${output_dir}`)
}

const capture_polyhedra = async (browser) => {
  const settle_ms = Number(process.env.SCREENSHOT_DELAY ?? 4500)
  const cases = [
    { file: `Li4Fe3Mn1(PO4)4.cif` },
    { file: `mp-756175.json` },
    { file: `LiFePO4.cif` },
    { file: `BaTiO3-tetragonal.poscar`, supercell: `2x2x2` },
    { file: `NaCl-cubic.poscar`, supercell: `2x2x2` },
    { file: `quartz.extxyz`, supercell: `2x2x2` },
    { file: `TiO2.cif`, supercell: `2x2x2` },
    { file: `Li10GeP2S12.cif`, supercell: `2x2x2` },
    { file: `Bi2Zr2O8-Fm3m.json` },
    { file: `MgNiF6.cif`, supercell: `2x2x2` },
  ]
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  let failed = false

  for (const { file, supercell } of cases) {
    const params = new URLSearchParams({ file })
    if (supercell) params.set(`supercell`, supercell)
    try {
      await navigate(page, `${base_url}/structure/polyhedra?${params}`)
      await page.waitForTimeout(settle_ms)
      const slug = file.replaceAll(/[^\w.-]/g, `_`)
      await page
        .locator(`.bleed-1400 canvas`)
        .screenshot({ path: `${output_dir}/${slug}.png` })
      console.info(`Captured ${file}`)
    } catch (error) {
      failed = true
      console.error(`Failed ${file}: ${error}`)
    }
  }
  if (failed) process.exitCode = 1
}

try {
  await fetch(base_url, { signal: AbortSignal.timeout(5000) })
} catch {
  throw new Error(`Dev server not reachable at ${base_url}`)
}
await mkdir(output_dir, { recursive: true })
const browser = await chromium.launch()
try {
  if (profile === `readme`) await capture_readme(browser)
  else await capture_polyhedra(browser)
} finally {
  await browser.close()
}
