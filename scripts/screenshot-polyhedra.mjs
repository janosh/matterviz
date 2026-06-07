// Capture polyhedra-demo screenshots across diverse structures for visual iteration.
// Usage: node scripts/screenshot-polyhedra.mjs [out_dir] (dev server must run on :3017)
// SCREENSHOT_DELAY (ms) overrides the per-page render settle time.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import process from 'node:process'

const out_dir = process.argv[2] ?? `/tmp/polyhedra-shots`
const base_url = `http://localhost:3017`
// WebGL render completion isn't observable from the DOM (no preserveDrawingBuffer),
// so a fixed settle time is the only reliable wait for bonds/polyhedra/supercell
const settle_ms = Number(process.env.SCREENSHOT_DELAY ?? 4500)
fs.mkdirSync(out_dir, { recursive: true })

// Fail fast when the dev server isn't running instead of timing out per case
await fetch(base_url).catch(() => {
  console.error(`dev server not reachable at ${base_url} - start it with: vite dev`)
  process.exit(1)
})

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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
let failures = 0
for (const { file, supercell } of cases) {
  const params = new URLSearchParams({ file })
  if (supercell) params.set(`supercell`, supercell)
  const url = `${base_url}/structure/polyhedra?${params}`
  try {
    await page.goto(url, { waitUntil: `networkidle` })
    await page.waitForTimeout(settle_ms) // let bonds/polyhedra/supercell compute + render
    const slug = file.replaceAll(/[^\w.-]/g, `_`)
    await page.locator(`.bleed-1400 canvas`).screenshot({ path: `${out_dir}/${slug}.png` })
    console.info(`captured ${file}`)
  } catch (err) {
    failures++
    console.error(`FAILED ${file}: ${err.message}`)
  }
}
await browser.close()
if (failures > 0) process.exit(1)
