import type { Vec3 } from '$lib/math'
import type { Slab } from '$lib/slab'
import { SlabBuilder } from '$lib/slab'
import type { Crystal } from '$lib/structure'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { bind_props, doc_query, make_crystal, make_rocksalt } from '../setup'

// oxfmt-ignore
const FACE_CENTRES: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
const fcc = (): Crystal =>
  make_crystal(
    3.615,
    FACE_CENTRES.map((abc) => ({ element: `Cu`, abc })),
  )

type BuilderState = {
  slab: Slab | null
  error: string | null
  miller_indices: Vec3
  termination_idx: number
}

describe(`SlabBuilder`, () => {
  let mounted: ReturnType<typeof mount> | null = null
  afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = null
    document.body.innerHTML = ``
  })

  const mount_builder = (structure: Crystal) => {
    const state = $state<BuilderState>({
      slab: null,
      error: null,
      miller_indices: [1, 1, 1],
      termination_idx: 0,
    })
    mounted = mount(SlabBuilder, {
      target: document.body,
      props: bind_props({ structure }, state),
    })
    flushSync()
    return state
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
    // rocksalt (111) alternates Na and Cl planes, so it has two distinct terminations
    const built = mount_builder(make_rocksalt())
    const options = doc_query(`.slab-builder select`).querySelectorAll(`option`)
    expect(options).toHaveLength(2)
    const first_formula = built.slab?.slab_info.termination.formula
    built.termination_idx = 1
    flushSync()
    expect(built.slab?.slab_info.termination).toEqual(built.slab?.slab_info.terminations[1])
    expect(built.slab?.slab_info.termination.formula).not.toBe(first_formula)
  })

  test(`changing the surface resets the termination to the first one`, () => {
    const built = mount_builder(make_rocksalt())
    built.termination_idx = 1
    flushSync()
    expect(built.termination_idx).toBe(1)
    built.miller_indices = [1, 0, 0]
    flushSync()
    expect(built.termination_idx).toBe(0)
    expect(built.slab?.slab_info.miller_indices).toEqual([1, 0, 0])
  })

  test(`reassigning equal miller indices keeps the picked termination`, () => {
    const built = mount_builder(make_rocksalt())
    built.termination_idx = 1
    built.miller_indices = [1, 1, 1]
    flushSync()
    expect(built.termination_idx).toBe(1)
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
