<script lang="ts">
  // A band structure's k-path in a reciprocal-space scene (Brillouin zone, Fermi surface) with
  // symmetry-point labels, hovered k-point and tinted hovered/highlighted segments. Hovering the
  // path or a label reports the nearer q-point index, so a band plot beside it can mark it.
  import type { Vec2, Vec3 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import type { ThreltePointerEvent } from '#lib/scene/index.js'
  import { write_bond_transform } from '#lib/structure/bond-rendering.js'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { untrack } from 'svelte'
  import { Color, CylinderGeometry, InstancedMesh, MeshStandardMaterial } from 'three/webgpu'
  import type { KPathLabel } from './types'
  import {
    bz_mark_sizes,
    k_path_point_index,
    k_path_segment_highlight,
    k_path_segments,
  } from './geometry'

  let {
    k_path_points,
    k_path_labels = [],
    hovered_k_point = null,
    highlighted_k_points = [],
    hovered_qpoint_index = null,
    highlighted_qpoint_range = null,
    on_kpath_hover,
    size,
    edge_width = 0,
  }: {
    k_path_points: Vec3[] // Cartesian k-points (Å⁻¹) along the path
    k_path_labels?: KPathLabel[]
    hovered_k_point?: Vec3 | null
    // Persistently marked k-points: their label chips are tinted
    highlighted_k_points?: Vec3[]
    hovered_qpoint_index?: number | null
    // First and last q-point index of a k-path stretch to tint, e.g. the hovered branch
    highlighted_qpoint_range?: Vec2 | null
    on_kpath_hover?: (qpoint_index: number | null) => void
    size: number // characteristic reciprocal-space size (k_space_size) the marks scale with
    edge_width?: number
  } = $props()

  const { invalidate } = useThrelte()
  const mark_sizes = $derived(bz_mark_sizes(size, edge_width))
  // Label chips are HTML drawn over the canvas and cover the sphere at their point, so a
  // highlighted point also tints its chip (tolerance scaled to the zone: positions come from
  // the same fold but may be recomputed by the caller)
  const is_highlighted = (position: Vec3) =>
    highlighted_k_points.some((point) => math.euclidean_dist(point, position) < 1e-6 * size)

  // One instanced mesh for all segments plus a wider invisible one for hover, instead of two
  // meshes (each with its own geometry and material) per segment: band paths run to hundreds
  // of segments.
  const k_path_segs = $derived(k_path_segments(k_path_points))
  const kpath_geometry = new CylinderGeometry(1, 1, 1, 8)
  const kpath_material = new MeshStandardMaterial() // white, tinted per instance
  // invisible but raycast: lets the cursor snap to the path within ~2× its radius
  const kpath_proxy_material = new MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const KPATH_COLORS = {
    base: new Color(`#ffcc00`),
    hover: new Color(`#ff6b35`),
    range: new Color(`#ff9a3c`),
  }
  $effect(() => () => {
    kpath_geometry.dispose()
    kpath_material.dispose()
    kpath_proxy_material.dispose()
  })
  let kpath_meshes = $state<{ line: InstancedMesh; proxy: InstancedMesh } | null>(null)
  $effect(() => {
    const [segments, radius] = [k_path_segs, mark_sizes.kpath]
    if (!segments.length) {
      kpath_meshes = null
      return
    }
    const line = new InstancedMesh(kpath_geometry, kpath_material, segments.length)
    const proxy = new InstancedMesh(kpath_geometry, kpath_proxy_material, segments.length)
    line.raycast = () => undefined
    // lets a host scene give path hovers priority over geometry in front (see FermiSurfaceScene)
    proxy.userData.kpath_proxy = true
    for (const mesh of [line, proxy]) mesh.frustumCulled = false
    for (const [instance_idx, { from, to }] of segments.entries()) {
      write_bond_transform(line.instanceMatrix.array, instance_idx, from, to, radius)
      write_bond_transform(proxy.instanceMatrix.array, instance_idx, from, to, radius * 2)
      line.setColorAt(instance_idx, KPATH_COLORS.base)
    }
    kpath_meshes = { line, proxy }
    return () => {
      line.dispose()
      proxy.dispose()
    }
  })
  // the (up to two) segments touching the hovered q-point, and the highlighted stretch
  $effect(() => {
    const [line, hovered, range] = [
      kpath_meshes?.line,
      hovered_qpoint_index,
      highlighted_qpoint_range,
    ]
    if (!line?.instanceColor) return
    for (const [instance_idx, { idx }] of untrack(() => k_path_segs).entries()) {
      const highlight = k_path_segment_highlight(idx, hovered, range) ?? `base`
      line.setColorAt(instance_idx, KPATH_COLORS[highlight])
    }
    line.instanceColor.needsUpdate = true
    invalidate()
  })

  // K-path hover: report the nearer endpoint's q-point index of the hovered segment
  function handle_kpath_hover({ point, instanceId }: ThreltePointerEvent): void {
    const segment = k_path_segs[instanceId ?? -1]
    if (!segment) return
    const { idx, from, to } = segment
    const cursor: Vec3 = [point.x, point.y, point.z]
    const nearer_from = math.euclidean_dist(cursor, from) <= math.euclidean_dist(cursor, to)
    on_kpath_hover?.(nearer_from ? idx : idx + 1)
  }
</script>

{#if kpath_meshes}
  <T is={kpath_meshes.line} dispose={false} />
  <T
    is={kpath_meshes.proxy}
    dispose={false}
    onpointermove={handle_kpath_hover}
    onpointerleave={() => on_kpath_hover?.(null)}
  />
{/if}

<!-- Symmetry point spheres + labels at labeled k-path points -->
{#each k_path_labels as { position, label }, idx (`${label}-${idx}`)}
  {#if label}
    {@const highlighted = is_highlighted(position)}
    <!-- hovering a label reports its q-point, like hovering the path there -->
    {@const qpoint_idx = k_path_point_index(k_path_points, position, 1e-6 * size)}
    <T.Mesh position={[position[0], position[1], position[2]]}>
      <T.SphereGeometry args={[mark_sizes.sym_point, 16, 16]} />
      <T.MeshStandardMaterial color="#ffcc00" metalness={0.3} roughness={0.7} />
    </T.Mesh>
    <extras.HTML center position={position.map((coord) => coord * 1.1) as Vec3}>
      <span
        role="presentation"
        style:background={highlighted ? `#ff2020` : `rgba(0, 0, 0, 0.3)`}
        style:font-weight={highlighted ? `bold` : null}
        style="padding: 0 3px; border-radius: 2px; color: white"
        onpointerenter={() => qpoint_idx !== -1 && on_kpath_hover?.(qpoint_idx)}
        onpointerleave={() => qpoint_idx !== -1 && on_kpath_hover?.(null)}
      >
        {label}
      </span>
    </extras.HTML>
  {/if}
{/each}

<!-- Hovered k-point highlight -->
{#if hovered_k_point}
  <T.Mesh position={hovered_k_point}>
    <T.SphereGeometry args={[mark_sizes.hovered_point, 16, 16]} />
    <T.MeshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1.2} />
  </T.Mesh>
{/if}
