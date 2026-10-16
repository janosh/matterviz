<script lang="ts">
  // A band structure's k-path in a reciprocal-space scene (Brillouin zone, Fermi surface) with
  // symmetry-point labels, hovered k-point and tinted hovered/highlighted segments. Hovering the
  // path or a label reports the nearer q-point index, so a band plot beside it can mark it.
  import type { Point2D, Vec2, Vec3 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import { SceneLabel, type ThreltePointerEvent } from '#lib/scene/index.js'
  import { write_bond_transform } from '#lib/structure/bond-rendering.js'
  import { T, useThrelte } from '@threlte/core'
  import {
    Color,
    CylinderGeometry,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
  } from 'three/webgpu'
  import type { KPathData } from './types'
  import { bz_mark_sizes, k_path_segments, k_path_sym_points, KPATH_COLORS } from './geometry'

  let {
    path,
    hovered_k_point = null,
    highlighted_k_points = [],
    k_markers = [],
    hovered_qpoint_index = null,
    highlighted_qpoint_range = null,
    on_kpath_hover,
    size,
    edge_width = 0,
  }: {
    path: KPathData
    hovered_k_point?: Vec3 | null
    highlighted_k_points?: Vec3[]
    // small dots on the path, e.g. where it pierces a Fermi surface (FermiSurfaceBands)
    k_markers?: { position: Vec3; color: string }[]
    hovered_qpoint_index?: number | null
    highlighted_qpoint_range?: Vec2 | null
    on_kpath_hover?: (qpoint_index: number | null, screen_position?: Point2D) => void
    size: number // characteristic reciprocal-space size (k_space_size) the marks scale with
    edge_width?: number
  } = $props()

  const { invalidate } = useThrelte()
  // A caller spreading a fresh props object per hover re-runs every prop read: this stops it
  // before the meshes rebuild (which clears that hover)
  const stable_path = $derived(path)
  const mark_sizes = $derived(bz_mark_sizes(size, edge_width))
  // Same k-point, with a tolerance scaled to the zone: positions come from the same fold but
  // may be recomputed by the caller
  const same_point = (point_a: Vec3, point_b: Vec3) =>
    math.euclidean_dist(point_a, point_b) < 1e-6 * size
  const sym_points = $derived(k_path_sym_points(stable_path, 1e-6 * size))

  // One instanced mesh for all segments plus a wider invisible one for hover, instead of two
  // meshes per segment: band paths run to hundreds of segments.
  const k_path_segs = $derived(k_path_segments(stable_path))
  const kpath_geometry = new CylinderGeometry(1, 1, 1, 8)
  const kpath_material = new MeshStandardMaterial() // white, tinted per instance
  // never drawn but still raycast: lets the cursor snap to the path within ~2× its radius
  const kpath_proxy_material = new MeshStandardMaterial({ visible: false })
  // k_markers: unlit dots drawn over everything (sheets they sit on included), one instance
  // each, so markers that change per hover never compile a material
  const marker_geometry = new SphereGeometry(1, 12, 8)
  const marker_material = new MeshBasicMaterial({ depthTest: false, transparent: true })
  const tint = new Color() // setColorAt copies it
  const transform = new Matrix4()
  $effect(() => () => {
    kpath_geometry.dispose()
    kpath_material.dispose()
    kpath_proxy_material.dispose()
    marker_geometry.dispose()
    marker_material.dispose()
  })
  const kpath_meshes = $derived.by(() => {
    const [count, radius] = [k_path_segs.length, mark_sizes.kpath]
    const line = new InstancedMesh(kpath_geometry, kpath_material, count)
    const proxy = new InstancedMesh(kpath_geometry, kpath_proxy_material, count)
    line.raycast = () => undefined
    // path hovers win over the zone or Fermi sheets the path is drawn through (see front_hit)
    proxy.userData.pick_rank = 2 // above the IBZ wedge (1)
    for (const mesh of [line, proxy]) mesh.frustumCulled = false
    for (const [instance_idx, { from, to }] of k_path_segs.entries()) {
      write_bond_transform(line.instanceMatrix.array, instance_idx, from, to, radius)
      write_bond_transform(proxy.instanceMatrix.array, instance_idx, from, to, radius * 2)
    }
    return { line, proxy }
  })
  const marker_mesh = $derived.by(() => {
    const mesh = new InstancedMesh(marker_geometry, marker_material, k_markers.length)
    Object.assign(mesh, { renderOrder: 1000, frustumCulled: false, raycast: () => undefined })
    const radius = 2 * mark_sizes.kpath
    for (const [idx, { position, color }] of k_markers.entries()) {
      mesh.setMatrixAt(
        idx,
        transform.makeScale(radius, radius, radius).setPosition(...position),
      )
      mesh.setColorAt(idx, tint.set(color))
    }
    return mesh
  })
  $effect(() => {
    const mesh = marker_mesh
    return () => mesh.dispose()
  })
  // Threlte drops a replaced or unmounted mesh without a pointerleave, so a rebuild or unmount
  // while hovered clears the hover here, or the parent keeps a stale q-point. Null, as the old
  // index may name another k-point on the new path; the next pointer move reports the new one.
  let reported_qpoint: number | null = null
  const report_hover = (qpoint_idx: number | null, pointer?: PointerEvent) => {
    reported_qpoint = qpoint_idx
    on_kpath_hover?.(qpoint_idx, pointer && { x: pointer.clientX, y: pointer.clientY })
  }
  $effect(() => {
    const { line, proxy } = kpath_meshes
    return () => {
      line.dispose()
      proxy.dispose()
      if (reported_qpoint !== null) report_hover(null)
    }
  })
  // tint the (up to two) segments touching the hovered q-point, then the highlighted stretch
  // (e.g. the hovered path branch Γ→X)
  $effect(() => {
    const { line } = kpath_meshes
    const [hovered, range] = [hovered_qpoint_index, highlighted_qpoint_range]
    for (const [instance_idx, { idx }] of k_path_segs.entries()) {
      const is_hovered = hovered !== null && (idx === hovered || idx === hovered - 1)
      const in_stretch = range !== null && idx >= range[0] && idx < range[1]
      const color = is_hovered ? `hover` : in_stretch ? `range` : `base`
      line.setColorAt(instance_idx, tint.set(KPATH_COLORS[color]))
    }
    if (line.instanceColor) line.instanceColor.needsUpdate = true
    invalidate()
  })

  // K-path hover: report the nearer endpoint's q-point index of the hovered segment
  function handle_kpath_hover({ point, instanceId, nativeEvent }: ThreltePointerEvent): void {
    const segment = k_path_segs[instanceId ?? -1]
    if (!segment) return
    const { idx, from, to } = segment
    const cursor: Vec3 = [point.x, point.y, point.z]
    const nearer_from = math.euclidean_dist(cursor, from) <= math.euclidean_dist(cursor, to)
    report_hover(nearer_from ? idx : idx + 1, nativeEvent)
  }
</script>

{#if k_path_segs.length}
  <T is={kpath_meshes.line} dispose={false} />
  <T
    is={kpath_meshes.proxy}
    dispose={false}
    onpointermove={handle_kpath_hover}
    onpointerleave={() => report_hover(null)}
  />
{/if}

<!-- Symmetry point spheres + labels, one per distinct labeled k-point -->
{#each sym_points as { position, labels, qpoint_idx } (qpoint_idx)}
  <!-- Label chips are HTML over the canvas and cover their sphere, so a highlighted point
  tints its chip, and hovering one reports its q-point like hovering the path there. Otherwise
  light, so as not to blot out the surface behind, with a text shadow for legibility. -->
  {@const highlighted = highlighted_k_points.some((point) => same_point(point, position))}
  <T.Mesh position={[position[0], position[1], position[2]]}>
    <T.SphereGeometry args={[mark_sizes.sym_point, 16, 16]} />
    <T.MeshStandardMaterial color="#ffcc00" metalness={0.3} roughness={0.7} />
  </T.Mesh>
  <SceneLabel interactive center position={position.map((coord) => coord * 1.1) as Vec3}>
    <span
      role="presentation"
      class="sym-label"
      style:background={highlighted ? `#ff2020` : `rgba(0, 0, 0, 0.15)`}
      style:font-weight={highlighted ? `bold` : null}
      style="padding: 0 3px; border-radius: 2px; color: white; text-shadow: 0 0 2px rgba(0, 0, 0, 0.8)"
      onpointerenter={(event) => report_hover(qpoint_idx, event)}
      onpointerleave={() => report_hover(null)}
    >
      {labels.join(` | `)}
    </span>
  </SceneLabel>
{/each}

{#if k_markers.length}<T is={marker_mesh} dispose={false} />{/if}

<!-- Hovered k-point highlight -->
{#if hovered_k_point}
  <T.Mesh position={hovered_k_point}>
    <T.SphereGeometry args={[mark_sizes.hovered_point, 16, 16]} />
    <T.MeshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1.2} />
  </T.Mesh>
{/if}
