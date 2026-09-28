import type { ElementSymbol } from '$lib/element'
import type { Site } from '$lib/structure'
import type { Vec3 } from '$lib/math'
import { css_to_linear_rgb } from '$lib/scene/colors'
import type { AtomColorField } from '$lib/structure/atom-color-field'
import { StructureCutawayGroup } from '$lib/structure/cutaway'
import { PartialAtoms, type PartialAtom } from '$lib/structure/partial-atoms'
import {
  compute_slice_geometry,
  merge_split_partial_sites,
} from '$lib/structure/partial-occupancy'
import type { BufferGeometry, Material } from 'three/webgpu'
import {
  CircleGeometry,
  Color,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'
import { describe, expect, test, vi } from 'vitest'

const make_site = (species: Site[`species`], xyz: Vec3, label: string): Site => ({
  species,
  abc: [0, 0, 0],
  xyz,
  properties: {},
  label,
})

describe(`partial occupancy render-site logic`, () => {
  test.each([
    {
      name: `merges split partial sites at identical coordinates`,
      sites: [
        make_site(
          [{ element: `O`, occu: 0.5, oxidation_state: 0 }],
          [1.234567, 2.345678, 3.456789],
          `O`,
        ),
        make_site(
          [{ element: `F`, occu: 0.5, oxidation_state: 0 }],
          [1.234567, 2.345678, 3.456789],
          `F`,
        ),
        make_site([{ element: `Mg`, occu: 1, oxidation_state: 0 }], [9, 9, 9], `Mg`),
      ],
      expected_count: 2,
      expected_merged_elements: [`F`, `O`],
    },
    {
      name: `does not merge full-occupancy single-species sites at same coordinates`,
      sites: [
        make_site([{ element: `Na`, occu: 1, oxidation_state: 0 }], [0, 0, 0], `Na1`),
        make_site([{ element: `Na`, occu: 1, oxidation_state: 0 }], [0, 0, 0], `Na2`),
      ],
      expected_count: 2,
      expected_merged_elements: null,
    },
    {
      name: `does not merge nearby split partial sites that differ by tiny coordinate offset`,
      sites: [
        make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0], `O`),
        make_site([{ element: `F`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0.000004], `F`),
      ],
      expected_count: 2,
      expected_merged_elements: null,
    },
  ])(`$name`, ({ sites, expected_count, expected_merged_elements }) => {
    const render_sites = merge_split_partial_sites(sites)
    expect(render_sites).toHaveLength(expected_count)
    if (!expected_merged_elements) return
    const merged_site = render_sites.find(
      (site_data) =>
        site_data.site.species.length === 2 &&
        site_data.site.species.some((species) => species.element === `O`) &&
        site_data.site.species.some((species) => species.element === `F`),
    )
    expect(merged_site).toBeDefined()
    if (!merged_site) throw new Error(`Expected merged O/F site to exist`)
    expect(merged_site.site.species.map((species) => species.element).toSorted()).toEqual(
      expected_merged_elements,
    )
  })

  // Grouping is a bucket lookup rather than a scan over every group, because this runs per
  // trajectory frame and the scan was quadratic (218 ms a frame at 8k sites, which hiding one
  // species of an alloy reaches at any count - that leaves one visible species summing under 1).
  // A bucket index can only match what shares a bucket, so the case to pin is a pair closer
  // than the merge tolerance that still rounds to opposite sides of a bucket face.
  test(`merges a coincident pair that straddles a lookup bucket boundary`, () => {
    const bucket = 1e-5 // MERGE_BUCKET_SIZE
    for (const n_buckets of [1, 2, 7, 1234]) {
      const face = n_buckets * bucket + bucket / 2 // exactly on a bucket face
      const sites = [
        make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [face - 1e-9, 0, 0], `O`),
        make_site([{ element: `F`, occu: 0.5, oxidation_state: 0 }], [face + 1e-9, 0, 0], `F`),
      ]
      const [merged, ...rest] = merge_split_partial_sites(sites)
      expect(rest).toEqual([]) // 2 Å apart in bucket terms, 2e-9 Å apart in real terms
      expect(merged.site.species.map((species) => species.element).toSorted()).toEqual([
        `F`,
        `O`,
      ])
    }
  })

  // Still O(n): the scan grew 4x per doubling, so 8k sites would blow far past this budget
  test(`groups 8k split-partial sites in linear time`, () => {
    const sites = Array.from({ length: 8000 }, (_unused, idx) =>
      make_site(
        [{ element: `Na`, occu: 0.5, oxidation_state: 0 }],
        [idx * 3, 0, 0],
        `Na${idx}`,
      ),
    )
    const start = performance.now()
    expect(merge_split_partial_sites(sites)).toHaveLength(8000)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe(`partial occupancy slice flags`, () => {
  test.each([
    {
      name: `single species with vacancy renders both caps`,
      site: make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0], `O`),
      expected_start: true,
      expected_end: true,
    },
    {
      name: `two species filling full sphere renders no caps`,
      site: make_site(
        [
          { element: `O`, occu: 0.5, oxidation_state: 0 },
          { element: `F`, occu: 0.5, oxidation_state: 0 },
        ],
        [0, 0, 0],
        `OF`,
      ),
      expected_start: false,
      expected_end: false,
    },
  ])(`$name`, ({ site, expected_start, expected_end }) => {
    const slices = compute_slice_geometry(site.species)
    expect(slices[0].render_start_cap).toBe(expected_start)
    expect(slices[slices.length - 1].render_end_cap).toBe(expected_end)
    for (const slice of slices) expect(slice.phi_length).toBeGreaterThan(0)
    for (let slice_idx = 1; slice_idx < slices.length; slice_idx += 1) {
      expect(slices[slice_idx].start_phi).toBeGreaterThanOrEqual(
        slices[slice_idx - 1].start_phi,
      )
      expect(slices[slice_idx].end_phi).toBeGreaterThanOrEqual(slices[slice_idx - 1].end_phi)
    }
  })

  test(`normalizes overfull occupancies to avoid wedge overflow`, () => {
    const slices = compute_slice_geometry([
      { element: `O`, occu: 0.8, oxidation_state: 0 },
      { element: `F`, occu: 0.8, oxidation_state: 0 },
    ])
    // 0.8 + 0.8 is rescaled to a full turn split evenly, with no vacancy caps and only the
    // half-gap (1e-3 / 2) trimmed off each wedge end
    expect(slices.map((slice) => slice.occupancy)).toEqual([0.5, 0.5])
    expect(slices.map((slice) => slice.render_start_cap)).toEqual([false, false])
    expect(slices.map((slice) => slice.render_end_cap)).toEqual([false, false])
    expect(slices[0].start_phi).toBeCloseTo(5e-4, 12)
    expect(slices[0].end_phi).toBeCloseTo(Math.PI - 5e-4, 12)
    expect(slices[1].start_phi).toBeCloseTo(Math.PI + 5e-4, 12)
    expect(slices[1].end_phi).toBeCloseTo(2 * Math.PI - 5e-4, 12)
  })
})

const species = (...entries: [ElementSymbol, number][]): Site[`species`] =>
  entries.map(([element, occu]) => ({ element, occu, oxidation_state: 0 }))
const palette: Partial<Record<ElementSymbol, string>> = {
  Fe: `#e06633`,
  Cu: `#c88033`,
  Au: `#ffd123`,
  Ni: `#50d050`,
  O: `red`,
  F: `#90e050`,
}
// Render records as StructureScene builds them: each site's wedges are consecutive
const to_partial_atoms = (
  sites: Site[`species`][],
  { shift = 0, is_image_atom = false } = {},
): PartialAtom[] =>
  sites.flatMap((site_species, site_idx) =>
    compute_slice_geometry(site_species).map((slice) => ({
      ...slice,
      site_idx,
      position: [site_idx * 2.5 - 3 + shift, 1.5, -4.25] as Vec3,
      radius: 1.1 + 0.1 * site_idx,
      color: palette[slice.element as ElementSymbol],
      is_image_atom,
    })),
  )
const wedge_sites = [
  species([`Fe`, 0.5]), // vacancy: both caps
  species([`Fe`, 0.5], [`Fe`, 0.5]), // mixed valence lists one element twice
  species([`Cu`, 0.3], [`Au`, 0.3], [`Ni`, 0.2]), // three wedges and vacancy caps
  species([`O`, 0.8], [`F`, 0.8]), // overfull, rescaled to a full turn
]
const meshes = (partial: PartialAtoms): InstancedMesh[] =>
  partial.children.filter((child) => child instanceof InstancedMesh)
// Instances each mesh draws, in slot order: wedges of its length, or every start/end cap
const expected_instances = (mesh: InstancedMesh, atoms: PartialAtom[]) => {
  const { geometry } = mesh
  if (geometry instanceof SphereGeometry)
    return atoms
      .filter(({ phi_length }) => Math.abs(phi_length - geometry.parameters.phiLength) < 1e-9)
      .map((atom) => ({ atom, phi: atom.start_phi }))
  return atoms.flatMap((atom) => [
    ...(atom.render_start_cap ? [{ atom, phi: atom.start_phi }] : []),
    ...(atom.render_end_cap ? [{ atom, phi: atom.end_phi }] : []),
  ])
}

describe(`PartialAtoms`, () => {
  // The previous renderer gave every wedge its own SphereGeometry(phiStart, phiLength) in a
  // Group(position, scale) and every cap a CircleGeometry rotated about Y inside that group
  test(`instance transforms reproduce the per-wedge sphere and cap vertices`, () => {
    const segments = 12
    const atoms = to_partial_atoms(wedge_sites)
    const partial = new PartialAtoms()
    partial.update(atoms, false, segments)
    const transformed = (geometry: BufferGeometry, matrix: Matrix4) => {
      const normal_matrix = new Matrix3().getNormalMatrix(matrix)
      const { position, normal } = geometry.attributes
      return Array.from({ length: position.count }, (_unused, idx) => [
        new Vector3().fromBufferAttribute(position, idx).applyMatrix4(matrix),
        new Vector3().fromBufferAttribute(normal, idx).applyMatrix3(normal_matrix).normalize(),
      ])
    }
    let [max_position_error, max_normal_error, n_instances] = [0, 0, 0]
    for (const mesh of meshes(partial)) {
      const expected = expected_instances(mesh, atoms)
      expect(mesh.count).toBe(expected.length)
      for (const [slot, { atom, phi }] of expected.entries()) {
        const { position, radius, start_phi, phi_length } = atom
        const is_cap = mesh.geometry instanceof CircleGeometry
        const old_matrix = new Matrix4()
          .makeScale(radius, radius, radius)
          .setPosition(...position)
        if (is_cap) old_matrix.multiply(new Matrix4().makeRotationY(phi))
        const old_geometry = is_cap
          ? new CircleGeometry(0.5, segments, Math.PI / 2, Math.PI)
          : new SphereGeometry(0.5, segments, segments, start_phi, phi_length)
        const instance_matrix = new Matrix4()
        mesh.getMatrixAt(slot, instance_matrix)
        const reference = transformed(old_geometry, old_matrix)
        const actual = transformed(mesh.geometry, instance_matrix)
        expect(actual).toHaveLength(reference.length)
        for (const [idx, [ref_position, ref_normal]] of reference.entries()) {
          const [act_position, act_normal] = actual[idx]
          max_position_error = Math.max(
            max_position_error,
            ref_position.distanceTo(act_position),
          )
          max_normal_error = Math.max(max_normal_error, ref_normal.distanceTo(act_normal))
        }
        n_instances++
      }
    }
    // 8 wedges + 4 caps (sites 0 and 2 each close a vacancy)
    expect(n_instances).toBe(12)
    // Float32 matrices and vertices round both sides at unit scale (translations here are
    // exact in f32): 2 ulp of 1 bounds it, measured 4.9e-8 (positions) and 6.6e-8 (normals)
    expect(max_position_error).toBeLessThan(2 ** -22)
    expect(max_normal_error).toBeLessThan(2 ** -22)
    partial.dispose()
  })

  test.each([2, 20, 2000])(`%i alloy sites draw with three meshes`, (n_sites) => {
    const alloy = species([`Cu`, 0.5], [`Au`, 0.5])
    const vacancy = species([`Cu`, 0.6])
    const sites = Array.from({ length: n_sites }, (_unused, idx) =>
      idx % 2 ? vacancy : alloy,
    )
    const partial = new PartialAtoms()
    partial.update(to_partial_atoms(sites), false, 12)
    // Shared wedge of length ~pi for both alloy species, one of 1.2 pi, and every cap
    expect(meshes(partial).map((mesh) => [mesh.geometry.type, mesh.count])).toEqual([
      [`SphereGeometry`, n_sites],
      [`SphereGeometry`, n_sites / 2],
      [`CircleGeometry`, n_sites],
    ])
    partial.dispose()
  })

  test(`updates buffers in place, grows, rebuilds tessellation and disposes once`, () => {
    const partial = new PartialAtoms()
    const disposals = new Map<{ dispose: () => void }, ReturnType<typeof vi.spyOn>>()
    const track = () => {
      for (const { geometry, material } of meshes(partial)) {
        for (const resource of [geometry, material as Material])
          if (!disposals.has(resource)) disposals.set(resource, vi.spyOn(resource, `dispose`))
      }
    }
    partial.update(to_partial_atoms(wedge_sites), false, 12)
    track()
    const [first, ...rest] = meshes(partial)
    const buffer = first.instanceMatrix.array
    const version = first.instanceMatrix.version
    // A trajectory frame moves atoms: same meshes and buffers, new translations uploaded
    partial.update(to_partial_atoms(wedge_sites, { shift: 0.25 }), false, 12)
    const uuids = (list: InstancedMesh[]) => list.map(({ uuid }) => uuid)
    expect(uuids(meshes(partial))).toEqual(uuids([first, ...rest]))
    expect(first.instanceMatrix.array).toBe(buffer)
    expect(first.instanceMatrix.version).toBeGreaterThan(version)
    expect(buffer[12]).toBe(Math.fround(-3 + 0.25))
    // More sites than capacity replace only the outgrown meshes; vanished buckets retire
    partial.update(to_partial_atoms([...wedge_sites, wedge_sites[0]]), false, 12)
    track()
    const grown = meshes(partial)
    expect(grown).not.toContain(first)
    expect(disposals.get(first.geometry)).toHaveBeenCalledOnce()
    partial.update(to_partial_atoms([wedge_sites[1]]), false, 12)
    expect(meshes(partial)).toHaveLength(1)
    // New tessellation rebuilds every geometry
    const [kept] = meshes(partial)
    partial.update(to_partial_atoms([wedge_sites[1]]), false, 20)
    track()
    expect(disposals.get(kept.geometry)).toHaveBeenCalledOnce()
    const [rebuilt] = meshes(partial)
    expect((rebuilt.geometry as SphereGeometry).parameters.widthSegments).toBe(20)
    partial.dispose()
    expect(partial.children).toEqual([])
    for (const spy of disposals.values()) expect(spy).toHaveBeenCalledOnce()
  })

  test(`per-instance colors follow palette, edit-mode ghosting and color field`, () => {
    const atoms = [
      ...to_partial_atoms([species([`Cu`, 0.5], [`Au`, 0.5])]),
      ...to_partial_atoms([species([`Fe`, 0.5], [`Ni`, 0.5])], { is_image_atom: true }).map(
        (atom) => ({ ...atom, site_idx: 1 }),
      ),
    ]
    const field: AtomColorField = {
      dims: [1, 1, 1],
      colors: new Float32Array([0, 0, 1, 0.25]),
      pbc: [true, true, true],
      cartesian_to_fractional: new Matrix4(),
    }
    const partial = new PartialAtoms()
    const rgb = (mesh: InstancedMesh, slot: number) =>
      mesh.getColorAt(slot, new Color()).toArray()
    const expected = (css: string | undefined, ghost: boolean, tint = 0) => {
      const color = new Color().setRGB(...css_to_linear_rgb(css ?? `#999999`))
      if (ghost) color.lerp(new Color(0x999999), 0.4)
      return color.lerp(new Color(0, 0, 1), tint).toArray()
    }
    for (const [ghost_images, color_field] of [
      [false, undefined],
      [true, undefined],
      [true, field],
    ] as const) {
      partial.update(atoms, ghost_images, 12, color_field)
      partial.set_opacity(0.8)
      const tint = color_field ? 0.25 : 0
      const [regular, ghosted = regular] = meshes(partial)
      expect(meshes(partial)).toHaveLength(ghost_images ? 2 : 1)
      expect(regular.material).toMatchObject({ opacity: 0.8, transparent: true })
      if (ghost_images) expect(ghosted.material).toMatchObject({ opacity: 0.4 })
      for (const [idx, atom] of atoms.entries()) {
        const ghost = ghost_images && atom.is_image_atom
        const actual = ghost ? rgb(ghosted, idx - 2) : rgb(regular, idx)
        const reference = expected(atom.color, ghost, tint)
        for (const [channel, value] of reference.entries())
          expect(Math.abs(actual[channel] - value)).toBeLessThan(2 ** -23)
      }
    }
    partial.set_opacity(0)
    expect(meshes(partial).map(({ material }) => material)).toMatchObject([
      { visible: false },
      { visible: false },
    ])
    partial.dispose()
  })

  test(`picks whole sites by their first wedge, at the poles and behind cutaways`, () => {
    const atoms = to_partial_atoms(wedge_sites)
    const partial = new PartialAtoms()
    const group = new StructureCutawayGroup()
    group.add(partial)
    partial.update(atoms, false, 12)
    const raycaster = new Raycaster()
    const pick = (origin: Vec3, direction: Vec3) => {
      raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize())
      return raycaster.intersectObject(group, true)
    }
    const site_2 = atoms[3].position
    const site_2_hits = pick([site_2[0], site_2[1], 10], [0, 0, -1])
    expect(site_2_hits.map(({ instanceId }) => instanceId)).toEqual([3])
    // A ray down the wedges' common pole axis, which lune triangles can miss
    const [center_x, center_y, center_z] = atoms[0].position
    const [pole_hit] = pick([center_x, 10, center_z], [0, -1, 0])
    expect(pole_hit).toMatchObject({ object: partial, instanceId: 0 })
    expect(pole_hit.distance).toBeCloseTo(10 - center_y - atoms[0].radius / 2, 12)
    raycaster.far = pole_hit.distance - 1e-6
    expect(raycaster.intersectObject(group, true)).toEqual([])
    raycaster.far = Infinity
    // Ghosted edit-mode images are not interactive
    const images = atoms.map((atom) => ({ ...atom, is_image_atom: atom.site_idx === 0 }))
    for (const ghost_images of [false, true]) {
      partial.update(images, ghost_images, 12)
      expect(pick([center_x, center_y, 10], [0, 0, -1])).toHaveLength(ghost_images ? 0 : 1)
    }
    partial.update(atoms, false, 12)
    // A cutaway through a vacancy plane leaves the cap behind the clipped front pickable, but
    // only on its own half: site 2's start cap spans -x of its center, its wedges +x
    const cartesian_to_fractional = new Matrix4()
    for (const [atom_idx, offset_x, cut_z, distance] of [
      [0, -0.1, 0.1, 5],
      [0, -0.1, -0.3, undefined],
      [0, -0.1, 5, 5 - Math.sqrt((atoms[0].radius / 2) ** 2 - 0.01)],
      [3, -0.1, 0.1, 5 - 0.1 * Math.tan(atoms[3].start_phi)],
      [3, 0.1, 0.1, undefined],
    ] as const) {
      const [site_x, site_y, site_z] = atoms[atom_idx].position
      const position = site_z + cut_z
      group.set_cutaway({
        mode: `plane`,
        axis: 2,
        thickness: 0,
        position,
        cartesian_to_fractional,
      })
      const hits = pick([site_x + offset_x, site_y, site_z + 5], [0, 0, -1])
      const expected_ids = distance === undefined ? [] : [atom_idx]
      expect(hits.map(({ instanceId }) => instanceId)).toEqual(expected_ids)
      if (distance !== undefined) expect(hits[0].distance).toBeCloseTo(distance, 12)
    }
    partial.dispose()
  })
})
