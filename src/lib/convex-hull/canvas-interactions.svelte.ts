// Shared interaction scaffolds (runes-in-closure factories) for the convex hull components:
// create_hull_selection covers what 2D/3D/4D all do (selection, hover, structure popup,
// clipboard copy, keyboard, file drop); create_canvas_interactions adds the canvas-specific
// mouse handling, sizing and render scheduling behind ConvexHullCanvas.
import { create_canvas_surface } from '$lib/canvas-surface.svelte'
import type { D3InterpolateName } from '$lib/colors'
import { create_pulse_animation } from '$lib/effects.svelte'
import type { ElementSymbol } from '$lib/element'
import { as_text, file_drop_zone } from '$lib/io'
import { clamp } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { is_editable_target } from '$lib/utils'
import { createAttachmentKey } from 'svelte/attachments'
import * as draw from './canvas-draw'
import {
  build_entry_tooltip_text,
  current_entry,
  get_energy_color_scale,
  get_point_color_for_entry,
  is_entry_highlighted,
  merge_highlight_style,
  same_entry,
} from './helpers'
import { process_hull_entries } from './thermodynamics'
import type {
  ConvexHullConfig,
  ConvexHullEntry,
  EntryCategoryConfig,
  HighlightStyle,
  HoverData3D,
  PhaseData,
} from './types'

interface HullSelectionInputs {
  entries: () => PhaseData[] // raw entries, for the structure lookup
  plot_entries: () => ConvexHullEntry[]
  selected_entry: () => ConvexHullEntry | null
  set_selected_entry: (entry: ConvexHullEntry | null) => void
  enable_click_selection: () => boolean
  enable_structure_preview: () => boolean
  allow_file_drop: () => boolean
  on_point_click: () => ((entry: ConvexHullEntry) => void) | undefined
  on_point_hover: () => ((data: HoverData3D | null) => void) | undefined
  on_file_drop: () => ((entries: PhaseData[]) => void) | undefined
  // Categorical classification config (for category line in copied entry text)
  entry_category: () => EntryCategoryConfig | null
  wrapper: () => HTMLElement | undefined
  actions: () => Record<string, () => void> // keydown actions map (thunk avoids TDZ)
}

// Dropped JSON is accepted when it is a non-empty array of entries with a composition.
// Composition keys are validated here so a bad file ("Fe2O3" as a key) fails inside the
// drop handler's try/catch instead of throwing from the hull pipeline's $derived mid-render.
function parse_hull_entries(text: string): PhaseData[] | null {
  const data: unknown = JSON.parse(text)
  if (!Array.isArray(data) || data.length === 0) return null
  const first: unknown = data[0]
  if (typeof first !== `object` || first === null || !(`composition` in first)) return null
  const entries = data as PhaseData[]
  process_hull_entries(entries)
  return entries
}

