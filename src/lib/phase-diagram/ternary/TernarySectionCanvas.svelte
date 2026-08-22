<script lang="ts">
  // Isothermal section: the Gibbs triangle tiled by tie-triangles at one temperature, stable
  // phases as vertices, unstable phases faded by hull distance. Hovering a composition shows
  // its tie-triangle (lever rule); drawing reuses the convex-hull canvas helpers.
  import { add_alpha, default_element_colors } from '$lib/colors'
  import { TRIANGLE_VERTICES } from '$lib/convex-hull/barycentric-coords'
  import {
    build_hull_faces,
    draw_corner_labels,
    draw_face,
    draw_hull_labels,
    draw_hull_points,
    face_color_resolver,
    find_hull_entry_at_mouse,
    type Projected,
  } from '$lib/convex-hull/canvas-draw'
  import { get_energy_color_scale, merge_highlight_style } from '$lib/convex-hull/helpers'
  import type { ConvexHullEntry } from '$lib/convex-hull/types'
  import type { Vec2, Vec3 } from '$lib/math'
  import type { HTMLAttributes } from 'svelte/elements'
  import { type CanvasFrame, create_canvas_surface } from './canvas-surface.svelte'
  import { decompose_composition, type DiagramModel } from './compute'
  import {
    type Decomposition,
    type DiagramPhase,
    type IsothermalSection,
    type SectionHover,
    TERNARY_COLORS,
    type TernaryDisplay,
  } from './types'

  let {
    model,
    section,
    settings,
    selected_phase = $bindable(null),
    highlighted_phases = [],
    emphasized_phases = [],
    on_hover,
    on_click,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    model: Pick<DiagramModel, `phases` | `elements`>
    section: IsothermalSection
    settings: Pick<
      TernaryDisplay,
      | `show_tie_lines`
      | `show_tie_triangles`
      | `face_color_mode`
      | `face_opacity`
      | `show_unstable`
      | `max_e_above_hull`
      | `show_stable_labels`
      | `show_unstable_labels`
      | `show_grid`
      | `color_scale`
    >
    selected_phase?: number | null
    highlighted_phases?: number[]
    emphasized_phases?: number[] // ringed, e.g. phases that change at the next transition
    on_hover?: (hover: SectionHover | null) => void
    on_click?: (phase: DiagramPhase | null, event: MouseEvent) => void
  } = $props()

  let canvas = $state<HTMLCanvasElement>()
  let hover_composition = $state<{ xy: Vec2; decomposition: Decomposition } | null>(null)
  let hover_phase: number | null = null

  // === Geometry: triangle frame xy ↔ canvas px ===

  const TRIANGLE_HEIGHT = Math.sqrt(3) / 2
  const PAD = 34 // px around the triangle for corner labels
  const layout = $derived.by(() => {
    const { width, height } = surface.dims
    const size = Math.max(1, Math.min(width - 2 * PAD, (height - 2 * PAD) / TRIANGLE_HEIGHT))
    return {
      size,
      origin_x: (width - size) / 2,
      origin_y: (height + size * TRIANGLE_HEIGHT) / 2,
    }
  })
  const project = (x_pos: number, y_pos: number): Projected => ({
    x: layout.origin_x + x_pos * layout.size,
    y: layout.origin_y - y_pos * layout.size,
    depth: 0,
  })
  const xy_at = (px: number, py: number): Vec2 => [
    (px - layout.origin_x) / layout.size,
    (layout.origin_y - py) / layout.size,
  ]
  const barycentric_of = ([x_pos, y_pos]: Vec2): Vec3 => {
    const x_b = y_pos / TRIANGLE_HEIGHT
    return [x_pos - 0.5 * x_b, x_b, 1 - x_pos - 0.5 * x_b]
  }

  // === Entries in ConvexHullEntry shape for the shared canvas helpers ===

  // Created once per phase set; per temperature only the energy fields are refreshed in place
  const base_entries = $derived(
    model.phases.map((phase): ConvexHullEntry => ({
      ...phase.entry,
      entry_id: phase.entry.entry_id ?? `phase-${phase.idx}`,
      reduced_formula: phase.label,
      x: phase.xy[0],
      y: phase.xy[1],
      z: 0,
      is_element: phase.is_element,
    })),
  )
  // Plain Map: only read from the untracked draw frame and pointer handlers
  const entry_index = $derived(new Map(base_entries.map((entry, idx) => [entry, idx])))
  const phase_idx_of = (entry: ConvexHullEntry) => entry_index.get(entry) ?? -1
  const hull_entries = $derived(
    base_entries.map((entry, idx) => {
      const dist = section.e_above_hull[idx]
      if (!Number.isFinite(dist)) return null
      entry.e_above_hull = dist
      entry.is_stable = dist <= 0
      entry.e_form_per_atom = section.dg_form[idx]
      return entry
    }),
  )
  const visible_entries = $derived(
    hull_entries.filter(
      (entry): entry is ConvexHullEntry =>
        entry !== null &&
        (entry.is_stable === true ||
          (settings.show_unstable &&
            (entry.e_above_hull ?? Infinity) <= settings.max_e_above_hull)),
    ),
  )
  // Most stable first: the hit-test order, and reversed the paint order (stable on top)
  const by_stability = $derived(
    visible_entries.toSorted((lhs, rhs) => (lhs.e_above_hull ?? 0) - (rhs.e_above_hull ?? 0)),
  )
  const energy_scale = $derived(
    get_energy_color_scale(`energy`, settings.color_scale, visible_entries),
  )
  const point_color = (entry: ConvexHullEntry) =>
    entry.is_stable
      ? TERNARY_COLORS.stable
      : (energy_scale?.(entry.e_above_hull ?? 0) ?? `#999`)
  const highlight_style = merge_highlight_style({
    effect: `glow`,
    color: TERNARY_COLORS.highlight,
  })

  // === Drawing ===

  const stroke_path = (ctx: CanvasRenderingContext2D, points: Projected[], close = false) => {
    ctx.beginPath()
    for (const [idx, point] of points.entries()) {
      if (idx === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    }
    if (close) ctx.closePath()
    ctx.stroke()
  }
  const ring = (
    ctx: CanvasRenderingContext2D,
    point: Projected,
    radius: number,
    color: string,
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI)
    ctx.stroke()
  }

  function draw_frame({ ctx, width, height, text_color }: CanvasFrame): void {
    const scale = Math.min(width, height) / 600
    const [corner_a, corner_b, corner_c] = TRIANGLE_VERTICES
    if (settings.show_grid) {
      ctx.strokeStyle = add_alpha(text_color, 0.12)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      const lerp = (from: readonly number[], to: readonly number[], frac: number) =>
        project(from[0] + (to[0] - from[0]) * frac, from[1] + (to[1] - from[1]) * frac)
      for (let step = 1; step < 10; step++) {
        const frac = step / 10
        for (const [start, end] of [
          [corner_a, corner_b, corner_c],
          [corner_b, corner_c, corner_a],
          [corner_c, corner_a, corner_b],
        ].map(([from, to_a, to_b]) => [lerp(from, to_a, frac), lerp(from, to_b, frac)])) {
          stroke_path(ctx, [start, end])
        }
      }
      ctx.setLineDash([])
    }

    // Tie-triangles
    const faces = build_hull_faces(
      section.facets.flatMap((facet) => {
        const entries = facet.map((idx) => hull_entries[idx])
        return entries.every((entry) => entry !== null) ? [entries] : []
      }),
      project,
    )
    const color_of = face_color_resolver(faces, {
      mode: settings.face_color_mode,
      uniform_color: TERNARY_COLORS.face,
      color_scale: settings.color_scale,
      element_colors: default_element_colors,
      elements: model.elements,
    })
    const hovered = hover_composition?.decomposition.phases.map((idx) => hull_entries[idx])
    for (const face of faces) {
      const is_hovered =
        hovered?.every((entry) => entry && face.vertices.includes(entry)) ?? false
      const fill = settings.show_tie_triangles
        ? add_alpha(
            color_of(face),
            is_hovered ? Math.min(1, settings.face_opacity + 0.25) : settings.face_opacity,
          )
        : add_alpha(color_of(face), is_hovered ? 0.2 : 0)
      const stroke = settings.show_tie_lines
        ? add_alpha(text_color, is_hovered ? 0.9 : 0.45)
        : `transparent`
      draw_face(ctx, face.projected, fill, stroke)
    }
    ctx.strokeStyle = add_alpha(text_color, 0.6)
    ctx.lineWidth = 1.5
    stroke_path(
      ctx,
      TRIANGLE_VERTICES.map(([x_pos, y_pos]) => project(x_pos, y_pos)),
      true,
    )

    // Composition probe: dashed spokes to the tie-triangle vertices
    if (hover_composition) {
      const point = project(...hover_composition.xy)
      ctx.strokeStyle = text_color
      ctx.lineWidth = 1
      ctx.setLineDash([2, 3])
      for (const idx of hover_composition.decomposition.phases) {
        stroke_path(ctx, [point, project(...model.phases[idx].xy)])
      }
      ctx.setLineDash([])
      ctx.fillStyle = add_alpha(text_color, 0.8)
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI)
      ctx.fill()
    }
    for (const idx of emphasized_phases) {
      if (Number.isFinite(section.e_above_hull[idx])) {
        ring(ctx, project(...model.phases[idx].xy), 11 * scale, TERNARY_COLORS.highlight)
      }
    }

    // Points, unstable first so stable vertices sit on top; the shared helper skips selected
    // and highlighted points (the 3D hull animates them on an overlay), so draw those after
    const points = by_stability
      .toReversed()
      .map((entry) => ({ entry, projected: project(entry.x, entry.y) }))
    const selected_entry =
      selected_phase === null ? null : (hull_entries[selected_phase] ?? null)
    const highlighted = new Set(highlighted_phases)
    const is_highlighted = (entry: ConvexHullEntry) => highlighted.has(phase_idx_of(entry))
    const opts = {
      scale,
      shadow_factor: 0,
      selected_entry,
      is_highlighted,
      get_point_color: point_color,
      highlight_style,
    }
    draw_hull_points(ctx, points, opts)
    for (const point of points) {
      const selected = point.entry === selected_entry
      if (!selected && !is_highlighted(point.entry)) continue
      ring(
        ctx,
        point.projected,
        9 * scale,
        selected ? TERNARY_COLORS.selected : TERNARY_COLORS.highlight,
      )
      draw_hull_points(ctx, [point], {
        ...opts,
        selected_entry: null,
        is_highlighted: () => false,
      })
    }
    draw_hull_labels(ctx, visible_entries, {
      project,
      elements: model.elements,
      scale,
      text_color,
      width,
      height,
      show_stable_labels: settings.show_stable_labels,
      show_unstable_labels: settings.show_unstable_labels,
      max_hull_dist_show_labels: settings.max_e_above_hull,
    })
    draw_corner_labels(ctx, TRIANGLE_VERTICES, [0.5, TRIANGLE_HEIGHT / 3], {
      project,
      elements: model.elements,
      text_color,
      font_size: 14,
      offset: 0.045,
    })
  }

  const surface = create_canvas_surface({
    canvas: () => canvas,
    draw: draw_frame,
    repaint_deps: () => [
      section,
      visible_entries,
      layout,
      settings,
      selected_phase,
      highlighted_phases,
      emphasized_phases,
      hover_composition,
    ],
  })

  // === Pointer ===

  function handle_pointer_move(event: MouseEvent): void {
    if (!canvas) return
    const position: Vec2 = [event.clientX, event.clientY]
    const entry = find_hull_entry_at_mouse(canvas, event, by_stability, project)
    hover_phase = entry ? phase_idx_of(entry) : null
    canvas.style.cursor = entry ? `pointer` : ``
    if (hover_phase !== null) {
      hover_composition = null
      on_hover?.({
        kind: `phase`,
        phase: model.phases[hover_phase],
        e_above_hull: section.e_above_hull[hover_phase],
        position,
      })
      return
    }
    const rect = canvas.getBoundingClientRect()
    const xy = xy_at(event.clientX - rect.left, event.clientY - rect.top)
    const barycentric = barycentric_of(xy)
    if (barycentric.some((frac) => frac < -1e-6)) return handle_pointer_leave()
    const decomposition = decompose_composition(model, section, xy)
    hover_composition = decomposition && { xy, decomposition }
    on_hover?.({ kind: `composition`, barycentric, decomposition, position })
  }
  function handle_pointer_leave(): void {
    hover_phase = null
    hover_composition = null
    if (canvas) canvas.style.cursor = ``
    on_hover?.(null)
  }
  function handle_click(event: MouseEvent): void {
    const phase = hover_phase === null ? null : model.phases[hover_phase]
    selected_phase = phase && selected_phase !== phase.idx ? phase.idx : null
    on_click?.(phase, event)
  }
</script>

<div {...rest} class={[`ternary-section`, rest.class]}>
  <canvas
    bind:this={canvas}
    aria-label="Isothermal section of the {model.elements.join(
      `-`,
    )} phase diagram at {Math.round(section.temperature)} K"
    onpointermove={handle_pointer_move}
    onpointerleave={handle_pointer_leave}
    onclick={handle_click}
  ></canvas>
</div>

<style>
  .ternary-section {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 200px;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
