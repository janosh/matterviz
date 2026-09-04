<!-- Render crystallographic symmetry elements (rotation/screw axes, mirror/glide
planes, inversion centers, rotoinversion axes) inside a Threlte scene. Elements come
from symmetry_elements_from_ops and are expressed in fractional coordinates of the cell
described by `lattice` — make sure both refer to the SAME cell (moyo operations are in
the input-cell frame, so pass the original structure's lattice).

Visual conventions (loosely following ITA diagram conventions: translation-carrying
elements are dashed/striped):
- rotation axes: solid cylinders, colored by order
- screw axes: DASHED cylinders (short dashes, gaps narrower than dashes; same order
  colors, slightly thinner)
- mirror planes: solid translucent fills with opaque outlines
- glide planes: STRIPED translucent fills (stripes run along the glide-translation
  direction) with opaque outlines
- inversion centers / rotoinversion markers: small faceted octahedra — themselves
  centrosymmetric, and clearly distinct from the smooth spheres used for atoms

Sizes, opacities and colors are fixed below (colors in SYM_ELEM_COLORS, shared with the legend
swatches of SymmetryElementControls); the only runtime knob is which kinds to show.

For performance, geometries are merged per material group (one draw call per distinct
color/opacity instead of one mesh per element) and disposed on change/unmount. -->
<script lang="ts">
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { dispose_on_change, positions_geometry } from '$lib/scene/geometry.svelte'
  import { quaternion_from_direction } from '$lib/structure/geometry'
  import { polygon_edge_vertices, polygon_fan_vertices } from '$lib/structure/lattice-planes'
  import type { ShowSymmetryKinds, SymmetryElement } from './symmetry-elements'
  import {
    clip_line_to_cell,
    clip_plane_to_cell,
    dash_segments,
    DEFAULT_SHOW_SYM_KINDS,
    frac_to_cart_direction,
    SYM_ELEM_COLORS,
    tile_symmetry_elements,
  } from './symmetry-elements'

  import { T } from '@threlte/core'
  import { HTML } from '@threlte/extras'
  import {
    BufferAttribute,
    BufferGeometry,
    ClampToEdgeWrapping,
    CylinderGeometry,
    DataTexture,
    DoubleSide,
    LinearFilter,
    Matrix4,
    OctahedronGeometry,
    RepeatWrapping,
    RGBAFormat,
    Vector3,
  } from 'three/webgpu'
  import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

  const AXIS_RADIUS = 0.04
  const SCREW_RADIUS = 0.03
  // [dash, gap] in Å for dashed screw axes: gap narrower than dash so the line reads as
  // continuous-but-broken rather than sparse
  const SCREW_DASH: [number, number] = [0.25, 0.1]
  const INVERSION_RADIUS = 0.12
  const PLANE_OPACITY = 0.2
  const GLIDE_OPACITY = 0.15
  // opaque polygon outlines make overlapping translucent planes legible
  const PLANE_EDGE_OPACITY = 0.9
  // stripe period in Å for glide-plane fills (stripes run along the glide direction)
  const GLIDE_STRIPE_PERIOD = 0.7

  let {
    elements = [],
    lattice,
    tiling = [1, 1, 1],
    // Per-kind visibility. Defaults to rotation axes ONLY: drawing every kind at once
    // buries the structure under overlays for high-symmetry cells. Toggle additional
    // kinds individually (e.g. via SymmetryElementControls).
    show_kinds = DEFAULT_SHOW_SYM_KINDS,
  }: {
    elements?: SymmetryElement[]
    lattice: Matrix3x3
    // Unit cells the rendered structure spans along a/b/c. Elements repeat at every lattice
    // translation, so a tiled view draws them across the whole block (tile_symmetry_elements).
    tiling?: Vec3
    show_kinds?: ShowSymmetryKinds
  } = $props()

  // Everything below clips against the unit cube of `cell`, so the block's own cell vectors
  // plus block-frame elements extend the overlay over every tile
  let cell = $derived(math.scale_lattice_matrix(lattice, tiling))
  let tiling_result = $derived(
    tile_symmetry_elements(
      elements.filter((element) => show_kinds[element.kind]),
      tiling,
      lattice,
    ),
  )
  let tiled_elements = $derived(tiling_result.elements)

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
  ): CylinderGeometry => {
    const orientation = quaternion_from_direction(dir_unit.toArray() as Vec3)
    return new CylinderGeometry(radius, radius, length, 12).applyMatrix4(
      new Matrix4().compose(center, orientation, UNIT_SCALE),
    )
  }

  // Axes (cylinders) + rotoinversion center markers (spheres), merged per color/radius.
  // Pure rotations render solid; screw axes render DASHED so the two are
  // distinguishable at a glance (translation-carrying elements are dashed, as in ITA
  // diagrams).
  const axis_groups: MaterialGroup[] = $derived.by(() => {
    const axis_elements = tiled_elements.filter(
      (elem) =>
        (elem.kind === `rotation` || elem.kind === `screw` || elem.kind === `rotoinversion`) &&
        elem.axis,
    )
    // Drop axes that are sub-elements of a higher-order axis on the same line (4 contains 2,
    // 6 contains 2 and 3, -4 contains 2, …) to reduce visual clutter. Computed over the
    // VISIBLE elements only, so 2-folds reappear when their enclosing higher-order kind is
    // toggled off. Lines are identified by the lattice-invariant `locus` key: a
    // perpendicular-foot intercept would key lattice-equivalent parallel lines differently
    // in non-standard (primitive fcc, ...) frames and leave their sub-axes drawn.
    const max_order_by_line = new Map<string, number>()
    for (const elem of axis_elements) {
      const current = max_order_by_line.get(elem.locus) ?? 0
      max_order_by_line.set(elem.locus, Math.max(current, elem.order))
    }

    const parts_by_group = new Map<string, BufferGeometry[]>()
    for (const elem of axis_elements) {
      if (elem.order < (max_order_by_line.get(elem.locus) ?? 0)) continue
      const clipped = clip_line_to_cell(elem.point, elem.axis as Vec3, cell)
      if (!clipped) continue
      const [start, end] = clipped
      const span = new Vector3(...math.subtract(end, start))
      const length = span.length()
      if (length < 1e-6) continue
      const dir_unit = span.clone().normalize()
      const start_vec = new Vector3(...start)

      // Radius is baked into each geometry, so one merged group per color suffices
      const color = SYM_ELEM_COLORS.axis_by_order[elem.order] ?? `#777777`
      const group = parts_by_group.get(color) ?? []

      if (elem.kind === `screw`) {
        // Dashed cylinder: segments along the axis, touching both cell faces
        for (const dash of dash_segments(length, ...SCREW_DASH)) {
          const center = start_vec.clone().addScaledVector(dir_unit, dash.center)
          group.push(oriented_cylinder(center, dir_unit, SCREW_RADIUS, dash.length))
        }
      } else {
        const center = start_vec.clone().addScaledVector(dir_unit, length / 2)
        group.push(oriented_cylinder(center, dir_unit, AXIS_RADIUS, length))
      }
      if (elem.kind === `rotoinversion`) {
        const [cx, cy, cz] = frac_to_cart_direction(elem.point, cell)
        group.push(new OctahedronGeometry(INVERSION_RADIUS * 0.8).translate(cx, cy, cz))
      }
      parts_by_group.set(color, group)
    }

    return [...parts_by_group.entries()].flatMap(([color, geometries]) => {
      const merged = mergeGeometries(geometries)
      geometries.forEach((geo) => geo.dispose())
      return merged ? [{ geometry: merged, color }] : []
    })
  })

  // Visible mirror/glide planes clipped to the cell — computed once, shared by the
  // fill and outline groups below. stripe_dir is the unit Cartesian glide direction
  // (null for mirrors and translation-less entries).
  const visible_planes = $derived.by(() => {
    const planes: {
      polygon: Vec3[]
      color: string
      opacity: number
      stripe_dir: Vec3 | null
    }[] = []
    for (const elem of tiled_elements) {
      if ((elem.kind !== `mirror` && elem.kind !== `glide`) || !elem.axis) continue
      const polygon = clip_plane_to_cell(elem.point, elem.axis, cell)
      if (polygon.length < 3) continue
      const is_mirror = elem.kind === `mirror`
      planes.push({
        polygon,
        color: is_mirror ? SYM_ELEM_COLORS.mirror : SYM_ELEM_COLORS.glide,
        opacity: is_mirror ? PLANE_OPACITY : GLIDE_OPACITY,
        stripe_dir: elem.translation
          ? math.normalize_vec(frac_to_cart_direction(elem.translation, cell))
          : null,
      })
    }
    return planes
  })

  // Plane FILLS: triangles concatenated per color+opacity into one geometry. Glide
  // fills carry per-vertex UVs whose U coordinate measures Cartesian distance along
  // the glide-translation direction, so the stripe alphaMap renders stripes running
  // along the glide direction — the pattern shows both that the plane glides and
  // where it translates.
  const plane_groups: MaterialGroup[] = $derived.by(() => {
    const groups = new Map<string, { positions: number[]; uvs: number[] }>()
    for (const { polygon, color, opacity, stripe_dir } of visible_planes) {
      const group_key = `${color}|${opacity}|${stripe_dir ? 1 : 0}`
      const group = groups.get(group_key) ?? { positions: [], uvs: [] }
      // Stripe coordinate: Cartesian distance along the glide direction / period
      const stripe_u = (vert: Vec3): number =>
        stripe_dir ? math.dot(vert, stripe_dir) / GLIDE_STRIPE_PERIOD : 0
      for (const vert of polygon_fan_vertices(polygon)) {
        group.positions.push(...vert)
        group.uvs.push(stripe_u(vert), 0.5)
      }
      groups.set(group_key, group)
    }
    return [...groups.entries()].map(([group_key, { positions, uvs }]) => {
      const geometry = positions_geometry(positions)
      geometry.setAttribute(`uv`, new BufferAttribute(new Float32Array(uvs), 2))
      geometry.computeVertexNormals()
      const [color, opacity, striped] = group_key.split(`|`)
      return { geometry, color, opacity: Number(opacity), striped: striped === `1` }
    })
  })

  // Opaque plane OUTLINES (line segments per color): crisp borders keep overlapping
  // translucent planes individually legible instead of blending into a single wash.
  const plane_edge_groups: MaterialGroup[] = $derived.by(() => {
    const segments_by_color = new Map<string, number[]>()
    for (const { polygon, color } of visible_planes) {
      const positions = segments_by_color.get(color) ?? []
      positions.push(...polygon_edge_vertices(polygon).flat())
      segments_by_color.set(color, positions)
    }
    return [...segments_by_color.entries()].map(([color, positions]) => ({
      geometry: positions_geometry(positions),
      color,
    }))
  })

  // Inversion centers: faceted octahedra (centrosymmetric, unlike the smooth spheres
  // used for atoms) merged into a single geometry
  const inversion_group: MaterialGroup | null = $derived.by(() => {
    const markers = tiled_elements
      .filter((elem) => elem.kind === `inversion`)
      .map((elem) => {
        const [cx, cy, cz] = frac_to_cart_direction(elem.point, cell)
        return new OctahedronGeometry(INVERSION_RADIUS).translate(cx, cy, cz)
      })
    if (markers.length === 0) return null
    const merged = mergeGeometries(markers)
    markers.forEach((geo) => geo.dispose())
    return merged ? { geometry: merged, color: SYM_ELEM_COLORS.inversion } : null
  })

  // Dispose each group's merged geometries when that group recomputes or on unmount. One
  // $effect per group (rather than a single combined one): the deriveds recompute
  // independently — e.g. tweaking a plane-only prop rebuilds plane_groups but not
  // axis_groups — and a combined effect would dispose the still-mounted axis geometry.
  const geometries_of = (groups: MaterialGroup[]) => groups.map((group) => group.geometry)
  dispose_on_change(() => geometries_of(axis_groups))
  dispose_on_change(() => geometries_of(plane_groups))
  dispose_on_change(() => geometries_of(plane_edge_groups))
  dispose_on_change(() => [inversion_group?.geometry])

  // Dispose the (non-reactive) stripe texture on unmount
  $effect(() => () => stripe_texture.dispose())
</script>

{#if tiling_result.unavailable_reason}
  <HTML zIndexRange={[1000, 1000]}>
    <div
      role="status"
      style="background: var(--surface-bg, white); padding: 0.5em; width: 20em"
    >
      {tiling_result.unavailable_reason}
    </div>
  </HTML>
{/if}

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
    <T.LineBasicMaterial color={group.color} transparent opacity={PLANE_EDGE_OPACITY} />
  </T.LineSegments>
{/each}

{#if inversion_group}
  <T.Mesh geometry={inversion_group.geometry}>
    <T.MeshStandardMaterial color={inversion_group.color} />
  </T.Mesh>
{/if}