export function create_hull_selection(inputs: HullSelectionInputs) {
  let hover_data = $state.raw<HoverData3D | null>(null)
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })
  let dragover = $state(false)
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let modal_place_right = $state(true)

  // Original (un-projected) entry's structure, for the click-to-preview popup
  const extract_structure = (entry: ConvexHullEntry): AnyStructure | null => {
    if (!entry.entry_id) return null
    const orig = inputs.entries().find((ent) => ent.entry_id === entry.entry_id)
    return (orig?.structure as AnyStructure | undefined) ?? null
  }

  // Keep selection, hover, and popup pointing at current plot entry objects
  $effect(() => {
    const plot_entries = inputs.plot_entries()
    const selected = inputs.selected_entry()
    const current_selection = current_entry(selected, plot_entries)
    if (selected && !current_selection) inputs.set_selected_entry(null)
    else if (current_selection && !same_entry(current_selection, selected)) {
      inputs.set_selected_entry(current_selection)
    }
    const current_hover = current_entry(hover_data?.entry, plot_entries)
    if (hover_data?.entry && !current_hover) set_hover(null)
    else if (hover_data && current_hover && current_hover !== hover_data.entry) {
      hover_data = { ...hover_data, entry: current_hover }
    }
    if (modal_open) {
      const structure = current_selection && extract_structure(current_selection)
      if (structure) selected_structure = structure
      else {
        modal_open = false
        selected_structure = null
      }
    }
  })

  function set_hover(data: HoverData3D | null) {
    hover_data = data
    inputs.on_point_hover()?.(data)
  }

  // Shared selection logic for click and Enter key. The popup opens on whichever side of
  // the viewport has more room next to the wrapper.
  function select_entry(entry: ConvexHullEntry) {
    inputs.on_point_click()?.(entry)
    if (!inputs.enable_click_selection()) return
    inputs.set_selected_entry(entry)
    if (!inputs.enable_structure_preview()) return
    const structure = extract_structure(entry)
    if (!structure) return
    selected_structure = structure
    const rect = inputs.wrapper()?.getBoundingClientRect()
    modal_place_right = !rect || globalThis.innerWidth - rect.right >= rect.left
    modal_open = true
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    inputs.set_selected_entry(null)
  }

  // One pending hide at a time: a second copy restarts the 1.5 s window instead of letting the
  // first copy's timer hide the fresh feedback early; cleared on unmount
  let copy_feedback_timeout: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(copy_feedback_timeout))
  async function copy_entry_data(entry: ConvexHullEntry, position: { x: number; y: number }) {
    await navigator.clipboard.writeText(
      build_entry_tooltip_text(entry, inputs.entry_category()),
    )
    copy_feedback = { visible: true, position }
    clearTimeout(copy_feedback_timeout)
    copy_feedback_timeout = setTimeout(
      () => (copy_feedback = { visible: false, position }),
      1500,
    )
  }

  const handle_keydown = (event: KeyboardEvent) => {
    if (is_editable_target(event)) return
    // A canvas-originated keydown bubbles to the wrapper (both listen); handle it once
    if (event.target !== inputs.wrapper()) event.stopPropagation()

    if (event.key === `Escape` && modal_open) return close_structure_popup()
    if (event.key === `Enter`) {
      const entry = hover_data?.entry
      if (entry) select_entry(entry)
      else if (modal_open) close_structure_popup()
      return
    }
    inputs.actions()[event.key.toLowerCase()]?.()
  }

  // Drop zone attachment (JSON, .json.gz and FilePicker URL drops); spread onto the wrapper
  const drop_zone = {
    [createAttachmentKey()]: file_drop_zone({
      allow: inputs.allow_file_drop,
      on_drop: (content, filename) => {
        const entries = parse_hull_entries(as_text(content))
        if (!entries) throw new Error(`${filename} is not a convex hull entries array`)
        inputs.on_file_drop()?.(entries)
      },
      on_error: (msg) => console.error(msg),
      on_dragover: (over) => (dragover = over),
    }),
  }

  return {
    get hover_data() {
      return hover_data
    },
    get copy_feedback() {
      return copy_feedback
    },
    get dragover() {
      return dragover
    },
    get modal_open() {
      return modal_open
    },
    get selected_structure() {
      return selected_structure
    },
    get modal_place_right() {
      return modal_place_right
    },
    set_hover,
    select_entry,
    close_structure_popup,
    copy_entry_data,
    handle_keydown,
    drop_zone,
  }
}

export type HullSelection = ReturnType<typeof create_hull_selection>

interface CanvasInteractionInputs extends HullSelectionInputs {
  // Camera defaults, drag rotation, zoom clamp and point shadow of the ternary/quaternary view
  strategy: draw.HullCanvasStrategy
  canvas: () => HTMLCanvasElement | undefined
  // Transparent layer over `canvas` holding only the pulsing rings, so ticks skip the hull
  overlay_canvas: () => HTMLCanvasElement | undefined
  elements: () => ElementSymbol[]
  visible_entries: () => ConvexHullEntry[]
  project_point: draw.ProjectPoint
  // Point styling
  highlighted_entries: () => (string | ConvexHullEntry)[]
  highlight_style: () => HighlightStyle | undefined
  color_mode: () => `stability` | `energy`
  color_scale: () => D3InterpolateName
  colors: () => ConvexHullConfig[`colors`] | undefined
  labels: () => { show_labels?: boolean } & Pick<
    draw.LabelOpts,
    `show_stable_labels` | `show_unstable_labels` | `max_hull_dist_show_labels`
  >
  // Draws the hull onto the cleared `ctx` (CSS-pixel coordinates); calls
  // draw_points/draw_labels where they belong in its paint order
  render_frame: (ctx: CanvasRenderingContext2D) => void
  // Everything else `render_frame` reads. It draws inside a rAF, where reads don't register
  // as dependencies, so anything missing leaves the canvas silently stale. List the derived
  // values the draw code reads, not their inputs — the derivation keeps the list honest.
  repaint_deps: () => unknown
}

