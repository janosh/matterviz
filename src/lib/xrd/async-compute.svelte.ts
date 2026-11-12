// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// compute_xrd_pattern and compute_saed_pattern via persistent Web Workers (main-thread fallback
// without Worker), plus what needs the main thread's symmetry worker: calc-xrd.ts stays free
// of Svelte for the worker bundles.
import type { Matrix3x3 } from '#lib/math.js'
import type { RadiationType } from '#lib/scattering/index.js'
import type { AnyStructure, Crystal } from '#lib/structure/index.js'
import { is_crystal } from '#lib/structure/validation.js'
import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/analyze.js'
import { create_worker_client } from '#lib/worker-client.svelte.js'
import { compute_xrd_pattern } from './calc-xrd'
import type { XrdPattern } from './index'
import { compute_saed_pattern } from './saed'

// Site properties can hold values structured clone rejects, and no diffraction kernel reads them
const build_payload = ({ lattice, sites }: Crystal): Crystal =>
  $state.snapshot({ lattice, sites: sites.map((site) => ({ ...site, properties: {} })) })

export const compute_xrd_pattern_async = create_worker_client({
  label: `XRD`,
  create_worker: () =>
    new Worker(new URL(`./xrd-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_xrd_pattern,
  build_payload,
})

export const compute_saed_pattern_async = create_worker_client({
  label: `SAED`,
  create_worker: () =>
    new Worker(new URL(`./saed-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_saed_pattern,
  build_payload,
})

// symprec in Å. Tight on purpose: a loose one can merge reflections of different intensity,
// a too tight one only splits families.
const XRD_SYMPREC = 1e-5

// Point-group rotations for options.symmetry_rotations (async: moyo-wasm init)
export async function xrd_symmetry_rotations(structure: Crystal): Promise<Matrix3x3[]> {
  const { operations } = await analyze_structure_symmetry(structure, { symprec: XRD_SYMPREC })
  return point_group_rotations(operations)
}

// Pattern of a dropped structure, with its point group merging equivalent reflections.
// Throws for anything without a lattice and sites.
export async function structure_xrd_pattern(
  structure: AnyStructure,
  wavelength: number | null, // Probe wavelength in Angstrom, null for the radiation's default
  radiation: RadiationType = `xray`,
): Promise<XrdPattern> {
  if (!is_crystal(structure)) {
    throw new Error(`Cannot compute XRD: structure must have a lattice and atomic sites`)
  }
  return compute_xrd_pattern_async(structure, {
    wavelength: wavelength ?? undefined,
    radiation,
    symmetry_rotations: await xrd_symmetry_rotations(structure),
  })
}
