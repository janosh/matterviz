// Extract phonon band structures and DOS from full phonon objects

import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  normalize_band_structure,
  type PhononBandStructure,
  type PhononDos,
} from '$lib/spectral'
import type { Crystal } from '$lib/structure'
import { SvelteMap } from 'svelte/reactivity'

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

type PhononData = {
  phonon_bandstructure?: RawPhononBandStructure
  phonon_dos?: PhononDos
  primitive?: Crystal
  structure?: Crystal
}

const METHOD_SUFFIX = /-(?:pbe|m3gnet|chgnet-v[\d.]+|mace-[\w-]+)$/

type PhononFixtureGroup = {
  material: string
  label: string
  keys: string[]
}

export const phonon_method_label = (material: string, key: string): string => {
  const method = key.slice(material.length + 1)
  if (method === `pbe`) return `DFT (PBE)`
  if (method === `m3gnet`) return `M3GNet`
  if (method.startsWith(`chgnet`)) return `CHGNet`
  if (method.startsWith(`mace`)) return `MACE`
  return method
}

// Import all phonon data files (uncompressed for dev, gzipped in git)
const raw_imports = import.meta.glob<PhononData>([`./*.json`, `./*.json.gz`], {
  eager: true,
  import: `default`,
})

// Extract filename without extension as the key
export const phonon_data: Record<string, PhononData> = {}
export const phonon_bands: Record<string, PhononBandStructure> = {}
export const phonon_dos: Record<string, PhononDos> = {}

for (const [path, data] of Object.entries(raw_imports)) {
  const id = /\/(?<id>[^/]+)\.json(?:\.gz)?$/.exec(path)?.[1] ?? path
  phonon_data[id] = data
  if (data.phonon_bandstructure) {
    const band_struct = normalize_band_structure(data.phonon_bandstructure)
    if (!band_struct) throw new Error(`${id}: phonon_bandstructure is not a band structure`)
    phonon_bands[id] = band_struct
  }
  if (data.phonon_dos) {
    phonon_dos[id] = data.phonon_dos
  }
}

// Group fixtures by material while preserving each calculation method as a selectable key.
export const phonon_fixture_groups: PhononFixtureGroup[] = (() => {
  const by_material = new SvelteMap<string, string[]>()
  for (const key of Object.keys(phonon_bands)) {
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
