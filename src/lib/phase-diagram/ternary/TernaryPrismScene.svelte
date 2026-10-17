<script lang="ts">
  // Inside the prism <Canvas>: the Gibbs triangle extruded along T, stable phases as rods over
  // their stability windows, tie-lines as the vertical sheets they sweep between transitions,
  // transition outlines and a draggable isothermal cutting plane carrying the current section.
  // Composition probes (pinned, or under the pointer) are vertical lines plus spokes to their
  // assemblage on the plane; a click on the plane without dragging pins one.
  // Nothing is rebuilt while dragging: rods/sheets are static and split at the plane by GPU
  // clipping planes; the section geometry is memoized on the (interval-constant) topology.
  import { get_formula_label_segments } from '#lib/composition/format.js'
  import { TRIANGLE_VERTICES } from '#lib/convex-hull/barycentric-coords.js'
  import { format_num } from '#lib/labels.js'
  import { clamp, type Vec2, type Vec3 } from '#lib/math.js'
  import { is_drag } from '#lib/plot/core/interactions.js'
  import type { ThreltePointerEvent } from '#lib/scene/index.js'
  import {
    build_orbit_props,
    dispose_on_change,
    HoverHighlight,
    scene_interactivity,
    scene_key_walk,
    scene_pointer,
    SceneCamera,
    SceneLabel,
    SceneLights,
  } from '#lib/scene/index.js'
  import { T, useThrelte } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import * as extras from '@threlte/extras'
  import { xy_to_ternary } from '#lib/plot/ternary/ternary.js'
  import { ticks as d3_ticks } from 'd3-array'
  import {
    BufferGeometry,
    ClippingGroup,
    CylinderGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Plane,
    SphereGeometry,
    Vector3,
  } from 'three/webgpu'
  import {
    decompose_composition,
    facet_index_at,
    hits_pin,
    prism_composition,
    prism_position,
  } from './compute'
  import type {
    IsothermalSection,
    PhaseTemperatureHover,
    SectionHover,
    TernaryDisplay,
    TernaryPhaseDiagram,
  } from './types'
  import { TERNARY_COLORS } from './types'

  let {
    diagram,
    section,
    settings,
    temperature = $bindable(),
    selected_phase = $bindable(null),
    hovered_phase = $bindable(null),
    pinned_composition = $bindable(null),
    pin_color = TERNARY_COLORS.pin,
    text_color = `#ddd`,
    on_hover,
    on_section_hover,
  }: {
    diagram: TernaryPhaseDiagram
    section: IsothermalSection
    settings: TernaryDisplay
    temperature: number
    selected_phase?: number | null
    hovered_phase?: number | null
    pinned_composition?: Vec2 | null // composition probe shared with the 2D section
    pin_color?: string // concrete colour (three.js can't parse var()/light-dark())
    text_color?: string
    on_hover?: (hover: PhaseTemperatureHover | null) => void
    on_section_hover?: (hover: SectionHover | null) => void // compositions on the plane
  } = $props()

  // Rods win the pick over the cutting plane, also where seen through it, and the drag catcher
  // wins over both (their pick_rank)
  const { set_hover_enabled, touch_hover } = scene_interactivity()

  // === Frame: composition in XZ (centred), temperature along Y ===

  const HEIGHT = 1.25
  const [t_min, t_max] = $derived(diagram.t_range)
  const y_of = (temp: number) => ((temp - t_min) / (t_max - t_min) - 0.5) * HEIGHT
  const t_of = (y_pos: number) => (y_pos / HEIGHT + 0.5) * (t_max - t_min) + t_min
  const at_t = (coords_xy: readonly number[], temp: number): Vec3 =>
    prism_position(coords_xy, y_of(temp))
  const corners = TRIANGLE_VERTICES
  const cycle = (idx: number) => corners[(idx + 1) % 3]

  function buffer_geom(flat: number[], index?: number[]): BufferGeometry {
    const geom = new BufferGeometry().setAttribute(
      `position`,
      new Float32BufferAttribute(flat, 3),
    )
    if (index) geom.setIndex(index).computeVertexNormals()
    return geom
  }
  const memo = <Input, Output>(build: (input: Input) => Output) => {
    let last: [Input, Output] | undefined
    return (input: Input): Output => {
      if (last?.[0] !== input) last = [input, build(input)]
      return last[1]
    }
  }

  // === Static geometry ===

  const wire_geometry = buffer_geom(
    corners.flatMap((corner, idx) => [
      ...at_t(corner, t_min),
      ...at_t(cycle(idx), t_min),
      ...at_t(corner, t_max),
      ...at_t(cycle(idx), t_max),
      ...at_t(corner, t_min),
      ...at_t(corner, t_max),
    ]),
  )
  const plane_geometry = buffer_geom(
    corners.flatMap((corner) => prism_position(corner)),
    [0, 1, 2],
  )
  const unit_cylinder = new CylinderGeometry(1, 1, 1, 10)
  const unit_sphere = new SphereGeometry(1, 12, 12)
  const event_ring_geometry = $derived(
    buffer_geom(
      diagram.events.flatMap(({ temperature: temp }) =>
        corners.flatMap((corner, idx) => [...at_t(corner, temp), ...at_t(cycle(idx), temp)]),
      ),
    ),
  )
  // Each tie-line lives from the transition that creates it to the one that removes it and
  // sweeps a vertical quad over that interval
  const sheet_geometry = $derived.by(() => {
    const key = ([idx_a, idx_b]: Vec2) => `${idx_a}-${idx_b}`
    const open = new Map<string, { edge: Vec2; start: number }>()
    const positions: number[] = []
    const index: number[] = []
    const close = ({ edge, start }: { edge: Vec2; start: number }, end: number) => {
      const [xy_a, xy_b] = [diagram.phases[edge[0]].xy, diagram.phases[edge[1]].xy]
      const base = positions.length / 3
      positions.push(
        ...at_t(xy_a, start),
        ...at_t(xy_b, start),
        ...at_t(xy_b, end),
        ...at_t(xy_a, end),
      )
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    for (const edge of diagram.sections[0]?.edges ?? [])
      open.set(key(edge), { edge, start: t_min })
    for (const event of diagram.events) {
      for (const edge of event.edges_removed) {
        const alive = open.get(key(edge))
        if (alive) close(alive, event.temperature)
        open.delete(key(edge))
      }
      for (const edge of event.edges_added)
        open.set(key(edge), { edge, start: event.temperature })
    }
    for (const alive of open.values()) close(alive, t_max)
    return buffer_geom(positions, index)
  })
  const rods = $derived(
    diagram.phases.flatMap(({ idx, xy: coords_xy, is_element }) =>
      diagram.stability_windows[idx].map(([lower, upper], window_idx) => ({
        key: `${idx}-${window_idx}`,
        phase: idx,
        position: prism_position(coords_xy, (y_of(lower) + y_of(upper)) / 2),
        length: y_of(upper) - y_of(lower),
        is_element,
      })),
    ),
  )

  // === Cutting plane and the section riding on it ===

  const plane_y = $derived(y_of(temperature))
  // Clipping split: at the plane while ghosting, else above everything
  const split_y = $derived(settings.ghost_above_plane ? plane_y : y_of(t_max) + 1)
  const below_plane = new Plane(new Vector3(0, -1, 0), 0) // keeps y <= split_y
  const above_plane = new Plane(new Vector3(0, 1, 0), 0) // keeps y >= split_y
  const { invalidate } = useThrelte()
  $effect(() => {
    below_plane.constant = split_y
    above_plane.constant = -split_y
    invalidate() // on-demand rendering sees no prop change when a plane mutates in place
  })
  const build_facets = memo((facets: number[][]) =>
    buffer_geom(
      facets.flatMap((facet) =>
        facet.flatMap((idx) => prism_position(diagram.phases[idx].xy)),
      ),
      facets.flatMap((_, idx) => [3 * idx, 3 * idx + 1, 3 * idx + 2]),
    ),
  )
  const build_tie_lines = memo((edges: Vec2[]) =>
    buffer_geom(
      edges.flatMap(([idx_a, idx_b]) => [
        ...prism_position(diagram.phases[idx_a].xy),
        ...prism_position(diagram.phases[idx_b].xy),
      ]),
    ),
  )
  const build_points = memo((stable: number[]) =>
    stable.map((idx) => {
      const [x_pos, , z_pos] = prism_position(diagram.phases[idx].xy)
      return {
        phase: idx,
        position: [x_pos, 0, z_pos] as Vec3,
        label_position: [x_pos, 0.035, z_pos] as Vec3,
        segments: get_formula_label_segments(diagram.phases[idx].label),
        is_element: diagram.phases[idx].is_element,
      }
    }),
  )
  const facet_geometry = $derived(build_facets(section.facets))
  const tie_line_geometry = $derived(build_tie_lines(section.edges))
  const section_points = $derived(build_points(section.stable))
  dispose_on_change(() => [wire_geometry, plane_geometry, unit_cylinder, unit_sphere])
  // One call per derived geometry: a shared call would dispose a sibling still in use
  dispose_on_change(() => [event_ring_geometry])
  dispose_on_change(() => [sheet_geometry])
  dispose_on_change(() => [facet_geometry])
  dispose_on_change(() => [tie_line_geometry])

  // === Composition probes ===

  let hover_xy = $state<Vec2 | null>(null)
  // Facets are constant between transitions: no spoke rebuild while only T moves
  const section_facets = $derived(section.facets)
  const probe_of = (coords_xy: Vec2 | null) => {
    if (!coords_xy) return null
    const decomposition = decompose_composition(diagram, { facets: section_facets }, coords_xy)
    const position = prism_position(coords_xy)
    const spokes = buffer_geom(
      (decomposition?.phases ?? []).flatMap((idx) => [
        ...position,
        ...prism_position(diagram.phases[idx].xy),
      ]),
    )
    return { position, spokes, decomposition }
  }
  const pinned_probe = $derived(probe_of(pinned_composition))
  const hover_probe = $derived(probe_of(hover_xy))
  // the tie triangle under the pointer lights up while its decomposition shows
  const hover_facet = $derived(
    hover_xy ? facet_index_at(diagram.phases, section_facets, hover_xy) : -1,
  )
  dispose_on_change(() => [pinned_probe?.spokes])
  dispose_on_change(() => [hover_probe?.spokes])
  const probe_marks = $derived(
    [
      { kind: `pinned`, probe: pinned_probe, color: pin_color, radius: 0.005 },
      { kind: `hover`, probe: hover_probe, color: text_color, radius: 0.0025 },
    ].flatMap(({ probe, ...mark }) => (probe ? [{ ...probe, ...mark }] : [])),
  )

  const color_of = (phase: number, is_element: boolean) =>
    phase === selected_phase
      ? TERNARY_COLORS.selected
      : phase === hovered_phase
        ? TERNARY_COLORS.highlight
        : is_element
          ? TERNARY_COLORS.element
          : TERNARY_COLORS.stable
  const rod_radius = (phase: number) =>
    phase === selected_phase || phase === hovered_phase ? 0.0126 : 0.007

  // Labels: temperature ticks up the left edge, elements past the bottom corners
  const tick_pos = (temp: number) =>
    prism_position([corners[2][0] - 0.07, corners[2][1] - 0.04], y_of(temp))
  const corner_labels = $derived(
    diagram.elements.map((element, idx) => {
      const [x_pos, , z_pos] = prism_position(corners[idx])
      const len = Math.hypot(x_pos, z_pos) || 1
      return {
        element,
        position: [
          x_pos * (1 + 0.07 / len),
          y_of(t_min) - 0.03,
          z_pos * (1 + 0.07 / len),
        ] as Vec3,
      }
    }),
  )

  // === Interaction ===

  let camera_is_moving = false
  let dragging_plane = $state(false)
  // A release that never strayed from a plane press (is_drag) pins the pressed composition
  let press: { client: Vec2; coords_xy: Vec2 | null; moved: boolean } | null = null
  const PIN_HIT_RADIUS = 0.025 // triangle units: a click this close to the pin removes it
  const clear_plane_hover = () => {
    if (!hover_xy) return
    hover_xy = null
    on_section_hover?.(null)
  }
  const orbit_props = build_orbit_props({
    camera_projection: `perspective`,
    target: [0, 0, 0],
    rotate_speed: 1.5,
    zoom_speed: 1.5,
    zoom_to_cursor: false,
    pan_speed: 1,
    min_zoom: 0.2,
    max_zoom: 30,
    auto_rotate: 0,
    rotation_damping: 0,
    set_camera_is_moving: (moving) => {
      camera_is_moving = moving
      set_hover_enabled(!moving)
      if (moving) {
        hover_xy = null
        on_hover?.(null)
      }
    },
  })
  let orbit_controls = $state<ComponentProps<typeof extras.OrbitControls>[`ref`]>()
  const pointer_of = (event: unknown) => event as ThreltePointerEvent

  function handle_rod_hover(phase: number, event: unknown): void {
    if (camera_is_moving || dragging_plane) return
    const { point, nativeEvent } = pointer_of(event)
    hovered_phase = phase
    on_hover?.({
      phase,
      temperature: clamp(t_of(point.y), t_min, t_max),
      position: [nativeEvent.clientX, nativeEvent.clientY],
    })
  }
  const leave_rod = () => {
    hovered_phase = null
    on_hover?.(null)
  }
  const click_rod = (phase: number) =>
    (selected_phase = selected_phase === phase ? null : phase)
  const rod_handlers = (phase: number) => ({
    ...touch_hover({
      onpointerenter: (event: unknown) => handle_rod_hover(phase, event),
      onpointermove: (event: unknown) => handle_rod_hover(phase, event),
      onpointerleave: leave_rod,
      onclick: () => click_rod(phase),
      // a press on a rod still drags the plane, but pins nothing
      onpointerdown: start_plane_drag,
    }),
    userData: { pick_rank: 1 },
  })
  // The viewer root walks the rods in phase order, each where the cutting plane crosses it,
  // else at its nearer end; Enter selects like a click
  const pointer_at = scene_pointer()
  scene_key_walk({
    targets: () => (settings.show_rods ? rods : []),
    hover: ({ phase, position: [x_pos, y_pos, z_pos], length }) =>
      handle_rod_hover(
        phase,
        pointer_at([x_pos, clamp(plane_y, y_pos - length / 2, y_pos + length / 2), z_pos]),
      ),
    leave: leave_rod,
    click: ({ phase }) => click_rod(phase),
    hovered: ({ phase }) => phase === hovered_phase,
    label: ({ phase }) => diagram.phases[phase].label,
  })
  // Dragging the plane pauses orbiting; a camera-facing catcher quad turns pointer motion
  // into a new height (temperature)
  // A release can land far from the press without any move reaching the scene (a flick out
  // of the canvas), so its own distance counts too
  const end_plane_drag = (event?: PointerEvent) => {
    const click_xy =
      event?.type === `pointerup` && press && !press.moved && !is_drag(press.client, event)
        ? press.coords_xy
        : null
    if (click_xy) {
      const on_pin = hits_pin(pinned_composition, click_xy, PIN_HIT_RADIUS)
      pinned_composition = on_pin ? null : click_xy
    }
    press = null
    dragging_plane = false
    if (orbit_controls) orbit_controls.enabled = true
    for (const type of [`pointerup`, `pointercancel`] as const)
      globalThis.removeEventListener(type, end_plane_drag)
  }
  function start_plane_drag(event: unknown): void {
    const { nativeEvent, point } = pointer_of(event)
    if (nativeEvent.button !== 0) return // right/middle button orbit and pan
    press = {
      client: [nativeEvent.clientX, nativeEvent.clientY],
      coords_xy: hovered_phase === null ? prism_composition(point) : null,
      moved: false,
    }
    dragging_plane = true
    if (orbit_controls) orbit_controls.enabled = false
    hover_xy = null
    on_hover?.(null)
    for (const type of [`pointerup`, `pointercancel`] as const)
      globalThis.addEventListener(type, end_plane_drag)
  }
  $effect(() => end_plane_drag) // a view switch mid-drag must not leave global listeners
  const drag_plane = (event: unknown) => {
    if (!dragging_plane || !press) return
    const { point, nativeEvent } = pointer_of(event)
    press.moved ||= is_drag(press.client, nativeEvent)
    if (press.moved) temperature = clamp(t_of(point.y), t_min, t_max)
  }
  function hover_plane(event: unknown): void {
    if (dragging_plane) return drag_plane(event)
    if (camera_is_moving) return
    const { point, nativeEvent } = pointer_of(event)
    hover_xy = prism_composition(point)
    on_section_hover?.(
      hover_xy && {
        kind: `composition`,
        barycentric: xy_to_ternary(hover_xy),
        decomposition: hover_probe?.decomposition ?? null,
        position: [nativeEvent.clientX, nativeEvent.clientY],
      },
    )
  }
</script>

{#snippet html_label(position: Vec3, text: string, class_name: string, z_lo: number)}
  <SceneLabel {position} center zIndexRange={[z_lo, 0]}>
    <span class={class_name}>{text}</span>
  </SceneLabel>
{/snippet}

<SceneCamera
  camera_projection="perspective"
  position={[1.95, 1.25, 2.1]}
  fov={40}
  near={0.05}
  far={50}
  {orbit_props}
  bind:orbit_controls
/>
<SceneLights
  ambient={0.9}
  directional={0.8}
  fill={0.375}
  key_position={[2, 3, 1.5]}
  fill_position={[-1.5, 1, -2]}
/>

<T.LineSegments geometry={wire_geometry}>
  <T.LineBasicMaterial color={text_color} transparent opacity={0.7} />
</T.LineSegments>
{#if settings.show_event_rings}
  <T.LineSegments geometry={event_ring_geometry}>
    <T.LineBasicMaterial color={text_color} transparent opacity={0.18} />
  </T.LineSegments>
{/if}

<!-- Below the cutting plane solid, above ghosted; both halves share the same geometry. Raycasts
ignore clipping, so only the solid copy carries pointer handlers (else every hit fires twice) -->
{#each [[below_plane, 1], [above_plane, 0.3]] as const as [plane, alpha] (alpha)}
  <T is={ClippingGroup} clippingPlanes={[plane]}>
    {#if settings.show_sheets}
      <T.Mesh geometry={sheet_geometry}>
        <T.MeshStandardMaterial
          color={TERNARY_COLORS.stable}
          transparent
          opacity={settings.sheet_opacity * alpha}
          side={DoubleSide}
          depthWrite={false}
        />
      </T.Mesh>
    {/if}
    {#each settings.show_rods ? rods : [] as rod (rod.key)}
      <T.Mesh
        geometry={unit_cylinder}
        position={rod.position}
        scale={[rod_radius(rod.phase), rod.length, rod_radius(rod.phase)]}
        {...alpha === 1 ? rod_handlers(rod.phase) : {}}
      >
        <T.MeshStandardMaterial
          color={color_of(rod.phase, rod.is_element)}
          transparent={alpha < 1}
          opacity={alpha}
        />
      </T.Mesh>
    {/each}
  </T>
{/each}

<T.Group position={[0, plane_y, 0]}>
  <T.Mesh
    geometry={plane_geometry}
    {...touch_hover({
      onpointerdown: start_plane_drag,
      onpointermove: hover_plane,
      onpointerleave: clear_plane_hover,
    })}
  >
    <T.MeshStandardMaterial
      color="#fff59d"
      transparent
      opacity={dragging_plane ? 0.32 : 0.2}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
  {#if settings.show_tie_triangles}
    <T.Mesh geometry={facet_geometry}>
      <T.MeshStandardMaterial
        color={TERNARY_COLORS.face}
        transparent
        opacity={0.45}
        side={DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </T.Mesh>
  {/if}
  {#if hover_facet !== -1}
    <HoverHighlight
      geometry={facet_geometry}
      faces={[hover_facet]}
      color={TERNARY_COLORS.face}
    />
  {/if}
  <T.LineSegments geometry={tie_line_geometry}>
    <T.LineBasicMaterial color={text_color} />
  </T.LineSegments>
  {#each probe_marks as { kind, spokes, position, color } (kind)}
    <T.LineSegments geometry={spokes}>
      <T.LineBasicMaterial {color} />
    </T.LineSegments>
    <T.Mesh geometry={unit_sphere} {position} scale={0.013}>
      <T.MeshBasicMaterial {color} />
    </T.Mesh>
  {/each}
  {#each section_points as point (point.phase)}
    <T.Mesh geometry={unit_sphere} position={point.position} scale={0.014}>
      <T.MeshStandardMaterial color={color_of(point.phase, point.is_element)} />
    </T.Mesh>
    {#if settings.show_stable_labels && !point.is_element}
      <SceneLabel position={point.label_position} center zIndexRange={[4, 0]}>
        <span class="phase-label">
          {#each point.segments as segment, seg_idx (seg_idx)}<span
              class:sub={segment.subscript}>{segment.text}</span
            >{/each}
        </span>
      </SceneLabel>
    {/if}
  {/each}
</T.Group>

<!-- Probe lines through the whole temperature range -->
{#each probe_marks as { kind, position, color, radius } (kind)}
  <T.Mesh geometry={unit_cylinder} {position} scale={[radius, HEIGHT, radius]}>
    <T.MeshBasicMaterial {color} />
  </T.Mesh>
{/each}

{#if dragging_plane}
  <extras.Billboard>
    <T.Mesh onpointermove={drag_plane} userData={{ pick_rank: 2 }}>
      <T.PlaneGeometry args={[8, 8]} />
      <T.MeshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
    </T.Mesh>
  </extras.Billboard>
{/if}

{#each d3_ticks(t_min, t_max, 6) as tick (tick)}
  {@render html_label(tick_pos(tick), format_num(tick, `.0f`), `tick-label`, 2)}
{/each}
{@render html_label(
  [tick_pos(t_max)[0], tick_pos(t_max)[1] + 0.09, tick_pos(t_max)[2]],
  `T (K)`,
  `axis-label`,
  2,
)}
{#each corner_labels as { element, position } (element)}
  {@render html_label(position, element, `axis-label`, 3)}
{/each}

<style>
  :is(.tick-label, .axis-label, .phase-label) {
    user-select: none;
    white-space: nowrap;
    color: var(--text-color, #ddd);
  }
  .tick-label,
  .phase-label {
    font-size: 11px;
    opacity: 0.9;
  }
  .axis-label {
    font: bold 13px sans-serif;
  }
  .sub {
    font-size: 0.8em;
    vertical-align: -0.3em;
  }
</style>
