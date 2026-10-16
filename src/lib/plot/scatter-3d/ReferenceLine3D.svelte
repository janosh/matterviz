<script lang="ts">
  // ReferenceLine3D: 3D reference lines for axis-parallel, segments, and extended lines
  // Uses Line2 for proper variable-width lines (GPU APIs ignore linewidth on basic lines)
  import type { Point3D, Vec2, Vec3 } from '#lib/math.js'
  import { T } from '@threlte/core'
  import * as THREE from 'three/webgpu'
  import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
  import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
  import { range_bounds } from '#lib/plot/core/interactions.js'
  import { create_to_threejs, span_or } from '#lib/plot/scatter-3d/scene-coords.js'
  import type { RefLine3D } from '#lib/plot/core/types.js'

  let {
    ref_line,
    ranges,
  }: {
    ref_line: RefLine3D
    ranges: { x: Vec2; y: Vec2; z: Vec2 }
  } = $props()

  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)
  const to_coords = $derived(create_to_threejs(ranges))
  const endpoints_from = (point_a: Vec3, point_b: Vec3): [Point3D, Point3D] => [
    to_coords(...point_a),
    to_coords(...point_b),
  ]

  let endpoints = $derived.by((): [Point3D, Point3D] | null => {
    if (ref_line.visible === false) return null
    const [x_min, x_max] = span_or(ref_line.x_span, x_range)
    const [y_min, y_max] = span_or(ref_line.y_span, y_range)
    const [z_min, z_max] = span_or(ref_line.z_span, z_range)

    if (ref_line.type === `x-axis`) {
      return endpoints_from([x_min, ref_line.y, ref_line.z], [x_max, ref_line.y, ref_line.z])
    }
    if (ref_line.type === `y-axis`) {
      return endpoints_from([ref_line.x, y_min, ref_line.z], [ref_line.x, y_max, ref_line.z])
    }
    if (ref_line.type === `z-axis`) {
      return endpoints_from([ref_line.x, ref_line.y, z_min], [ref_line.x, ref_line.y, z_max])
    }
    if (ref_line.type === `segment`) return endpoints_from(ref_line.p1, ref_line.p2)
    const { type } = ref_line as { type: unknown }
    if (type !== `line`) throw new Error(`Unknown 3D ref line type ${JSON.stringify(type)}`)
    // `line`: extend the line through two points to the bounding box. Bounds are sorted so a
    // reversed axis range still contains the line.
    const { p1, p2 } = ref_line
    const delta = p2.map((coord, axis) => coord - p1[axis])
    const bounds = (
      [
        [x_min, x_max],
        [y_min, y_max],
        [z_min, z_max],
      ] as Vec2[]
    ).map(range_bounds)
    const at = (t_value: number) =>
      p1.map((coord, axis) => coord + t_value * delta[axis]) as Vec3
    // Line parameters where it crosses each pair of boundary planes, kept if inside the box
    const eps = 1e-6
    const valid_t = bounds
      .flatMap(([lo, hi], axis) =>
        delta[axis] === 0 ? [] : [lo, hi].map((bound) => (bound - p1[axis]) / delta[axis]),
      )
      .filter((t_value) =>
        at(t_value).every(
          (coord, axis) => coord >= bounds[axis][0] - eps && coord <= bounds[axis][1] + eps,
        ),
      )
    if (valid_t.length < 2) return null
    return endpoints_from(at(Math.min(...valid_t)), at(Math.max(...valid_t)))
  })

  let style = $derived({
    color: ref_line.style?.color ?? `white`,
    opacity: ref_line.style?.opacity ?? 1,
    width: ref_line.style?.width ?? 2,
    dashed: Boolean(ref_line.style?.dash),
  })

  // Line2NodeMaterial reads the screen size from the viewport: no resolution uniform to sync
  const line2 = $derived.by((): Line2 | null => {
    if (!endpoints) return null
    const [start, end] = endpoints
    const geometry = new LineGeometry()
    geometry.setPositions([start.x, start.y, start.z, end.x, end.y, end.z])
    const material = new THREE.Line2NodeMaterial({
      color: new THREE.Color(style.color).getHex(),
      linewidth: style.width,
      transparent: style.opacity < 1,
      opacity: style.opacity,
      dashed: style.dashed,
      dashSize: 0.3,
      gapSize: 0.1,
    })
    const line = new Line2(geometry, material)
    line.computeLineDistances() // Required for dashed lines
    return line
  })
  // Release each replaced line's GPU resources, and the last one on unmount
  $effect(() => {
    const line = line2
    return () => {
      line?.geometry.dispose()
      line?.material.dispose()
    }
  })
</script>

{#if line2}
  <T is={line2} />
{/if}
