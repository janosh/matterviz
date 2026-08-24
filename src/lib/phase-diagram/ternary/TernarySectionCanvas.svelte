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
    type LabelOpts,
    type Projected,
  } from '$lib/convex-hull/canvas-draw'
  import { get_energy_color_scale, merge_highlight_style } from '$lib/convex-hull/helpers'
  import type { ConvexHullEntry } from '$lib/convex-hull/types'
  import { lerp, type Vec2, type Vec3 } from '$lib/math'
  import type { HTMLAttributes } from 'svelte/elements'
  import { type CanvasFrame, create_canvas_surface } from '$lib/canvas-surface.svelte'
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
    settings: TernaryDisplay
    selected_phase?: number | null
    highlighted_phases?: number[]
    emphasized_phases?: number[] // ringed, e.g. phases that change at the next transition
    on_hover?: (hover: SectionHover | null) => void
    on_click?: (phase: DiagramPhase | null, event: MouseEvent) => void
  } = $props()

  let canvas = $state<HTMLCanvasElement>()
  let overlay_canvas = $state<HTMLCanvasElement>()
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
      scale: Math.min(width, height) / 600, // marker/ring radii relative to a 600px canvas
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

  // Created once per phase set; per temperature hull_entries layers the energy fields on top.
  // phase_idx links an entry back to model.phases (the shared hit-test returns the entry).
  type SectionEntry = ConvexHullEntry & { phase_idx: number }
  const base_entries = $derived(
    model.phases.map((phase): SectionEntry => ({
      ...phase.entry,
      phase_idx: phase.idx,
      entry_id: phase.entry.entry_id ?? `phase-${phase.idx}`,
      reduced_formula: phase.label,
      x: phase.xy[0],
      y: phase.xy[1],
      z: 0,
      is_element: phase.is_element,
    })),
  )
  const hull_entries = $derived.by(() => {
    const stable_set = new Set(section.stable)
    return base_entries.map((entry, idx): SectionEntry | null => {
      const dist = section.e_above_hull[idx]
      if (!Number.isFinite(dist)) return null
      // exclude_from_hull phases can sit below the hull (negative distance) without being on it
      return {
        ...entry,
        e_above_hull: dist,
        is_stable: stable_set.has(idx),
        e_form_per_atom: section.dg_form[idx],
      }
    })
  })
  const visible_entries = $derived(
    hull_entries.filter(
      (entry): entry is SectionEntry =>
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

  // Tie-triangles and their colours, shared by the base (all faces) and the overlay (the
  // hovered face), so a hover doesn't rebuild the face list
  const faces = $derived(
    build_hull_faces(
      section.facets.flatMap((facet) => {
        const entries = facet.map((idx) => hull_entries[idx])
        return entries.every((entry) => entry !== null) ? [entries] : []
      }),
      project,
    ),
  )
  const face_color = $derived(
    face_color_resolver(faces, {
      mode: settings.face_color_mode,
      uniform_color: TERNARY_COLORS.face,
      color_scale: settings.color_scale,
      element_colors: default_element_colors,
      elements: model.elements,
    }),
  )
  // Stable-first paint order reversed so stable vertices sit on top
  const points = $derived(
    by_stability
      .toReversed()
      .map((entry) => ({ entry, projected: project(entry.x, entry.y) })),
  )
  const point_opts = $derived({
    scale: layout.scale,
    shadow_factor: 0,
    selected_entry: null,
    is_highlighted: () => false,
    get_point_color: point_color,
    highlight_style,
  })

  // Shared by the base and the overlay so a label repainted on the overlay lands on its
  // base placement (placement is order-dependent across all entries)
  const label_opts = ({ width, height, text_color }: CanvasFrame): LabelOpts => ({
    project,
    elements: model.elements,
    scale: layout.scale,
    text_color,
    width,
    height,
    show_stable_labels: settings.show_stable_labels,
    show_unstable_labels: settings.show_unstable_labels,
    max_hull_dist_show_labels: settings.max_e_above_hull,
  })

  // Base layer: everything that doesn't change while the pointer moves
  function draw_frame(frame: CanvasFrame): void {
    const { ctx, text_color } = frame
    const { scale } = layout
    const [corner_a, corner_b, corner_c] = TRIANGLE_VERTICES
    if (settings.show_grid) {
      ctx.strokeStyle = add_alpha(text_color, 0.12)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      const grid_point = (from: readonly number[], to: readonly number[], frac: number) =>
        project(lerp(from[0], to[0], frac), lerp(from[1], to[1], frac))
      for (let step = 1; step < 10; step++) {
        const frac = step / 10
        for (const [start, end] of [
          [corner_a, corner_b, corner_c],
          [corner_b, corner_c, corner_a],
          [corner_c, corner_a, corner_b],
        ].map(([from, to_a, to_b]) => [
          grid_point(from, to_a, frac),
          grid_point(from, to_b, frac),
        ])) {
          stroke_path(ctx, [start, end])
        }
      }
      ctx.setLineDash([])
    }

    // Tie-triangles
    for (const face of faces) {
      const fill = settings.show_tie_triangles
        ? add_alpha(face_color(face), settings.face_opacity)
        : `transparent`
      const stroke = settings.show_tie_lines ? add_alpha(text_color, 0.45) : `transparent`
      draw_face(ctx, face.projected, fill, stroke)
    }
    ctx.strokeStyle = add_alpha(text_color, 0.6)
    ctx.lineWidth = 1.5
    stroke_path(
      ctx,
      TRIANGLE_VERTICES.map(([x_pos, y_pos]) => project(x_pos, y_pos)),
      true,
    )
    draw_hull_points(ctx, points, point_opts)
    draw_hull_labels(ctx, visible_entries, label_opts(frame))
    draw_corner_labels(ctx, TRIANGLE_VERTICES, [0.5, TRIANGLE_HEIGHT / 3], {
      project,
      elements: model.elements,
      text_color,
      font_size: 14,
      offset: 0.045,
    })
  }

  // Overlay layer: hover + selection decorations, repainted without touching the section
  function draw_overlay(frame: CanvasFrame): void {
    const { ctx, width, height, text_color } = frame
    ctx.clearRect(0, 0, width, height)
    const { scale } = layout
    const hovered = hover_composition?.decomposition.phases.map((idx) => hull_entries[idx])
    // Faces containing every phase of the assemblage: the tie-triangle around an interior
    // composition, or both neighbours of a tie-line
    const hovered_faces = hovered
      ? faces.filter((face) =>
          hovered.every((entry) => entry && face.vertices.includes(entry)),
        )
      : []
    if (hovered_faces.length > 0) {
      const stroke = settings.show_tie_lines ? add_alpha(text_color, 0.9) : `transparent`
      for (const face of hovered_faces) {
        const fill = add_alpha(face_color(face), settings.show_tie_triangles ? 0.25 : 0.2)
        draw_face(ctx, face.projected, fill, stroke)
      }
      // The tint covers the base; repaint the faces' vertices and their labels so the
      // markers stay crisp and the formula text isn't washed out
      const vertices = new Set<ConvexHullEntry>(hovered_faces.flatMap((face) => face.vertices))
      draw_hull_points(
        ctx,
        points.filter(({ entry }) => vertices.has(entry)),
        point_opts,
      )
      draw_hull_labels(ctx, visible_entries, {
        ...label_opts(frame),
        paint_only: (entry) => vertices.has(entry),
      })
    }
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
    // Selected/highlighted points: ring, then the marker again on top of it
    const selected_entry =
      selected_phase === null ? null : (hull_entries[selected_phase] ?? null)
    // Identity is valid here: points and hull_entries come from the same derivation
    const highlighted = new Set<ConvexHullEntry | null>(
      highlighted_phases.map((idx) => hull_entries[idx]),
    )
    for (const point of points) {
      const selected = point.entry === selected_entry
      if (!selected && !highlighted.has(point.entry)) continue
      ring(
        ctx,
        point.projected,
        9 * scale,
        selected ? TERNARY_COLORS.selected : TERNARY_COLORS.highlight,
      )
      draw_hull_points(ctx, [point], point_opts)
    }
  }

  const surface = create_canvas_surface({
    canvas: () => canvas,
    overlay_canvas: () => overlay_canvas,
    draw: draw_frame,
    draw_overlay,
    repaint_deps: () => [section, visible_entries, faces, points, point_opts, settings],
  })
  // Hover and selection only repaint the overlay (the base is several hundred paths)
  $effect(() => {
    void [hover_composition, selected_phase, highlighted_phases, emphasized_phases]
    surface.schedule(false)
  })

  // === Pointer ===

  function handle_pointer_move(event: MouseEvent): void {
    if (!canvas) return
    const position: Vec2 = [event.clientX, event.clientY]
    const entry = find_hull_entry_at_mouse(canvas, event, points, layout.scale)
    hover_phase = entry ? entry.phase_idx : null
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
  <canvas bind:this={overlay_canvas} class="pulse-overlay" aria-hidden="true"></canvas>
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
  canvas.pulse-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