export function create_canvas_interactions(inputs: CanvasInteractionInputs) {
  const selection = create_hull_selection(inputs)
  const { strategy } = inputs
  const [zoom_min, zoom_max] = strategy.wheel_clamp

  // === Camera ===
  const camera = $state<draw.HullCamera>({ ...strategy.camera_default })
  const reset_camera = () => Object.assign(camera, strategy.camera_default)
  const recenter_camera = () => {
    camera.center_x = strategy.camera_default.center_x
    camera.center_y = strategy.camera_default.center_y
  }
  // CSS-pixel dims plus the container scale factor the draw code sizes markers and text by
  const canvas_dims = $derived.by(() => {
    const { width, height } = surface.dims
    return { width, height, scale: Math.min(width, height) / 600 }
  })
  // Data units → canvas pixels at the current zoom
  const view_scale = $derived(
    Math.min(canvas_dims.width, canvas_dims.height) * 0.6 * camera.zoom,
  )
  // Rotated view coordinates → canvas position (y flipped for canvas coordinates)
  const to_screen = (x: number, y: number, depth: number): draw.Projected => ({
    x: canvas_dims.width / 2 + camera.center_x + x * view_scale,
    y: canvas_dims.height / 2 + camera.center_y - y * view_scale,
    depth,
  })

  // === Point styling ===
  const highlight_style = $derived(merge_highlight_style(inputs.highlight_style()))
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    is_entry_highlighted(entry, inputs.highlighted_entries())
  const energy_color_scale = $derived(
    get_energy_color_scale(inputs.color_mode(), inputs.color_scale(), inputs.plot_entries()),
  )
  const get_point_color = (entry: ConvexHullEntry): string =>
    get_point_color_for_entry(entry, inputs.color_mode(), inputs.colors(), energy_color_scale)
  const hull_point_opts = (): draw.HullPointOpts => ({
    scale: canvas_dims.scale,
    shadow_factor: strategy.shadow_factor,
    selected_entry: inputs.selected_entry(),
    is_highlighted,
    get_point_color,
    highlight_style,
  })

  let is_dragging = $state(false)
  let drag_started = false
  let last_mouse = { x: 0, y: 0 }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    selection.set_hover(null)
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (!is_dragging) return
    const [dx, dy] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]
    if (dx !== 0 || dy !== 0) drag_started = true
    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl: pan instead of rotate
      camera.center_x += dx
      camera.center_y += dy
    } else strategy.rotate(camera, dx, dy)
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  // leave drag_started set so the trailing click can detect a concluded drag;
  // handle_click reads then clears it, and handle_mouse_down resets it next interaction
  const handle_mouse_up = () => (is_dragging = false)

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    const zoomed = camera.zoom * (event.deltaY > 0 ? 0.98 : 1.02)
    camera.zoom = clamp(zoomed, zoom_min, zoom_max)
  }

  // Against the cached projections, so a hover costs no re-projection
  const find_entry_at_mouse = (event: MouseEvent): ConvexHullEntry | null =>
    draw.find_hull_entry_at_mouse(
      inputs.canvas(),
      event,
      sorted_points_cache,
      canvas_dims.scale,
    )

  const handle_hover = (event: MouseEvent) => {
    if (is_dragging) return
    const entry = find_entry_at_mouse(event)
    selection.set_hover(
      entry ? { entry, position: { x: event.clientX, y: event.clientY } } : null,
    )
  }

  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    const was_drag = drag_started
    drag_started = false
    if (was_drag) return // a drag ending over a point isn't a click on it
    const entry = find_entry_at_mouse(event)
    if (entry) {
      // mousedown cleared the hover; restore it so a touch tap (which never hovers) also
      // gets the tooltip. Under a mouse the next mousemove would restore it anyway.
      selection.set_hover({ entry, position: { x: event.clientX, y: event.clientY } })
      selection.select_entry(entry)
    } else if (selection.modal_open) selection.close_structure_popup()
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) void selection.copy_entry_data(entry, { x: event.clientX, y: event.clientY })
  }

  // === Rendering ===

  // Cache all point projections + depth sorting per camera/data change
  const sorted_points_cache = $derived.by((): draw.HullPoint[] => {
    if (!inputs.canvas()) return []
    return inputs
      .visible_entries()
      .map((entry) => ({ entry, projected: inputs.project_point(entry.x, entry.y, entry.z) }))
      .toSorted((left, right) => left.projected.depth - right.projected.depth)
  })

  const draw_points = (target: CanvasRenderingContext2D) =>
    draw.draw_hull_points(target, sorted_points_cache, hull_point_opts())

  function draw_labels(target: CanvasRenderingContext2D): void {
    const { show_labels, ...toggles } = inputs.labels()
    if (!show_labels) return
    draw.draw_hull_labels(target, inputs.visible_entries(), {
      ...toggles,
      project: inputs.project_point,
      elements: inputs.elements(),
      scale: canvas_dims.scale,
      text_color: surface.text_color,
      width: canvas_dims.width,
      height: canvas_dims.height,
    })
  }

  // Pulsating highlight for selected/highlighted points. Ticks repaint only the overlay
  // canvas, and the loop pauses entirely while `wrapper` is off screen.
  const pulse = create_pulse_animation(
    () => inputs.selected_entry() !== null || inputs.highlighted_entries().length > 0,
    { on_tick: () => surface.schedule(false), element: inputs.wrapper },
  )

  // Base canvas: the component's scene; overlay: the pulsing markers. No elements means the
  // data hasn't loaded (an arity mismatch unmounts the canvas instead), and the corner labels
  // need the elements, so the scene waits for them.
  const surface = create_canvas_surface({
    canvas: inputs.canvas,
    overlay_canvas: inputs.overlay_canvas,
    draw: ({ ctx }) => {
      if (inputs.elements().length) inputs.render_frame(ctx)
    },
    draw_overlay: ({ ctx }) =>
      draw.draw_pulse_overlay(ctx, sorted_points_cache, hull_point_opts(), {
        time: pulse.time,
        opacity: 0.3 + 0.4 * pulse.unit,
      }),
    // render_frame draws inside a rAF, so everything it reads is touched here instead
    repaint_deps: () => {
      inputs.repaint_deps()
      inputs.labels()
      inputs.elements()
      Object.values(camera) // every camera field, not just those projecting a visible point
      hull_point_opts()
      inputs.highlighted_entries()
      void [sorted_points_cache, energy_color_scale, inputs.colors()]
    },
  })

  return {
    selection,
    camera, // the $state proxy itself, so writes through it repaint
    reset_camera,
    recenter_camera,
    to_screen,
    is_highlighted,
    get_point_color,
    draw_points,
    draw_labels,
    get is_dragging() {
      return is_dragging
    },
    get canvas_dims() {
      return canvas_dims
    },
    get view_scale() {
      return view_scale
    },
    get text_color() {
      return surface.text_color
    },
    get highlight_style() {
      return highlight_style
    },
    // Event handler groups, spread onto their target elements by ConvexHullCanvas
    canvas_handlers: {
      onmousedown: handle_mouse_down,
      onmousemove: handle_hover,
      onclick: handle_click,
      onkeydown: selection.handle_keydown,
      ondblclick: handle_double_click,
      onwheel: handle_wheel,
    },
    // document-level so drags continue outside the canvas; attached individually
    // since <svelte:document> rejects spread attributes
    handle_mouse_move,
    handle_mouse_up,
  }
}
