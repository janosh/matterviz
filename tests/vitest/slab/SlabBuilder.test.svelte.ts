import type { Vec3 } from '$lib/math'
import type { Slab } from '$lib/slab'
import { SlabBuilder } from '$lib/slab'
import type { Crystal } from '$lib/structure'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { doc_query, make_crystal } from '../setup'

// oxfmt-ignore
const FACE_CENTRES: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
const fcc = (): Crystal =>
  make_crystal(
    3.615,
    FACE_CENTRES.map((abc) => ({ element: `Cu`, abc })),
  )
// rocksalt (111) alternates Na and Cl planes, so it has two distinct terminations
// oxfmt-ignore
const EDGE_CENTRES: Vec3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]]
const rocksalt = (): Crystal =>
  make_crystal(5.64, [
    ...FACE_CENTRES.map((abc) => ({ element: `Na`, abc })),
    ...EDGE_CENTRES.map((abc) => ({ element: `Cl`, abc })),
  ])

describe(`SlabBuilder`, () => {
  let mounted: ReturnType<typeof mount> | null = null
  afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = null
    document.body.innerHTML = ``
  })

  const mount_builder = (structure: Crystal, initial_hkl: Vec3 = [1, 1, 1]) => {
    let slab = $state<Slab | null>(null)
    let error = $state<string | null>(null)
    let miller_indices = $state<Vec3>(initial_hkl)
    let termination_idx = $state(0)
    mounted = mount(SlabBuilder, {
      target: document.body,
      props: {
        structure,
        get slab() {
          return slab
        },
        set slab(val) {
          slab = val
        },
        get error() {
          return error
        },
        set error(val) {
          error = val
        },
        get miller_indices() {
          return miller_indices
        },
        set miller_indices(val) {
          miller_indices = val
        },
        get termination_idx() {
          return termination_idx
        },
        set termination_idx(val) {
          termination_idx = val
        },
      },
    })
    flushSync()
    return {
      get slab() {
        return slab
      },
      get error() {
        return error
      },
      get termination_idx() {
        return termination_idx
      },
      set termination_idx(val: number) {
        termination_idx = val
      },
      set miller_indices(val: Vec3) {
        miller_indices = val
      },
    }
  }

  test(`builds a slab on mount and reports its geometry`, () => {
    const built = mount_builder(fcc())
    expect(built.error).toBeNull()
    expect(built.slab?.slab_info.miller_indices).toEqual([1, 1, 1])
    expect(built.slab?.lattice.pbc).toEqual([true, true, false])
    const table = doc_query(`.slab-builder dl`).textContent
    expect(table).toContain(`Interplanar spacing d`)
    expect(table).toContain(`Terminations`)
    expect(doc_query(`.slab-builder select`).querySelectorAll(`option`)).toHaveLength(1)
  })

  test(`lists every distinct termination and rebuilds when one is picked`, () => {
    const built = mount_builder(rocksalt())
    const options = doc_query(`.slab-builder select`).querySelectorAll(`option`)
    expect(options).toHaveLength(2)
    const first_formula = built.slab?.slab_info.termination.formula
    built.termination_idx = 1
    flushSync()
    expect(built.slab?.slab_info.termination).toEqual(built.slab?.slab_info.terminations[1])
    expect(built.slab?.slab_info.termination.formula).not.toBe(first_formula)
  })

  test(`changing the surface resets the termination to the first one`, () => {
    const built = mount_builder(rocksalt())
    built.termination_idx = 1
    flushSync()
    expect(built.termination_idx).toBe(1)
    built.miller_indices = [1, 0, 0]
    flushSync()
    expect(built.termination_idx).toBe(0)
    expect(built.slab?.slab_info.miller_indices).toEqual([1, 0, 0])
  })

  test(`invalid Miller indices surface as an error instead of throwing`, () => {
    const built = mount_builder(fcc())
    built.miller_indices = [0, 0, 0]
    flushSync()
    expect(built.slab).toBeNull()
    expect(built.error).toContain(`do not define a plane`)
    expect(doc_query(`.slab-builder .error`).textContent).toContain(`do not define a plane`)
  })
})
