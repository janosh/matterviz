<script lang="ts">
  // Everything the 3D chemical potential diagram draws inside its <Canvas>: camera, lights, the
  // domain hull with its pick meshes, the formula overlays and the axis/grid/label frame around
  // them. Sibling of StructureScene, BrillouinZoneScene and ScatterPlot3DScene — ChemPotDiagram3D
  // stays outside the canvas and owns the data, the control panes, the tooltip and the exports.
  import { format_num } from '$lib/labels'
  import type { Vec2, Vec3 } from '$lib/math'
  import type { AxisConfig3D, CameraProjection3D, DisplayConfig3D } from '$lib/plot/core/types'
  import { sanitize_html } from '$lib/sanitize'
  import { build_orbit_props, dispose_on_change, line_geometry, SceneCamera } from '$lib/scene'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps } from 'svelte'
  import { untrack } from 'svelte'
  import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three/webgpu'
  import { swizzle_to_render } from './compute'
  import type { ChemPotDomainLabel, ChemPotDomainRender, ChemPotHoverMesh } from './types'

  type OverlayGeometry = { geometry: BufferGeometry; color: string }

  let {
    render_domains,
    render_axis_scale,
    plot_elements,
    formal_chempots,
    x_axis,
    y_axis,
    z_axis,
    display,
    data_center,
    data_extent,
    camera_position,
    camera_target,
    camera_projection,
    orthographic_zoom,
    auto_rotate,
    orbit_controls = $bindable(undefined),
    hull_geometry,
    hull_opacity,
    domain_colors,
    edge_geometry,
    hover_meshes,
    on_domain_hover,
    on_domain_press,
    on_domain_leave,
    formula_meshes,
    formula_edges,
    show_formula_edges,
    domain_labels,
    label_scale,
    portal,
  }: {
    render_domains: ChemPotDomainRender[]
    render_axis_scale: Vec3 // per-rendered-axis stretch, in [X, Y, Z] order
    plot_elements: string[] // the three elements the axes carry, in data-axis order
    formal_chempots: boolean // prefixes the axis labels with a delta
    x_axis: AxisConfig3D
    y_axis: AxisConfig3D
    z_axis: AxisConfig3D
    display: DisplayConfig3D
    data_center: Vec3 // in render coordinates, as the backside tracking compares camera to it
    data_extent: number // scales tick/label offsets and the camera's far plane
    camera_position: Vec3
    camera_target: Vec3
    camera_projection: CameraProjection3D
    orthographic_zoom: number
    auto_rotate: number // speed; 0 disables auto-rotation
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`] // bindable
    hull_geometry: BufferGeometry | null // vertex-colored domain hull
    hull_opacity: number
    // Identity token only: mutated vertex color buffers can't be detected by on-demand
    // rendering, so the hull mesh is re-created whenever the color map changes.
    domain_colors: ReadonlyMap<string, string>
    edge_geometry: BufferGeometry // deduplicated domain boundary edges
    hover_meshes: ChemPotHoverMesh[]
    on_domain_hover: (mesh: ChemPotHoverMesh, event: unknown) => void
    on_domain_press: (mesh: ChemPotHoverMesh, event: unknown) => void
    on_domain_leave: (mesh: ChemPotHoverMesh) => void
    formula_meshes: OverlayGeometry[]
    formula_edges: OverlayGeometry[]
    show_formula_edges: boolean
    domain_labels: ChemPotDomainLabel[] // empty when labels are switched off
    label_scale: number // grows the domain labels with the camera's zoom
    portal?: HTMLElement // element the billboarded HTML labels are appended to
  } = $props()

  extras.interactivity()

  const swiz = $derived(swizzle_to_render(render_axis_scale))
  const projection_opacity = $derived(display.projection_opacity ?? 0.15)

  // Backside tracking: axes/ticks/labels render on the far side from the camera.
  // back[idx] = backside data coordinate value for data axis idx.
  let back = $state([0, 0, 0])
  // Outward offset signs for tick/label placement (away from the bounding box)
  let out_x = $state(-1) // sign for Three.js X (data axis 1) direction
  let out_y = $state(-1) // sign for Three.js Y (data axis 2) direction

  // Bounding box of all data points in DATA coordinates (before swizzle)
  const raw_data_bbox = $derived.by(() => {
    const pts = render_domains.flatMap((domain) => domain.points_3d)
    if (pts.length === 0) return { mins: [0, 0, 0], maxs: [1, 1, 1] }
    const mins = [Infinity, Infinity, Infinity]
    const maxs = [-Infinity, -Infinity, -Infinity]
    for (const pt of pts) {
      for (let dim = 0; dim < 3; dim++) {
        if (pt[dim] < mins[dim]) mins[dim] = pt[dim]
        if (pt[dim] > maxs[dim]) maxs[dim] = pt[dim]
      }
    }
    return { mins, maxs }
  })

  // Axis range controls are in swizzled axis order:
  // x-axis control -> data axis 1, y-axis control -> data axis 2, z-axis control -> data axis 0
  const data_bbox = $derived.by(() => {
    const mins = [...raw_data_bbox.mins]
    const maxs = [...raw_data_bbox.maxs]
    const range_by_data_axis: ([number | null, number | null] | undefined)[] = [
      z_axis.range,
      x_axis.range,
      y_axis.range,
    ]
    for (let axis_idx = 0; axis_idx < 3; axis_idx++) {
      const range = range_by_data_axis[axis_idx]
      if (!range) continue
      const [range_min, range_max] = range
      if (range_min !== null) mins[axis_idx] = range_min
      if (range_max !== null) maxs[axis_idx] = range_max
    }
    return { mins, maxs }
  })

  // Generate nice tick values for each data axis using D3
  function gen_ticks(min_val: number, max_val: number, count: number = 5): number[] {
    if (!isFinite(min_val) || !isFinite(max_val) || min_val === max_val) {
      return [min_val]
    }
    return scaleLinear().domain([min_val, max_val]).nice().ticks(count)
  }

  // Ticks in DATA coordinates for each of the 3 data axes
  const data_ticks = $derived([
    gen_ticks(data_bbox.mins[0], data_bbox.maxs[0]),
    gen_ticks(data_bbox.mins[1], data_bbox.maxs[1]),
    gen_ticks(data_bbox.mins[2], data_bbox.maxs[2]),
  ])

  // Niced ranges (from ticks) padded so the grid extends beyond the diagram.
  // For horizontal axes (0,1): pad both sides.
  // For vertical axis (2): use actual data range and round min down to an integer.
  const niced_range = $derived(
    [0, 1, 2].map((axis): Vec2 => {
      const ticks = data_ticks[axis]
      const lo = ticks[0]
      const hi = ticks.at(-1) ?? lo
      const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1
      if (axis === 2) {
        const min_data = data_bbox.mins[2]
        return [Math.floor(min_data), hi]
      }
      return [lo - step, hi + step]
    }),
  )

  const axis_colors = [`#e74c3c`, `#2ecc71`, `#3498db`] as const
  function chem_axis_label(data_axis: number): string {
    const el = plot_elements[data_axis]
    const prefix = formal_chempots ? `\u0394` : ``
    return `${prefix}\u03BC<sub>${el}</sub> <span class="axis-unit">(eV)</span>`
  }

  // Proportional offsets for tick marks and labels, scaled to data extent
  const tick_size = $derived(data_extent * 0.015)
  const tick_label_dist = $derived(data_extent * 0.04)
  const axis_label_dist = $derived(data_extent * 0.02)

  // Place axis label just past the outer end of the axis (the end closer to 0).
  // In isometric 3D, the end near 0 projects outward at the front edge of the
  // bounding box, while the negative end projects inward toward the center.
  const outer_end = (range: Vec2): number =>
    Math.abs(range[0]) <= Math.abs(range[1]) ? range[0] : range[1]
  // Direction from range center toward outer end (to extend the label beyond the grid)
  const outer_direction = (range: Vec2): number => {
    const end = outer_end(range)
    const mid = (range[0] + range[1]) / 2
    return end >= mid ? 1 : -1
  }

  // Grid/axis configuration for each data axis.
  // Axes, ticks, and labels are placed on the backside (far from camera)
  // matching ScatterPlot3DScene's dynamic backside tracking pattern.
  // Axis labels are indexed by data axis; the render axes they map to are z, x, y.
  const axis_labels = $derived([z_axis.label, x_axis.label, y_axis.label])

  const grid_config = $derived.by(() => {
    // Offsets live in data-axis space and nudge the two axes that aren't being drawn:
    // depth and horizontal ticks stand off along d2, vertical ones along d1.
    const tick_mark_offsets: Vec3[] = [
      [0, 0, out_y * tick_size],
      [0, 0, out_y * tick_size],
      [0, out_x * tick_size, 0],
    ]
    const tick_label_offsets: Vec3[] = [
      [0, out_x * tick_label_dist * 0.5, out_y * tick_label_dist],
      [0, 0, out_y * tick_label_dist],
      [0, out_x * tick_label_dist, 0],
    ]
    // A point at `value` along `axis`, with the other two axes parked on the backside
    const point = (axis: number, value: number, offset: Vec3 = [0, 0, 0]): Vec3 => {
      const coords = [back[0] + offset[0], back[1] + offset[1], back[2] + offset[2]]
      coords[axis] = value
      return swiz(coords[0], coords[1], coords[2])
    }

    return [0, 1, 2].map((axis) => {
      const ticks = data_ticks[axis]
      const range = niced_range[axis]
      const label_offset = tick_label_offsets[axis]
      const others = [0, 1, 2].filter((other) => other !== axis)

      return {
        axis,
        color: axis_colors[axis],
        label: axis_labels[axis] || chem_axis_label(axis),
        line_geom: line_geometry(point(axis, range[0]), point(axis, range[1])),
        // Axis label past the outer end of the axis (near 0, projects outward)
        label_pos: point(
          axis,
          outer_end(range) + outer_direction(range) * axis_label_dist,
          label_offset,
        ),
        tick_geoms: ticks.map((val) =>
          line_geometry(point(axis, val), point(axis, val, tick_mark_offsets[axis])),
        ),
        // One grid line per tick per other axis, sweeping that axis across its full range
        grid_geoms: ticks.flatMap((val) =>
          others.map((other) => {
            const [start, end] = [[...back], [...back]]
            start[axis] = val
            end[axis] = val
            start[other] = niced_range[other][0]
            end[other] = niced_range[other][1]
            return line_geometry(
              swiz(start[0], start[1], start[2]),
              swiz(end[0], end[1], end[2]),
            )
          }),
        ),
        tick_labels: ticks.map((val) => ({
          pos: point(axis, val, label_offset),
          text: format_num(val, `.3~g`),
        })),
      }
    })
  })

  dispose_on_change(() =>
    grid_config.flatMap((grid_item) => [
      grid_item.line_geom,
      ...grid_item.tick_geoms,
      ...grid_item.grid_geoms,
    ]),
  )

  const projection_planes = $derived.by(() => {
    const projections = display.projections
    if (!projections) return []
    const [r0, r1, r2] = niced_range
    const projection_scale = display.projection_scale ?? 0.5
    const [s0, s1, s2] = niced_range.map(([lo, hi]) => (hi - lo) * projection_scale)
    const mid = ([lo, hi]: Vec2) => (lo + hi) / 2
    // Each plane sits at the backside of the one axis it is normal to, centered on the others
    const planes: { key: string; pos: Vec3; rot: Vec3; size: Vec2; color: string }[] = [
      {
        key: `xy`,
        pos: swiz(mid(r0), mid(r1), back[2]),
        rot: [-Math.PI / 2, 0, 0],
        size: [s1, s0],
        color: `#5dade2`,
      },
      {
        key: `xz`,
        pos: swiz(mid(r0), back[1], mid(r2)),
        rot: [0, Math.PI / 2, 0],
        size: [s0, s2],
        color: `#58d68d`,
      },
      {
        key: `yz`,
        pos: swiz(back[0], mid(r1), mid(r2)),
        rot: [0, 0, 0],
        size: [s1, s2],
        color: `#f5b041`,
      },
    ]
    return planes.filter((plane) => projections[plane.key as keyof typeof projections])
  })

  const bounding_box_geometry = $derived.by(() => {
    const [r0, r1, r2] = niced_range
    const vertices = [
      swiz(r0[0], r1[0], r2[0]),
      swiz(r0[1], r1[0], r2[0]),
      swiz(r0[1], r1[1], r2[0]),
      swiz(r0[0], r1[1], r2[0]),
      swiz(r0[0], r1[0], r2[1]),
      swiz(r0[1], r1[0], r2[1]),
      swiz(r0[1], r1[1], r2[1]),
      swiz(r0[0], r1[1], r2[1]),
    ]
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]
    const positions: number[] = []
    for (const [start_idx, end_idx] of edges) {
      const start = vertices[start_idx]
      const end = vertices[end_idx]
      positions.push(start[0], start[1], start[2], end[0], end[1], end[2])
    }
    const geom = new BufferGeometry()
    geom.setAttribute(`position`, new Float32BufferAttribute(positions, 3))
    return geom
  })

  dispose_on_change(() => [bounding_box_geometry])

  // Update backside positions when camera crosses axis planes.
  // Only updates when sign changes to avoid triggering geometry recreation every frame.
  function update_backside(): void {
    const cam = orbit_controls?.object?.position
    if (!cam) return
    const [r0, r1, r2] = niced_range
    // swiz: data[0]→Z, data[1]→X, data[2]→Y
    const new_back_0 = cam.z > data_center[2] ? r0[0] : r0[1]
    const new_back_1 = cam.x > data_center[0] ? r1[0] : r1[1]
    const new_back_2 = cam.y > data_center[1] ? r2[0] : r2[1]
    if (back[0] !== new_back_0 || back[1] !== new_back_1 || back[2] !== new_back_2) {
      back = [new_back_0, new_back_1, new_back_2]
      out_x = cam.x > data_center[0] ? -1 : 1
      out_y = cam.y > data_center[1] ? -1 : 1
    }
  }

  $effect(() => {
    const controls = orbit_controls
    if (!controls) return
    controls.addEventListener(`change`, update_backside)
    untrack(() => update_backside())
    return () => controls.removeEventListener(`change`, update_backside)
  })

  // OrbitControls' own default sensitivities in both projections: build_orbit_props doubles the
  // orthographic wheel speed for the structure-viewer family, whose zoom_speed setting defaults
  // to half of one; undo that here so the diagram keeps the feel it was tuned with.
  const orbit_props = $derived(
    build_orbit_props({
      camera_projection,
      target: camera_target,
      rotate_speed: 1,
      zoom_speed: camera_projection === `orthographic` ? 0.5 : 1,
      zoom_to_cursor: false,
      pan_speed: 1,
      min_zoom: 0,
      max_zoom: Number.POSITIVE_INFINITY,
      auto_rotate,
      rotation_damping: 0,
    }),
  )
