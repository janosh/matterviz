<script lang="ts">
  // Threlte scene of a Wulff shape: one opaque mesh per Miller family (so each takes its color
  // and its hovered facet lights up), all facet edges as one instanced cylinder mesh and
  // optional crystal axes.
  // Camera, lights and fitting follow BrillouinZoneScene (KSpaceCamera).
  import { bz_fit_extent, polyhedron_centroid } from '#lib/brillouin/geometry'
  import KSpaceCamera from '#lib/brillouin/KSpaceCamera.svelte'
  import PolyhedronMesh from '#lib/brillouin/PolyhedronMesh.svelte'
  import ReciprocalVectors from '#lib/brillouin/ReciprocalVectors.svelte'
  import type { Matrix3x3 } from '#lib/math'
  import * as math from '#lib/math'
  import type { SceneControlProps, ThreltePointerEvent } from '#lib/scene/index'
  import {
    dispose_on_change,
    scene_interactivity,
    scene_key_walk,
    scene_pointer,
  } from '#lib/scene/index'
  import { write_bond_transform } from '#lib/structure/bond-rendering'
  import { mark_pin, type TooltipPin } from '#lib/tooltip/pin.svelte'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    CylinderGeometry,
    type Group,
    InstancedMesh,
    MeshStandardMaterial,
  } from 'three/webgpu'
  import type { WulffDisplaySettings, WulffHover, WulffShapeData } from './types'
  import { WULFF_DEFAULTS } from './types'

  let {
    wulff,
    colors,
    lattice,
    surface_opacity = WULFF_DEFAULTS.surface_opacity,
    edge_color = WULFF_DEFAULTS.edge_color,
    edge_width = WULFF_DEFAULTS.edge_width,
    show_vectors = WULFF_DEFAULTS.show_vectors,
    camera_projection = WULFF_DEFAULTS.camera_projection,
    hovered = $bindable<WulffHover | null>(null),
    pin = mark_pin<WulffHover>(),
    width = 0,
    height = 0,
    ...scene_controls // camera/lighting/interaction props, handed to KSpaceCamera
  }: SceneControlProps &
    Partial<Omit<WulffDisplaySettings, `show_legend`>> & {
      wulff: WulffShapeData
      colors: string[] // per family, index-aligned with wulff.families
      lattice?: Matrix3x3 // rows a, b, c: drawn as crystal axes while show_vectors
      hovered?: WulffHover | null
      pin?: TooltipPin<WulffHover> // the host's, whose tooltip a click pins
      width?: number
      height?: number
    } = $props()

  const { set_camera_is_moving, touch_hover } = scene_interactivity({
    on_click: () => pin.toggle(hovered),
    on_empty_click: () => pin.unpin(),
    clear_hover: () => (hovered = null),
  })

  const radius = $derived(Math.max(...wulff.vertices.map((vert) => Math.hypot(...vert))))
  // Per family: its facets as one polyhedron, and which facet each fan triangle of
  // polyhedron_geometry belongs to (a facet with n corners makes n - 2 triangles, in order)
  const family_meshes = $derived(
    wulff.families.flatMap((_, family_idx) => {
      const facet_ids = wulff.facets.flatMap((facet, facet_idx) =>
        facet.family_idx === family_idx ? [facet_idx] : [],
      )
      if (facet_ids.length === 0) return []
      const faces = facet_ids.map((facet_idx) => wulff.facets[facet_idx].vertex_indices)
      const facet_of_triangle = facet_ids.flatMap((facet_idx, pos) =>
        Array.from({ length: faces[pos].length - 2 }, () => facet_idx),
      )
      return [{ family_idx, faces, facet_of_triangle }]
    }),
  )
  // Every edge in ONE InstancedMesh of a unit cylinder whose matrices are rewritten in place on
  // each energy edit: a mesh per edge remounted ~280 of them per slider tick (~0.9 s). Rebuilt
  // only when the edge count outgrows its power-of-two capacity; edges take no pointer events.
  const { invalidate } = useThrelte()
  const edge_geometry = new CylinderGeometry(1, 1, 1, 8)
  const edge_material = new MeshStandardMaterial()
  $effect(() => () => {
    edge_geometry.dispose()
    edge_material.dispose()
  })
  // the next power of two of the edge count, at least 16
  const edge_capacity = $derived(Math.max(16, 1 << (32 - Math.clz32(wulff.edges.length - 1))))
  const edge_mesh = $derived(
    Object.assign(new InstancedMesh(edge_geometry, edge_material, edge_capacity), {
      frustumCulled: false,
      raycast: () => undefined,
    }),
  )
  dispose_on_change(() => [edge_mesh])
  $effect(() => {
    const { vertices, edges } = wulff
    const buffer = edge_mesh.instanceMatrix.array
    for (const [idx, [from, to]] of edges.entries()) {
      write_bond_transform(buffer, idx, vertices[from], vertices[to], edge_width * radius)
    }
    edge_mesh.count = edges.length
    edge_mesh.instanceMatrix.needsUpdate = true
    edge_material.color.set(edge_color)
    invalidate()
  })

  // Crystal axes from the origin (the shape's center), each poking a fixed margin past the
  // shape's surface along its own direction, so a short axis never ends inside the shape
  const axes = $derived(
    lattice?.map((row) => {
      const unit = math.normalize_vec(row)
      const reach = Math.max(...wulff.vertices.map((vert) => math.dot(vert, unit)))
      return math.scale(unit, reach + 0.3 * radius)
    }) as Matrix3x3 | undefined,
  )
  let shape_group = $state<Group>()

  // Framing follows the lattice (a new example), not every energy edit, which would snap an
  // orbited camera back to the default view; it orbits the Wulff point, the origin
  const framing = $derived.by(() => {
    void lattice
    return untrack(() => ({
      size: radius,
      // the longest axis plus its label (ReciprocalVectors' 0.11 gap and some text)
      fit_extent: Math.max(
        bz_fit_extent(wulff.vertices, undefined),
        2.2 * Math.max(0, ...(axes ?? []).map((row) => Math.hypot(...row) + 0.15 * radius)),
      ),
    }))
  })

  const shown = $derived(pin.shown(hovered))
  // the hovered facet's first triangle in its family mesh, for PolyhedronMesh's highlight
  const lit_triangle = (mesh: (typeof family_meshes)[number]): number | null => {
    const miller = shown?.miller.join(`,`)
    const triangle = mesh.facet_of_triangle.findIndex(
      (facet_idx) => wulff.facets[facet_idx].miller.join(`,`) === miller,
    )
    return triangle === -1 ? null : triangle
  }

  const plane_mark = (facet_idx: number | undefined) =>
    facet_idx === undefined ? `` : `plane ${wulff.facets[facet_idx].miller.join(`,`)}`
  const hover_of = (facet_idx: number | undefined, event: ThreltePointerEvent) =>
    facet_idx === undefined
      ? null
      : {
          mark: plane_mark(facet_idx),
          miller: wulff.facets[facet_idx].miller,
          screen_position: { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY },
        }
  const mesh_events = (mesh: (typeof family_meshes)[number]) => {
    const facet_at = ({ faceIndex }: { faceIndex?: number | null }) =>
      faceIndex == null ? undefined : mesh.facet_of_triangle[faceIndex]
    return touch_hover(
      {
        onpointermove: (event: ThreltePointerEvent) =>
          (hovered = hover_of(facet_at(event), event)),
        onpointerleave: () => (hovered = null),
      },
      (event) => plane_mark(facet_at(event)),
    )
  }

  // Keyboard: the viewer root walks the facets, hovering each at its centroid
  const pointer_at = scene_pointer()
  const walk_hover = (facet_idx: number) => {
    const corners = wulff.facets[facet_idx].vertex_indices.map((idx) => wulff.vertices[idx])
    return hover_of(facet_idx, pointer_at(polyhedron_centroid(corners)))
  }
  scene_key_walk({
    // `wulff` reads undefined while the scene unmounts (the shape went pending or invalid) and
    // the viewer's live region still asks the walk for its current facet
    targets: () => (wulff ? wulff.facets.map((_, facet_idx) => facet_idx) : []),
    hover: (facet_idx) => (hovered = walk_hover(facet_idx)),
    leave: () => (hovered = null),
    click: (facet_idx) => pin.toggle(walk_hover(facet_idx)),
    label: (facet_idx) =>
      `Facet (${wulff.facets[facet_idx].miller.join(` `)}), ${facet_idx + 1} of ${wulff.facets.length}`,
  })
</script>

<KSpaceCamera
  {...scene_controls}
  {camera_projection}
  size={framing.size}
  fit_extent={framing.fit_extent}
  {width}
  {height}
  {set_camera_is_moving}
/>

<T.Group>
  <T.Group bind:ref={shape_group}>
    {#each family_meshes as mesh (mesh.family_idx)}
      <PolyhedronMesh
        polyhedron={{ vertices: wulff.vertices, faces: mesh.faces, edges: [] }}
        color={colors[mesh.family_idx]}
        opacity={surface_opacity}
        depth_write={surface_opacity >= 1}
        edge_width={0}
        hovered_face={lit_triangle(mesh)}
        {...mesh_events(mesh)}
      />
    {/each}
  </T.Group>
  {#if edge_width > 0}
    <T is={edge_mesh} dispose={false} />
  {/if}
  {#if show_vectors && axes}
    <!-- labels behind the shape hide -->
    <ReciprocalVectors
      k_lattice={axes}
      size={radius}
      labels={[`a`, `b`, `c`]}
      occlude={shape_group ? [shape_group] : false}
    />
  {/if}
</T.Group>
