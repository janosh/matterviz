<!-- Render crystallographic symmetry elements (rotation/screw axes, mirror/glide
planes, inversion centers, rotoinversion axes) inside a Threlte scene. Elements come
from symmetry_elements_from_ops and are expressed in fractional coordinates of the cell
described by `lattice` — make sure both refer to the SAME cell (moyo operations are in
the input-cell frame, so pass the original structure's lattice).

For performance, geometries are merged per material group (one draw call per distinct
color/opacity instead of one mesh per element) and disposed on change/unmount. -->
<script lang="ts">
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import type { SymmetryElement } from './symmetry-elements'
  import {
    clip_line_to_cell,
    clip_plane_to_cell,
    frac_to_cart_direction,
  } from './symmetry-elements'
  import { T } from '@threlte/core'
  import {
    BufferAttribute,
    BufferGeometry,
    CylinderGeometry,
    DoubleSide,
    Matrix4,
    Quaternion,
    SphereGeometry,
    Vector3,
  } from 'three'
  import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

  let {
    elements = [],
    lattice,
    show_axes = true,
    show_planes = true,
    show_inversion_centers = true,
    // hide 2-fold axes that are sub-elements of higher-order axes on the same line
    hide_redundant_axes = true,
    axis_radius = 0.04,
    screw_radius = 0.025,
    inversion_radius = 0.12,
    plane_opacity = 0.2,
    glide_opacity = 0.12,
    axis_colors = { 2: `#e63946`, 3: `#2a9d8f`, 4: `#3a6fb0`, 6: `#9c27b0` },
    mirror_color = `#ffb703`,
    glide_color = `#8ecae6`,
    inversion_color = `#555555`,
  }: {
    elements?: SymmetryElement[]
    lattice: Matrix3x3
    show_axes?: boolean
    show_planes?: boolean
    show_inversion_centers?: boolean
    hide_redundant_axes?: boolean
    axis_radius?: number
    screw_radius?: number
    inversion_radius?: number
    plane_opacity?: number
    glide_opacity?: number
    axis_colors?: Record<number, string>
    mirror_color?: string
    glide_color?: string
    inversion_color?: string
  } = $props()

  const UP = new Vector3(0, 1, 0)
  const UNIT_SCALE = new Vector3(1, 1, 1)

  // Key identifying the geometric line of an axis element (direction + intercept)
  const line_key = (elem: SymmetryElement): string => {
    const axis = elem.axis
    if (!axis) return ``
    const lambda = math.dot(elem.point, axis) / math.dot(axis, axis)
    const intercept = elem.point.map((val, idx) => val - lambda * axis[idx])
    return `${axis.join(`,`)}|${intercept.map((val) => val.toFixed(4)).join(`,`)}`
  }

  type MaterialGroup = { geometry: BufferGeometry; color: string; opacity?: number }

  // Axes (cylinders) + rotoinversion center markers (spheres), merged per color/radius
  const axis_groups: MaterialGroup[] = $derived.by(() => {
    if (!show_axes) return []
    const axis_elements = elements.filter(
      (elem) => [`rotation`, `screw`, `rotoinversion`].includes(elem.kind) && elem.axis,
    )
    // Drop 2-fold axes coincident with a higher-order axis (4 contains 2, 6 contains
    // 2 and 3, -4 contains 2, …) to reduce visual clutter
    const max_order_by_line = new Map<string, number>()
    for (const elem of axis_elements) {
      const key = line_key(elem)
      max_order_by_line.set(key, Math.max(max_order_by_line.get(key) ?? 0, elem.order))
    }

    const parts_by_group = new Map<string, BufferGeometry[]>()
    for (const elem of axis_elements) {
      if (
        hide_redundant_axes && elem.order < (max_order_by_line.get(line_key(elem)) ?? 0)
      ) continue
      const clipped = clip_line_to_cell(elem.point, elem.axis as Vec3, lattice)
      if (!clipped) continue
      const [start, end] = clipped
      const dir = new Vector3(...math.subtract(end, start))
      const length = dir.length()
      if (length < 1e-6) continue

      const radius = elem.kind === `screw` ? screw_radius : axis_radius
      const color = axis_colors[elem.order] ?? `#777777`
      const center = new Vector3(...math.scale(math.add(start, end), 0.5))
      const quat = new Quaternion().setFromUnitVectors(UP, dir.normalize())
      const cylinder = new CylinderGeometry(radius, radius, length, 12).applyMatrix4(
        new Matrix4().compose(center, quat, UNIT_SCALE),
      )
      const group_key = `${color}|${radius}`
      const group = parts_by_group.get(group_key) ?? []
      group.push(cylinder)
      if (elem.kind === `rotoinversion`) {
        const [cx, cy, cz] = frac_to_cart_direction(elem.point, lattice)
        group.push(new SphereGeometry(inversion_radius * 0.8, 16, 16).translate(cx, cy, cz))
      }
      parts_by_group.set(group_key, group)
    }

    return [...parts_by_group.entries()].flatMap(([group_key, geometries]) => {
      const merged = mergeGeometries(geometries)
      geometries.forEach((geo) => geo.dispose())
      return merged ? [{ geometry: merged, color: group_key.split(`|`)[0] }] : []
    })
  })

  // Mirror/glide planes: triangles concatenated per color+opacity into one geometry
  const plane_groups: MaterialGroup[] = $derived.by(() => {
    if (!show_planes) return []
    const triangles_by_group = new Map<string, number[]>()
    for (const elem of elements) {
      if ((elem.kind !== `mirror` && elem.kind !== `glide`) || !elem.axis) continue
      const polygon = clip_plane_to_cell(elem.point, elem.axis, lattice)
      if (polygon.length < 3) continue
      const color = elem.kind === `mirror` ? mirror_color : glide_color
      const opacity = elem.kind === `mirror` ? plane_opacity : glide_opacity
      const group_key = `${color}|${opacity}`
      const positions = triangles_by_group.get(group_key) ?? []
      // Fan triangulation of the convex polygon
      for (let idx = 1; idx < polygon.length - 1; idx++) {
        positions.push(...polygon[0], ...polygon[idx], ...polygon[idx + 1])
      }
      triangles_by_group.set(group_key, positions)
    }
    return [...triangles_by_group.entries()].map(([group_key, positions]) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(
        `position`,
        new BufferAttribute(new Float32Array(positions), 3),
      )
      geometry.computeVertexNormals()
      const [color, opacity] = group_key.split(`|`)
      return { geometry, color, opacity: Number(opacity) }
    })
  })

  // Inversion centers: spheres merged into a single geometry
  const inversion_group: MaterialGroup | null = $derived.by(() => {
    if (!show_inversion_centers) return null
    const spheres = elements
      .filter((elem) => elem.kind === `inversion`)
      .map((elem) => {
        const [cx, cy, cz] = frac_to_cart_direction(elem.point, lattice)
        return new SphereGeometry(inversion_radius, 16, 16).translate(cx, cy, cz)
      })
    if (spheres.length === 0) return null
    const merged = mergeGeometries(spheres)
    spheres.forEach((geo) => geo.dispose())
    return merged ? { geometry: merged, color: inversion_color } : null
  })

  // Dispose merged geometries when inputs change or the component unmounts
  $effect(() => {
    const geometries = [
      ...axis_groups.map((group) => group.geometry),
      ...plane_groups.map((group) => group.geometry),
      ...(inversion_group ? [inversion_group.geometry] : []),
    ]
    return () => geometries.forEach((geo) => geo.dispose())
  })
</script>

{#each axis_groups as group, idx (idx)}
  <T.Mesh geometry={group.geometry}>
    <T.MeshStandardMaterial color={group.color} />
  </T.Mesh>
{/each}

{#each plane_groups as group, idx (idx)}
  <T.Mesh geometry={group.geometry}>
    <T.MeshStandardMaterial
      color={group.color}
      transparent
      opacity={group.opacity}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

{#if inversion_group}
  <T.Mesh geometry={inversion_group.geometry}>
    <T.MeshStandardMaterial color={inversion_group.color} />
  </T.Mesh>
{/if}
