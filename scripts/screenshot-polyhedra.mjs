// Capture polyhedra-demo screenshots across diverse structures for visual iteration.
// Usage: node scripts/screenshot-polyhedra.mjs [out_dir] (dev server must run on :3017)
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import process from 'node:process'

const out_dir = process.argv[2] ?? `/tmp/polyhedra-shots`
fs.mkdirSync(out_dir, { recursive: true })

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
for (const { file, supercell } of cases) {
  const params = new URLSearchParams({ file })
  if (supercell) params.set(`supercell`, supercell)
  const url = `http://localhost:3017/structure/polyhedra?${params}`
  try {
    await page.goto(url, { waitUntil: `networkidle` })
    await page.waitForTimeout(4500) // let bonds/polyhedra/supercell compute + render
    const slug = file.replaceAll(/[^\w.-]/g, `_`)
    await page.locator(`.bleed-1400 canvas`).screenshot({ path: `${out_dir}/${slug}.png` })
    console.info(`captured ${file}`)
  } catch (err) {
    console.error(`FAILED ${file}: ${err.message}`)
  }
}
await browser.close()
