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
  import { Color, CylinderGeometry, InstancedMesh, MeshStandardMaterial } from 'three/webgpu'
  import type { KPathLabel } from './types'
  import { bz_mark_sizes, k_path_segments } from './geometry'

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
    highlighted_k_points?: Vec3[]
    hovered_qpoint_index?: number | null
    highlighted_qpoint_range?: Vec2 | null
    on_kpath_hover?: (qpoint_index: number | null) => void
    size: number // characteristic reciprocal-space size (k_space_size) the marks scale with
    edge_width?: number
  } = $props()

  const { invalidate } = useThrelte()
  const mark_sizes = $derived(bz_mark_sizes(size, edge_width))
  // Same k-point, with a tolerance scaled to the zone: positions come from the same fold but
  // may be recomputed by the caller
  const same_point = (point_a: Vec3, point_b: Vec3) =>
    math.euclidean_dist(point_a, point_b) < 1e-6 * size

  // One instanced mesh for all segments plus a wider invisible one for hover, instead of two
  // meshes per segment: band paths run to hundreds of segments.
  const k_path_segs = $derived(k_path_segments(k_path_points))
  const kpath_geometry = new CylinderGeometry(1, 1, 1, 8)
  const kpath_material = new MeshStandardMaterial() // white, tinted per instance
  // never drawn but still raycast: lets the cursor snap to the path within ~2× its radius
  const kpath_proxy_material = new MeshStandardMaterial({ visible: false })
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
  const kpath_meshes = $derived.by(() => {
    const [count, radius] = [k_path_segs.length, mark_sizes.kpath]
    const line = new InstancedMesh(kpath_geometry, kpath_material, count)
    const proxy = new InstancedMesh(kpath_geometry, kpath_proxy_material, count)
    line.raycast = () => undefined
    // lets a host scene give path hovers priority over geometry in front (see FermiSurfaceScene)
    proxy.userData.kpath_proxy = true
    for (const mesh of [line, proxy]) mesh.frustumCulled = false
    for (const [instance_idx, { from, to }] of k_path_segs.entries()) {
      write_bond_transform(line.instanceMatrix.array, instance_idx, from, to, radius)
      write_bond_transform(proxy.instanceMatrix.array, instance_idx, from, to, radius * 2)
    }
    return { line, proxy }
  })
  $effect(() => {
    const { line, proxy } = kpath_meshes
    return () => {
      line.dispose()
      proxy.dispose()
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
      line.setColorAt(instance_idx, KPATH_COLORS[color])
    }
    if (line.instanceColor) line.instanceColor.needsUpdate = true
    invalidate()
  })

  // K-path hover: report the nearer endpoint's q-point index of the hovered segment. Threlte
  // sends a pointer move to every segment along the ray, near to far (at joints, or where the
  // path crosses itself on screen), so only the first, nearest one answers.
  let last_move: PointerEvent | null = null
  function handle_kpath_hover({ point, instanceId, nativeEvent }: ThreltePointerEvent): void {
    if (nativeEvent === last_move) return
    last_move = nativeEvent
    const segment = k_path_segs[instanceId ?? -1]
    if (!segment) return
    const { idx, from, to } = segment
    const cursor: Vec3 = [point.x, point.y, point.z]
    const nearer_from = math.euclidean_dist(cursor, from) <= math.euclidean_dist(cursor, to)
    on_kpath_hover?.(nearer_from ? idx : idx + 1)
  }
</script>

{#if k_path_segs.length}
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
    <!-- Label chips are HTML over the canvas and cover their sphere, so a highlighted point
    tints its chip, and hovering one reports its q-point like hovering the path there -->
    {@const highlighted = highlighted_k_points.some((point) => same_point(point, position))}
    {@const qpoint_idx = k_path_points.findIndex((point) => same_point(point, position))}
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
