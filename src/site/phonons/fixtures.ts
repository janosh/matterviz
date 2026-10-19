// Phonon fixtures (pymatgen/atomate2 phonon docs, one file per material and method) as lazy
// per-file loaders, plus the normalization index.ts applies to its eager maps. A demo that shows
// one material at a time loads only that material's files instead of all of them.

import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { PhononBandStructure, PhononDos } from '#lib/spectral/index.js'
import { normalize_band_structure, normalize_dos } from '#lib/spectral/index.js'
import type { Crystal } from '#lib/structure/index.js'

// pymatgen `PhononBandStructureSymmLine.as_dict()` as dumped by the fixture workflow (the
// reciprocal lattice is spelled `recip_lattice`); `normalize_band_structure` does the conversion
interface RawPhononBandStructure {
  recip_lattice: { matrix: Matrix3x3 }
  structure?: Crystal
  qpoints: Vec3[]
  bands: number[][]
  labels_dict: Record<string, Vec3>
  has_nac?: boolean
  has_imaginary_modes?: boolean
}

export type PhononData = {
  phonon_bandstructure?: RawPhononBandStructure
  phonon_dos?: Omit<PhononDos, 'type'>
  primitive?: Crystal
  structure?: Crystal
}

export type PhononFixture = { data: PhononData; bands?: PhononBandStructure; dos?: PhononDos }

const METHOD_SUFFIX = /-(?:pbe|m3gnet|chgnet-v[\d.]+|mace-[\w-]+)$/

export const phonon_method_label = (material: string, key: string): string => {
  const method = key.slice(material.length + 1)
  if (method === `pbe`) return `DFT (PBE)`
  if (method === `m3gnet`) return `M3GNet`
  if (method.startsWith(`chgnet`)) return `CHGNet`
  if (method.startsWith(`mace`)) return `MACE`
  return method
}

// File stem as the fixture key: `./mp-2758-Sr4Se4-pbe.json.gz` -> `mp-2758-Sr4Se4-pbe`
export const phonon_fixture_key = (path: string): string =>
  /\/(?<id>[^/]+)\.json(?:\.gz)?$/.exec(path)?.[1] ?? path

// Band structure and DOS in matterviz's normalized form, next to the raw document
export const normalize_phonon_fixture = (key: string, data: PhononData): PhononFixture => {
  const fixture: PhononFixture = { data }
  if (data.phonon_bandstructure) {
    const band_struct = normalize_band_structure(data.phonon_bandstructure)
    if (!band_struct || band_struct.type !== `phonon`)
      throw new Error(`${key}: phonon_bandstructure is not a phonon band structure`)
    fixture.bands = { ...band_struct, type: `phonon` }
  }
  if (data.phonon_dos) {
    const dos = normalize_dos(data.phonon_dos)
    if (!dos || dos.type !== `phonon`)
      throw new Error(`${key}: phonon_dos is not a phonon density of states`)
    fixture.dos = dos
  }
  return fixture
}

// Uncompressed for dev, gzipped in git; same file set as index.ts's eager glob
const loaders = new Map(
  Object.entries(
    import.meta.glob<PhononData>([`./*.json`, `./*.json.gz`], { import: `default` }),
  ).map(([path, load]) => [phonon_fixture_key(path), load]),
)

export const load_phonon_fixtures = (keys: string[]): Promise<PhononFixture[]> =>
  Promise.all(
    keys.map(async (key) => {
      const load = loaders.get(key)
      if (!load) {
        throw new Error(`Unknown phonon fixture ${key}; available: ${[...loaders.keys()]}`)
      }
      return normalize_phonon_fixture(key, await load())
    }),
  )

type PhononFixtureGroup = {
  material: string
  label: string
  keys: string[]
}

// Group fixtures by material while preserving each calculation method as a selectable key.
export const phonon_fixture_groups: PhononFixtureGroup[] = (() => {
  const by_material = new Map<string, string[]>()
  for (const key of loaders.keys()) {
    const material = key.replace(METHOD_SUFFIX, ``)
    by_material.set(material, [...(by_material.get(material) ?? []), key])
  }
  return [...by_material.entries()]
    .map(([material, keys]) => {
      const [, mp_id = ``, formula = material] =
        /^(?<mp_id>mp-\d+)-(?<formula>.+)$/.exec(material) ?? []
      return {
        material,
        keys: keys.toSorted((key_a, key_b) =>
          phonon_method_label(material, key_a).localeCompare(
            phonon_method_label(material, key_b),
          ),
        ),
        label: mp_id ? `${formula} (${mp_id})` : material,
      }
    })
    .toSorted((group_a, group_b) => group_a.label.localeCompare(group_b.label))
})()