</script>

<!-- Orthographic (pymatgen's projection style) by default; the near plane clips in front of the
     camera, unlike the shared default that sits behind it -->
<SceneCamera
  {camera_projection}
  position={camera_position}
  fov={50}
  zoom={orthographic_zoom}
  near={0.1}
  ortho_near={0.1}
  far={data_extent * 10}
  {orbit_props}
  bind:orbit_controls
/>

<T.AmbientLight intensity={0.8} />
<T.DirectionalLight position={[1, 1, 1]} intensity={0.5} />

<!-- Vertex-colored hull for both plain and colored modes -->
{#if hull_geometry}
  {#key domain_colors}
    <T.Mesh geometry={hull_geometry}>
      <T.MeshBasicMaterial
        vertexColors
        transparent
        opacity={hull_opacity}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </T.Mesh>
  {/key}
{/if}

<!-- Domain boundary edges (wireframe on top of opaque fills) -->
<T.LineSegments geometry={edge_geometry}>
  <T.LineBasicMaterial color={0x333333} linewidth={1} />
</T.LineSegments>

<!-- Invisible pick meshes for per-phase hover tooltip -->
{#each hover_meshes as hover_mesh (hover_mesh.formula)}
  <T.Mesh
    geometry={hover_mesh.geometry}
    onpointerenter={(event: unknown) => on_domain_hover(hover_mesh, event)}
    onpointermove={(event: unknown) => on_domain_hover(hover_mesh, event)}
    onpointerdown={(event: unknown) => on_domain_press(hover_mesh, event)}
    onpointerleave={() => on_domain_leave(hover_mesh)}
  >
    <T.MeshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
  </T.Mesh>
{/each}

<!-- Formula overlay meshes (semi-transparent colored fill) -->
{#each formula_meshes as { geometry, color }, mesh_idx (mesh_idx)}
  <T.Mesh {geometry}>
    <T.MeshBasicMaterial
      color={new Color(color)}
      transparent
      opacity={0.13}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

<!-- Formula overlay edges (colored, thicker) -->
{#if show_formula_edges}
  {#each formula_edges as { geometry, color }, edge_idx (edge_idx)}
    <T.LineSegments {geometry}>
      <T.LineBasicMaterial color={new Color(color)} linewidth={2} />
    </T.LineSegments>
  {/each}
{/if}

{#each projection_planes as plane (`${plane.key}-${projection_opacity}`)}
  <T.Mesh position={plane.pos} rotation={plane.rot}>
    <T.PlaneGeometry args={plane.size} />
    <T.MeshBasicMaterial
      color={plane.color}
      opacity={projection_opacity}
      transparent
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

{#if display.show_bounding_box}
  <T.LineSegments geometry={bounding_box_geometry}>
    <T.LineBasicMaterial color="#666" opacity={0.6} transparent />
  </T.LineSegments>
{/if}

<!-- Axes, ticks, grid lines, and labels -->
{#each grid_config as gc (gc.axis)}
  {#if display.show_axes}
    <!-- Main axis line -->
    <T.Line geometry={gc.line_geom}>
      <T.LineBasicMaterial color={gc.color} linewidth={2} />
    </T.Line>
    <!-- Tick marks -->
    {#each gc.tick_geoms as tick_geom, tdx (tdx)}
      <T.Line geometry={tick_geom}>
        <T.LineBasicMaterial color={gc.color} />
      </T.Line>
    {/each}
  {/if}
  {#if display.show_grid}
    <!-- Grid lines -->
    {#each gc.grid_geoms as grid_geom, gdx (gdx)}
      <T.Line geometry={grid_geom}>
        <T.LineBasicMaterial color="#888" opacity={0.3} transparent />
      </T.Line>
    {/each}
  {/if}
  {#if display.show_axis_labels}
    <!-- Tick labels (billboarded, always face camera) -->
    {#each gc.tick_labels as tick, tick_idx (tick_idx)}
      <extras.HTML position={tick.pos} center {portal} zIndexRange={[1, 0]}>
        <span class="tick-label axis-tick-label">{tick.text}</span>
      </extras.HTML>
    {/each}
    <!-- Axis label -->
    <extras.HTML position={gc.label_pos} center {portal} zIndexRange={[1, 0]}>
      <span class="axis-label" style:color={gc.color}>{@html sanitize_html(gc.label)}</span>
    </extras.HTML>
  {/if}
{/each}

<!-- Domain labels -->
{#each domain_labels as domain (domain.formula)}
  <extras.HTML position={domain.position} center {portal} zIndexRange={[5, 5]}>
    <span
      class="domain-label"
      style:font-size="{(domain.label_font_size * label_scale).toFixed(1)}px"
    >
      {#each domain.segments as segment}
        <span class:formula-subscript={segment.subscript}>{segment.text}</span>
      {/each}
    </span>
  </extras.HTML>
{/each}

<style>
  :is(.axis-label, .tick-label) {
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  .axis-label {
    font: bold 13px sans-serif;
  }
  .axis-label :global(.axis-unit) {
    font-weight: 300;
    opacity: 0.7;
  }
  .tick-label {
    font-size: 10px;
    color: var(--text-color, #333);
  }
  .domain-label {
    font-family: sans-serif;
    color: var(--text-color, #333);
    opacity: 0.7;
    white-space: nowrap;
    pointer-events: none;
  }
  .formula-subscript {
    font-size: calc(11em / 12);
    vertical-align: -0.28em;
  }
</style>
