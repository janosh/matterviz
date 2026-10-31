// Shared interaction scaffolds (runes-in-closure factories) for the convex hull components:
// create_hull_selection covers what 2D/3D/4D all do (selection, hover, structure popup,
// clipboard copy, keyboard and file drop); create_canvas_interactions adds the canvas-specific
// mouse handling, sizing and render scheduling behind ConvexHullCanvas.
import { create_canvas_surface } from '#lib/canvas-surface.svelte.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { create_flash, create_pulse_animation } from '#lib/effects.svelte.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { open_material } from '#lib/file-viewer/open.js'
import { raw_file_drop_zone } from '#lib/io/index.js'
import { clamp } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { viewer_keys } from '#lib/shortcuts.js'
import { createAttachmentKey } from 'svelte/attachments'
import * as draw from './canvas-draw'
import {
  build_entry_tooltip_text,
  current_entry,
  get_energy_color_scale,
  get_point_color_for_entry,
  highlight_matcher,
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
  PhaseEntriesLoadData,
} from './types'

interface HullSelectionInputs {
  entries: () => PhaseData[] // raw entries, for the structure lookup
  plot_entries: () => ConvexHullEntry[]
  selected_entry: () => PhaseData | null
  set_selected_entry: (entry: ConvexHullEntry | null) => void
  enable_click_selection: () => boolean
  enable_structure_preview: () => boolean
  allow_file_drop: () => boolean
  on_point_click: () => ((entry: ConvexHullEntry) => void) | undefined
  on_point_hover: () => ((data: HoverData3D | null) => void) | undefined
  on_file_load: () => ((data: PhaseEntriesLoadData) => void) | undefined
  // Categorical classification config (for category line in copied entry text)
  entry_category: () => EntryCategoryConfig | null
  wrapper: () => HTMLElement | undefined
  actions: () => Record<string, () => void> // keydown actions map (thunk avoids TDZ)
}

export const HOVER_PREVIEW_DELAY_MS = 600 // hover this long to preview an entry's structure

