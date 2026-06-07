<!-- Render crystallographic symmetry elements (rotation/screw axes, mirror/glide
planes, inversion centers, rotoinversion axes) inside a Threlte scene. Elements come
from symmetry_elements_from_ops and are expressed in fractional coordinates of the cell
described by `lattice` — make sure both refer to the SAME cell (moyo operations are in
the input-cell frame, so pass the original structure's lattice).

Visual conventions (loosely following ITA diagram conventions: translation-carrying
elements are dashed/striped):
- rotation axes: solid cylinders, colored by order
- screw axes: DOTTED lines (small spheres along the axis, same order colors)
- mirror planes: solid translucent fills with opaque outlines
- glide planes: STRIPED translucent fills (stripes run along the glide-translation
  direction) with opaque outlines
- inversion centers / rotoinversion markers: spheres

For performance, geometries are merged per material group (one draw call per distinct
color/opacity instead of one mesh per element) and disposed on change/unmount. -->
<script lang="ts">
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import type { ShowSymmetryKinds, SymmetryElement } from './symmetry-elements'
  import {
    clip_line_to_cell,
    clip_plane_to_cell,
    dash_segments,
    DEFAULT_SHOW_SYM_KINDS,
    frac_to_cart_direction,
  } from './symmetry-elements'
  import { T } from '@threlte/core'
  import {
    BufferAttribute,
    BufferGeometry,
    ClampToEdgeWrapping,
    CylinderGeometry,
    DataTexture,
    DoubleSide,
    LinearFilter,
    Matrix4,
    Quaternion,
    RepeatWrapping,
    RGBAFormat,
    SphereGeometry,
    Vector3,
  } from 'three'
  import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

  let {
    elements = [],
    lattice,
    // Per-kind visibility. Defaults to rotation axes ONLY: drawing every kind at once
    // buries the structure under overlays for high-symmetry cells. Toggle additional
    // kinds individually (e.g. via SymmetryElementControls).
    show_kinds = DEFAULT_SHOW_SYM_KINDS,
    // hide 2-fold axes that are sub-elements of higher-order axes on the same line
    hide_redundant_axes = true,
    axis_radius = 0.04,
    // screw axes render as DOTTED lines: small spheres along the axis
    screw_dot_radius = 0.05,
    screw_dot_gap = 0.12, // Å gap between consecutive dots
    inversion_radius = 0.12,
    plane_opacity = 0.2,
    glide_opacity = 0.15,
    // opaque polygon outlines make overlapping translucent planes legible
    show_plane_edges = true,
    plane_edge_opacity = 0.9,
    // stripe period in Å for glide-plane fills (stripes run along the glide direction)
    glide_stripe_period = 0.7,
    axis_colors = { 2: `#e63946`, 3: `#2a9d8f`, 4: `#3a6fb0`, 6: `#9c27b0` },
    mirror_color = `#ffb703`,
    glide_color = `#8ecae6`,
    inversion_color = `#555555`,
  }: {
    elements?: SymmetryElement[]
    lattice: Matrix3x3
    show_kinds?: ShowSymmetryKinds
    hide_redundant_axes?: boolean
    axis_radius?: number
    screw_dot_radius?: number
    screw_dot_gap?: number
    inversion_radius?: number
    plane_opacity?: number
    glide_opacity?: number
    show_plane_edges?: boolean
    plane_edge_opacity?: number
    glide_stripe_period?: number
    axis_colors?: Record<number, string>
    mirror_color?: string
    glide_color?: string
    inversion_color?: string
  } = $props()

  const UP = new Vector3(0, 1, 0)
  const UNIT_SCALE = new Vector3(1, 1, 1)

  // 1D stripe alpha texture for glide fills (three.js alphaMap samples the GREEN
  // channel): ~55% full-alpha stripe, ~45% faint background so the plane stays
  // contiguous between stripes. Repeats along U; V is constant.
  const stripe_texture = (() => {
    const width = 16
    const data = new Uint8Array(width * 4)
    for (let px = 0; px < width; px++) {
      const val = px < 9 ? 255 : 56
      data.set([val, val, val, 255], px * 4)
    }
    const tex = new DataTexture(data, width, 1, RGBAFormat)
    tex.wrapS = RepeatWrapping
    tex.wrapT = ClampToEdgeWrapping
    tex.magFilter = LinearFilter
    tex.minFilter = LinearFilter
    tex.needsUpdate = true
    return tex
  })()

  // Key identifying the geometric line of an axis element (direction + intercept)
  const line_key = (elem: SymmetryElement): string => {
    const axis = elem.axis
    if (!axis) return ``
    const lambda = math.dot(elem.point, axis) / math.dot(axis, axis)
    const intercept = elem.point.map((val, idx) => val - lambda * axis[idx])
    return `${axis.join(`,`)}|${intercept.map((val) => val.toFixed(4)).join(`,`)}`
  }

  type MaterialGroup = {
    geometry: BufferGeometry
    color: string
    opacity?: number
    striped?: boolean
  }

  // Cylinder of given radius/length centered at `center` pointing along unit `dir`
  const oriented_cylinder = (
    center: Vector3,
    dir_unit: Vector3,
    radius: number,
    length: number,
  ): CylinderGeometry =>
    new CylinderGeometry(radius, radius, length, 12).applyMatrix4(
      new Matrix4().compose(
        center,
        new Quaternion().setFromUnitVectors(UP, dir_unit),
        UNIT_SCALE,
      ),
    )

  // Axes (cylinders) + rotoinversion center markers (spheres), merged per color/radius.
  // Pure rotations render solid; screw axes render DASHED so the two are
  // distinguishable at a glance (translation-carrying elements are dashed, as in ITA
  // diagrams).
  const axis_groups: MaterialGroup[] = $derived.by(() => {
    const axis_elements = elements.filter(
      (elem) =>
        (elem.kind === `rotation` || elem.kind === `screw` ||
          elem.kind === `rotoinversion`) &&
        show_kinds[elem.kind] && elem.axis,
    )
    // Drop 2-fold axes coincident with a higher-order axis (4 contains 2, 6 contains
    // 2 and 3, -4 contains 2, …) to reduce visual clutter. Computed over the VISIBLE
    // elements only, so 2-folds reappear when their enclosing higher-order kind is
    // toggled off.
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
      const span = new Vector3(...math.subtract(end, start))
      const length = span.length()
      if (length < 1e-6) continue
      const dir_unit = span.clone().normalize()
      const start_vec = new Vector3(...start)

      const color = axis_colors[elem.order] ?? `#777777`
      const group_key = `${color}|${elem.kind === `screw` ? `dot` : `solid`}`
      const group = parts_by_group.get(group_key) ?? []

      if (elem.kind === `screw`) {
        // Dotted line: spheres spaced along the axis, touching both cell faces
        for (
          const dot of dash_segments(length, 2 * screw_dot_radius, screw_dot_gap)
        ) {
          const center = start_vec.clone().addScaledVector(dir_unit, dot.center)
          group.push(
            new SphereGeometry(screw_dot_radius, 10, 10)
              .translate(center.x, center.y, center.z),
          )
        }
      } else {
        const center = start_vec.clone().addScaledVector(dir_unit, length / 2)
        group.push(oriented_cylinder(center, dir_unit, axis_radius, length))
      }
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

  // Mirror/glide plane FILLS: triangles concatenated per color+opacity into one
  // geometry. Glide fills carry per-vertex UVs whose U coordinate measures Cartesian
  // distance along the glide-translation direction, so the stripe alphaMap renders
  // stripes running along the glide direction — the pattern shows both that the plane
  // glides and where it translates.
  const plane_groups: MaterialGroup[] = $derived.by(() => {
    const groups = new Map<string, { positions: number[]; uvs: number[] }>()
    for (const elem of elements) {
      if ((elem.kind !== `mirror` && elem.kind !== `glide`) || !elem.axis) continue
      if (!show_kinds[elem.kind]) continue
      const polygon = clip_plane_to_cell(elem.point, elem.axis, lattice)
      if (polygon.length < 3) continue
      const striped = elem.kind === `glide` && elem.translation !== null
      const color = elem.kind === `mirror` ? mirror_color : glide_color
      const opacity = elem.kind === `mirror` ? plane_opacity : glide_opacity
      const group_key = `${color}|${opacity}|${striped ? 1 : 0}`
      const group = groups.get(group_key) ?? { positions: [], uvs: [] }
      // Stripe coordinate: Cartesian distance along the glide direction / period
      const stripe_dir = striped
        ? math.normalize_vec(
          frac_to_cart_direction(elem.translation as Vec3, lattice),
        )
        : null
      const stripe_u = (vert: Vec3): number =>
        stripe_dir ? math.dot(vert, stripe_dir) / glide_stripe_period : 0
      // Fan triangulation of the convex polygon
      for (let idx = 1; idx < polygon.length - 1; idx++) {
        for (const vert of [polygon[0], polygon[idx], polygon[idx + 1]]) {
          group.positions.push(...vert)
          group.uvs.push(stripe_u(vert), 0.5)
        }
      }
      groups.set(group_key, group)
    }
    return [...groups.entries()].map(([group_key, { positions, uvs }]) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(`position`, new BufferAttribute(new Float32Array(positions), 3))
      geometry.setAttribute(`uv`, new BufferAttribute(new Float32Array(uvs), 2))
      geometry.computeVertexNormals()
      const [color, opacity, striped] = group_key.split(`|`)
      return { geometry, color, opacity: Number(opacity), striped: striped === `1` }
    })
  })

  // Opaque plane OUTLINES (line segments per color): crisp borders keep overlapping
  // translucent planes individually legible instead of blending into a single wash.
  const plane_edge_groups: MaterialGroup[] = $derived.by(() => {
    if (!show_plane_edges) return []
    const segments_by_color = new Map<string, number[]>()
    for (const elem of elements) {
      if ((elem.kind !== `mirror` && elem.kind !== `glide`) || !elem.axis) continue
      if (!show_kinds[elem.kind]) continue
      const polygon = clip_plane_to_cell(elem.point, elem.axis, lattice)
      if (polygon.length < 3) continue
      const color = elem.kind === `mirror` ? mirror_color : glide_color
      const positions = segments_by_color.get(color) ?? []
      for (let idx = 0; idx < polygon.length; idx++) {
        positions.push(...polygon[idx], ...polygon[(idx + 1) % polygon.length])
      }
      segments_by_color.set(color, positions)
    }
    return [...segments_by_color.entries()].map(([color, positions]) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(`position`, new BufferAttribute(new Float32Array(positions), 3))
      return { geometry, color }
    })
  })

  // Inversion centers: spheres merged into a single geometry
  const inversion_group: MaterialGroup | null = $derived.by(() => {
    if (!show_kinds.inversion) return null
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
      ...plane_edge_groups.map((group) => group.geometry),
      ...(inversion_group ? [inversion_group.geometry] : []),
    ]
    return () => geometries.forEach((geo) => geo.dispose())
  })

  // Dispose the (non-reactive) stripe texture on unmount
  $effect(() => () => stripe_texture.dispose())
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
      alphaMap={group.striped ? stripe_texture : null}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

{#each plane_edge_groups as group, idx (idx)}
  <T.LineSegments geometry={group.geometry}>
    <T.LineBasicMaterial
      color={group.color}
      transparent={plane_edge_opacity < 1}
      opacity={plane_edge_opacity}
    />
  </T.LineSegments>
{/each}

{#if inversion_group}
  <T.Mesh geometry={inversion_group.geometry}>
    <T.MeshStandardMaterial color={inversion_group.color} />
  </T.Mesh>
{/if}
