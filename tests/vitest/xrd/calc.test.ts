import type { ElementSymbol } from '$lib'
import type { PymatgenStructure } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import { compute_xrd_pattern } from '$lib/xrd'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'

type FilePair = {
  name: string
  struct_path: string
  xrd_path: string
}

type ExpectedPattern = {
  x: number[]
  y: number[]
  hkls?: unknown
  d_hkls?: number[]
}

const structures_dir = path.resolve(
  process.cwd(),
  `src/site/structures`,
)
const xrd_dir = path.resolve(process.cwd(), `tests/vitest/fixtures/xrd`)

function list_matching_pairs(): FilePair[] {
  const structure_files = fs
    .readdirSync(structures_dir)
    .filter((name) => name.endsWith(`.json`))
  const xrd_files = new Set(
    fs
      .readdirSync(xrd_dir)
      .filter((name) => name.endsWith(`.json`)),
  )
  const pairs: FilePair[] = []
  for (const file_name of structure_files) {
    if (!xrd_files.has(file_name)) continue
    pairs.push({
      name: file_name,
      struct_path: path.join(structures_dir, file_name),
      xrd_path: path.join(xrd_dir, file_name),
    })
  }
  return pairs
}

function _get_structure_elements(structure: PymatgenStructure): ElementSymbol[] {
  const elems = new Set<ElementSymbol>()
  for (const site of structure.sites) {
    for (const species of site.species) {
      elems.add(species.element as ElementSymbol)
    }
  }
  return Array.from(elems).sort()
}

function arrays_close(
  a: number[],
  b: number[],
  atol: number,
  rtol: number,
): { ok: boolean; idx?: number; delta?: number } {
  if (a.length !== b.length) {
    return { ok: false, idx: -1, delta: Math.abs(a.length - b.length) }
  }
  for (let idx = 0; idx < a.length; idx++) {
    const va = a[idx]
    const vb = b[idx]
    const diff = Math.abs(va - vb)
    const tol = atol + rtol * Math.max(Math.abs(va), Math.abs(vb))
    if (diff > tol) return { ok: false, idx, delta: diff }
  }
  return { ok: true }
}

describe(`compute_xrd_pattern parity with pymatgen JSON`, () => {
  const file_pairs = list_matching_pairs()

  test(`found structure/XRD JSON pairs`, () => {
    expect(file_pairs.length).toBeGreaterThan(0)
  })

  test.each(file_pairs.map((p) => [p.name, p] as const))(
    `compare XRD for %s`,
    (_name, pair) => {
      const structure_json = fs.readFileSync(pair.struct_path, `utf8`)
      const parsed = parse_structure_file(structure_json, pair.name)
      expect(parsed).not.toBeNull()
      if (!parsed) return

      const structure = parsed as unknown as PymatgenStructure
      const expected: ExpectedPattern = JSON.parse(
        fs.readFileSync(pair.xrd_path, `utf8`),
      ) as ExpectedPattern

      const computed = compute_xrd_pattern(structure, {
        wavelength: `CuKa`,
        scaled: true,
        two_theta_range: [0, 90],
      })

      // Basic shape checks
      expect(computed.x.length).toBe(expected.x.length)
      expect(computed.y.length).toBe(expected.y.length)
      if (expected.d_hkls) {
        expect(computed.d_hkls?.length ?? 0).toBe(expected.d_hkls.length)
      }

      // Angle tolerance (degrees)
      const angle_tol = 5e-4
      const y_rtol = 5e-3
      const y_atol = 1e-2
      const d_rtol = 1e-6
      const d_atol = 1e-6

      const x_check = arrays_close(computed.x, expected.x, angle_tol, 0)
      expect(x_check.ok).toBe(true)

      const y_check = arrays_close(computed.y, expected.y, y_atol, y_rtol)
      expect(y_check.ok).toBe(true)

      if (expected.d_hkls && computed.d_hkls) {
        const d_check = arrays_close(computed.d_hkls, expected.d_hkls, d_atol, d_rtol)
        expect(d_check.ok).toBe(true)
      }
    },
  )
})