export function create_hull_selection(inputs: HullSelectionInputs) {
  let hover_data = $state.raw<HoverData3D | null>(null)
  // Hiding drops the position with it: ClickFeedback unmounts the node when `visible` goes
  // false, so the coordinates it kept on the way out were never read
  const copy_feedback = create_flash({ visible: false, position: { x: 0, y: 0 } }, 1500)
  let dragover = $state(false)
  let modal_open = $state(false)
  // Raw: a deep proxy (fresh per re-assignment) would trip Structure's identity checks
  let selected_structure = $state.raw<AnyStructure | null>(null)
  let modal_place_right = $state(true)
  let selection_version = 0
  // Hover preview: opens after a delay, then follows the pointer instantly; never while pinned
  let preview = $state.raw<{ entry: ConvexHullEntry; structure: AnyStructure } | null>(null)
  let preview_key: string | undefined // entry_id the pending or shown preview is for
  let preview_timer: ReturnType<typeof setTimeout> | undefined
  const clear_preview = () => {
    clearTimeout(preview_timer)
    preview_key = undefined
    preview = null
  }
  $effect(() => clear_preview)

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
    schedule_preview(data?.entry ?? null)
  }

  function schedule_preview(entry: ConvexHullEntry | null): void {
    if (entry?.entry_id !== undefined && entry.entry_id === preview_key) return // same point
    const structure =
      entry && !modal_open && inputs.enable_structure_preview() && extract_structure(entry)
    if (!entry || !structure) return clear_preview()
    clearTimeout(preview_timer)
    preview_key = entry.entry_id
    const show = () => (preview = { entry, structure })
    if (preview) show()
    else preview_timer = setTimeout(show, HOVER_PREVIEW_DELAY_MS)
  }

  // Shared selection logic for click and Enter key. The popup opens on whichever side of
  // the viewport has more room next to the wrapper.
  function select_entry(entry: ConvexHullEntry) {
    inputs.on_point_click()?.(entry)
    if (!inputs.enable_click_selection()) return
    inputs.set_selected_entry(entry)
    clear_preview() // the pinned popup takes over
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

  async function copy_entry_data(entry: ConvexHullEntry, position: { x: number; y: number }) {
    const version = selection_version
    try {
      await navigator.clipboard.writeText(
        build_entry_tooltip_text(entry, inputs.entry_category()),
      )
    } catch (error) {
      // callers fire and forget (void), so a denied clipboard must not become an unhandled
      // rejection; like the other copy actions it logs and shows no copied feedback
      console.error(`Failed to copy entry data:`, error)
      return
    }
    if (version === selection_version) copy_feedback.show({ visible: true, position })
  }

  // Keys from the focused canvas bubble to the root, or reach it hovered (viewer_keys)
  const keys = viewer_keys(() => ({
    ...inputs.actions(),
    Escape: () => {
      if (!modal_open) return false
      close_structure_popup()
      return true
    },
    Enter: () => {
      const entry = hover_data?.entry
      if (entry) select_entry(entry)
      else if (!modal_open) return false
      else close_structure_popup()
      return true
    },
  }))

  // Spread onto the viewer root: file drop plus the keys above
  const root_attachments = {
    [createAttachmentKey()]: keys,
    [createAttachmentKey()]: raw_file_drop_zone({
      allow: inputs.allow_file_drop,
      on_drop: async (source) => {
        const opened = await open_material(source)
        try {
          if (
            ![`convex_hull`, `json_browser`].includes(opened.type) ||
            !Array.isArray(opened.data)
          ) {
            throw new Error(`${opened.filename} is not a convex hull entries array`)
          }
          const entries = opened.data
          process_hull_entries(entries)
          inputs.on_file_load()?.({ entries, ...opened.provenance })
        } finally {
          opened.dispose()
        }
      },
      on_error: (message) => console.error(message),
      on_dragover: (over) => (dragover = over),
    }),
  }

  return {
    get hover_data() {
      return hover_data
    },
    get copy_feedback() {
      return copy_feedback.value
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
    get preview() {
      return preview
    },
    reset() {
      selection_version++
      clear_preview()
      hover_data = null
      modal_open = false
      selected_structure = null
      dragover = false
      copy_feedback.reset()
    },
    set_hover,
    clear_preview,
    select_entry,
    close_structure_popup,
    copy_entry_data,
    root_attachments,
  }
}

export type HullSelection = ReturnType<typeof create_hull_selection>

interface CanvasInteractionInputs extends Pick<
  HullSelectionInputs,
  `plot_entries` | `selected_entry` | `wrapper`
> {
  selection: () => HullSelection
  // Camera defaults, drag rotation, zoom clamp and point shadow of the ternary/quaternary view
  strategy: draw.HullCanvasStrategy
  canvas: () => HTMLCanvasElement | undefined
  // Transparent layer over `canvas` holding only the pulsing rings, so ticks skip the hull
  overlay_canvas: () => HTMLCanvasElement | undefined
  elements: () => ElementSymbol[]
  visible_entries: () => ConvexHullEntry[]
  project_point: () => draw.ProjectPoint
  // Point styling
  highlighted_entries: () => (string | PhaseData)[]
  highlight_style: () => HighlightStyle | undefined
  color_mode: () => `stability` | `energy`
  color_scale: () => ColorScale
  colors: () => ConvexHullConfig[`colors`] | undefined
  labels: () => { show_labels?: boolean } & Pick<
    draw.LabelOpts,
    `show_stable_labels` | `show_unstable_labels` | `max_hull_dist_show_labels`
  >
  // Draws the hull onto the cleared `ctx` (CSS-pixel coordinates); calls
  // draw_points/draw_labels where they belong in its paint order
  render_frame: (ctx: CanvasRenderingContext2D) => void
  // Everything else `render_frame` reads: it draws inside a rAF where reads aren't tracked, so
  // a missing value leaves the canvas silently stale. List deriveds read, not their inputs.
  repaint_deps: () => unknown
}

export function create_canvas_interactions(inputs: CanvasInteractionInputs) {
  const { strategy } = inputs
  const selection = inputs.selection()
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
  // Rotated view coordinates → canvas position: x = origin_x + view_x * view_scale, y the
  // same but flipped for canvas coordinates. One snapshot per pan/zoom/resize, so projecting
  // a point reads no reactive state.
  const screen = $derived({
    origin_x: canvas_dims.width / 2 + camera.center_x,
    origin_y: canvas_dims.height / 2 + camera.center_y,
    view_scale,
  })

  // === Point styling ===
  // Per-point predicates close over their inputs, read once per change rather than per point
  // per frame (reactive prop reads were most of a 50k-point repaint)
  const highlight_style = $derived(merge_highlight_style(inputs.highlight_style()))
  const is_highlighted = $derived(highlight_matcher(inputs.highlighted_entries()))
  const energy_color_scale = $derived(
    get_energy_color_scale(inputs.color_mode(), inputs.color_scale(), inputs.plot_entries()),
  )
  const get_point_color = $derived.by(() => {
    const [color_mode, colors, scale] = [
      inputs.color_mode(),
      inputs.colors(),
      energy_color_scale,
    ]
    return (entry: ConvexHullEntry): string =>
      get_point_color_for_entry(entry, color_mode, colors, scale)
  })
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
    const [delta_x, delta_y] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]
    if (delta_x !== 0 || delta_y !== 0) drag_started = true
    if (event.shiftKey) {
      // shift pans like the 3D scenes; ⌘/Ctrl, the wheel's zoom chord, still rotates
      camera.center_x += delta_x
      camera.center_y += delta_y
    } else strategy.rotate(camera, delta_x, delta_y)
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
    draw.find_hull_entry_at_mouse(inputs.canvas(), event, pick_index)

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
    } else selection.close_structure_popup()
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) void selection.copy_entry_data(entry, { x: event.clientX, y: event.clientY })
  }

  // === Rendering ===

  // Cache all point projections + depth sorting per camera/data change
  const sorted_points_cache = $derived.by((): draw.HullPoint[] => {
    if (!inputs.canvas()) return []
    const project = inputs.project_point()
    return inputs
      .visible_entries()
      .map((entry) => ({ entry, projected: project(entry.x, entry.y, entry.z) }))
      .toSorted((left, right) => left.projected.depth - right.projected.depth)
  })

  const pick_index = $derived(
    draw.build_hull_pick_index(sorted_points_cache, canvas_dims.scale),
  )

  const draw_points = (target: CanvasRenderingContext2D) =>
    draw.draw_hull_points(target, sorted_points_cache, hull_point_opts())

  function draw_labels(target: CanvasRenderingContext2D): void {
    const { show_labels, ...toggles } = inputs.labels()
    if (!show_labels) return
    draw.draw_hull_labels(target, inputs.visible_entries(), {
      ...toggles,
      project: inputs.project_point(),
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

  // Base canvas: the scene; overlay: pulsing markers. The scene waits for elements (data
  // loaded), which the corner labels need.
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
    camera, // the $state proxy itself, so writes through it repaint
    reset_camera,
    recenter_camera,
    get is_highlighted() {
      return is_highlighted
    },
    get get_point_color() {
      return get_point_color
    },
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
    get screen() {
      return screen
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
      ondblclick: handle_double_click,
      onwheel: handle_wheel,
      // the pointer leaving (onto the chrome or off the page) ends the hover and its preview
      onmouseleave: () => selection.set_hover(null),
    },
    // document-level so drags continue outside the canvas; attached individually
    // since <svelte:document> rejects spread attributes
    handle_mouse_move,
    handle_mouse_up,
  }
}
