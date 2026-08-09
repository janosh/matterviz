// Usage: node src/scripts/capture-screenshots.mjs <site|polyhedra> [polyhedra_out_dir]
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)
const profile = process.argv[2]
if (![`site`, `polyhedra`].includes(profile)) {
  throw new Error(`Expected screenshot profile "site" or "polyhedra", got ${profile}`)
}

const port = process.env.PORT ?? (profile === `polyhedra` ? `3017` : `3000`)
const base_url = `http://localhost:${port}`
const output_dir =
  profile === `site`
    ? `/tmp/matterviz-screenshots`
    : (process.argv[3] ?? `/tmp/polyhedra-shots`)

const navigate = async (page, url) => {
  const response = await page.goto(url, { waitUntil: `networkidle` })
  if (response?.ok() !== false) return
  throw new Error(
    `Navigation failed: ${response.status()} ${response.statusText()} for ${url}`,
  )
}

const capture_site = async (browser) => {
  const package_json = JSON.parse(await readFile(`package.json`, `utf8`))
  const release_tag = process.env.RELEASE_TAG ?? `v${package_json.version}`
  const today = new Date().toISOString().slice(0, 10)
  const pages = [
    { url: `/`, name: `landing-page`, wait: 3000, scroll: 100 },
    {
      url: `/periodic-table`,
      name: `heatmap`,
      clicks: [
        `input[placeholder="Select a heatmap"]`,
        `ul.options li:has-text("Atomic Mass")`,
      ],
      wait: 1500,
    },
    { url: `/structure?file=Bi2Zr2O8-Fm3m.json`, name: `structure-viewer`, wait: 3000 },
    { url: `/gold`, name: `details-page`, wait: 1000 },
  ]
  const output_paths = []

  for (const { url, name, clicks, wait, scroll = 200 } of pages) {
    console.info(`Capturing: ${name}`)
    const context = await browser.newContext({
      viewport: { width: 1200, height: 700 },
      deviceScaleFactor: 3,
    })
    const page = await context.newPage()
    await navigate(page, `${base_url}${url}`)
    await page.evaluate((scroll_px) => globalThis.scrollBy(0, scroll_px), scroll)
    await page.waitForTimeout(300)

    for (const selector of clicks ?? []) {
      await page.locator(selector).click({ timeout: 10_000 })
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(wait)

    const png_path = `${output_dir}/${today}-${name}.png`
    const webp_path = `${output_dir}/${today}-${name}.webp`
    await page.screenshot({ path: png_path })
    await context.close()

    try {
      await exec_file(`cwebp`, [`-q`, `85`, png_path, `-o`, webp_path])
      await unlink(png_path)
      output_paths.push(webp_path)
    } catch (error) {
      console.warn(`  cwebp failed, keeping PNG: ${error}`)
      output_paths.push(png_path)
    }
    console.info(`  -> ${output_paths.at(-1)}`)
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
    console.info(`\nUploaded to ${release_tag}. README URLs:`)
    for (const path of output_paths) {
      const file = basename(path)
      console.info(
        `![${file}](https://github.com/janosh/matterviz/releases/download/${release_tag}/${file})`,
      )
    }
  } catch (error) {
    console.error(`\nUpload failed: ${error}`)
    console.error(`Run manually:\ngh ${upload_args.join(` `)}`)
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
  if (profile === `site`) await capture_site(browser)
  else await capture_polyhedra(browser)
} finally {
  await browser.close()
}
