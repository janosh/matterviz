// Shared interaction scaffolds (runes-in-closure factories) for the convex hull components:
// create_hull_selection covers what 2D/3D/4D all do (selection, hover, structure popup,
// clipboard copy, keyboard, file drop); create_canvas_interactions adds the canvas-specific
// mouse handling, sizing and render scheduling that ConvexHull3D/4D share.
import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import { as_text, file_drop_zone } from '$lib/io'
import type { AnyStructure } from '$lib/structure'
import { createAttachmentKey } from 'svelte/attachments'
import * as draw from './canvas-draw'
import { build_entry_tooltip_text, current_entry, same_entry } from './helpers'
import type { ConvexHullEntry, EntryCategoryConfig, HoverData3D, PhaseData } from './types'

export interface HullSelectionInputs {
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

// Dropped JSON is accepted when it is a non-empty array of entries with a composition
function parse_hull_entries(text: string): PhaseData[] | null {
  const data: unknown = JSON.parse(text)
  if (!Array.isArray(data) || data.length === 0) return null
  const first: unknown = data[0]
  if (typeof first !== `object` || first === null || !(`composition` in first)) return null
  return data as PhaseData[]
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
    const target = event.target
    if (target instanceof HTMLElement && /INPUT|TEXTAREA/.test(target.tagName)) return
    // A canvas-originated keydown bubbles to the wrapper (both listen); handle it once
    if (target !== inputs.wrapper()) event.stopPropagation()

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

export interface CanvasInteractionInputs extends HullSelectionInputs {
  wheel_clamp: [min: number, max: number] // zoom clamp range
  canvas: () => HTMLCanvasElement | undefined
  // Transparent layer over `canvas` holding only the pulsing rings, so ticks skip the hull
  overlay_canvas: () => HTMLCanvasElement | undefined
  visible_entries: () => ConvexHullEntry[]
  zoom: () => number
  set_zoom: (zoom: number) => void
  project_point: draw.ProjectPoint
  // Draws the hull onto `ctx` (CSS-pixel coordinates, `width` × `height`)
  render_frame: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  // Everything `render_frame` reads. It draws inside a rAF, where reads don't register as
  // dependencies, so anything missing leaves the canvas silently stale. List the derived
  // values the draw code reads, not their inputs — the derivation keeps the list honest.
  repaint_deps: () => unknown
  hull_point_opts: () => draw.HullPointOpts
  pulse: () => { time: number; opacity: number }
  on_drag: (dx: number, dy: number, panning: boolean) => void
}

// Canvas text colour. Canvas takes a colour value, not a CSS variable, so the theme is read
// in JS (dark-mode fallbacks for unsupported light-dark()/var() values) and the canvas
// repainted on every flip.
function canvas_text_color(dark_mode: boolean): string {
  const fallback = dark_mode ? `#ffffff` : `#212121`
  if (typeof document === `undefined`) return fallback
  const css_value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--text-color`)
    .trim()
  return css_value && !/light-dark|var\(/i.test(css_value) ? css_value : fallback
}

export function create_canvas_interactions(inputs: CanvasInteractionInputs) {
  const selection = create_hull_selection(inputs)
  const [zoom_min, zoom_max] = inputs.wheel_clamp

  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))
  const text_color = $derived(canvas_text_color(dark_mode))

  // Contexts and CSS-pixel dims live here; the component's draw code gets them per frame
  let ctx: CanvasRenderingContext2D | null = null
  let overlay_ctx: CanvasRenderingContext2D | null = null
  let canvas_dims = $state({ width: 600, height: 600, scale: 1 })

  // Coalesce renders into one rAF per frame
  let frame_id = 0
  let hull_is_stale = false

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
    inputs.on_drag(dx, dy, event.metaKey || event.ctrlKey) // Cmd/Ctrl: pan instead of rotate
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  // leave drag_started set so the trailing click can detect a concluded drag;
  // handle_click reads then clears it, and handle_mouse_down resets it next interaction
  const handle_mouse_up = () => (is_dragging = false)

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    const zoomed = inputs.zoom() * (event.deltaY > 0 ? 0.98 : 1.02)
    inputs.set_zoom(Math.max(zoom_min, Math.min(zoom_max, zoomed)))
  }

  const find_entry_at_mouse = (event: MouseEvent): ConvexHullEntry | null =>
    draw.find_hull_entry_at_mouse(
      inputs.canvas(),
      event,
      inputs.visible_entries(),
      inputs.project_point,
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
    if (entry) selection.select_entry(entry)
    else if (selection.modal_open) selection.close_structure_popup()
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) void selection.copy_entry_data(entry, { x: event.clientX, y: event.clientY })
  }

  // One frame for both layers: the overlay always (a few markers, same projections), the hull
  // only when asked, so a pulse tick landing on a pending full redraw is absorbed not requeued
  function schedule_frame(redraw_hull: boolean) {
    hull_is_stale ||= redraw_hull
    if (frame_id) return
    frame_id = requestAnimationFrame(() => {
      if (hull_is_stale && ctx) {
        inputs.render_frame(ctx, canvas_dims.width || 600, canvas_dims.height || 600)
      }
      if (overlay_ctx) {
        draw.draw_pulse_overlay(
          overlay_ctx,
          sorted_points_cache,
          inputs.hull_point_opts(),
          inputs.pulse(),
        )
      }
      frame_id = 0
      hull_is_stale = false
    })
  }
  const render_once = () => schedule_frame(true)
  const render_overlay_once = () => schedule_frame(false) // pulse ticks: rings only

  $effect(() => {
    inputs.repaint_deps()
    render_once()
  })

  function update_canvas_size() {
    const canvas = inputs.canvas()
    if (!canvas) return
    const dpr = globalThis.devicePixelRatio || 1
    const rect = canvas.parentElement?.getBoundingClientRect()
    const [width, height] = rect ? [rect.width, rect.height] : [400, 400]
    const new_width = Math.max(0, Math.round(width * dpr))
    const new_height = Math.max(0, Math.round(height * dpr))
    // Assigning width/height clears a canvas even when unchanged, so only resize on a real
    // change; the DPR transform then lets draw code work in CSS pixels.
    const size_canvas = (
      node: HTMLCanvasElement | undefined,
      existing: CanvasRenderingContext2D | null,
    ): CanvasRenderingContext2D | null => {
      if (!node) return null
      if (existing && node.width === new_width && node.height === new_height) return existing
      node.width = new_width
      node.height = new_height
      const context = node.getContext(`2d`)
      if (context) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = `high`
      }
      return context
    }
    ctx = size_canvas(canvas, ctx)
    overlay_ctx = size_canvas(inputs.overlay_canvas(), overlay_ctx)
    canvas_dims = { width, height, scale: Math.min(width, height) / 600 }
    render_once()
  }

  $effect(() => {
    const canvas = inputs.canvas()
    if (!canvas) return undefined
    update_canvas_size()
    // Resize only re-sizes the canvas, never resets the camera
    const resize_observer = new ResizeObserver(update_canvas_size)
    if (canvas.parentElement) resize_observer.observe(canvas.parentElement)
    return () => {
      if (frame_id) cancelAnimationFrame(frame_id)
      frame_id = 0
      resize_observer.disconnect()
    }
  })

  // Cache all point projections + depth sorting per camera/data change
  const sorted_points_cache = $derived.by((): draw.HullPoint[] => {
    if (!inputs.canvas()) return []
    return inputs
      .visible_entries()
      .map((entry) => ({ entry, projected: inputs.project_point(entry.x, entry.y, entry.z) }))
      .toSorted((left, right) => left.projected.depth - right.projected.depth)
  })

  return {
    selection,
    get is_dragging() {
      return is_dragging
    },
    get canvas_dims() {
      return canvas_dims
    },
    get text_color() {
      return text_color
    },
    get sorted_points_cache() {
      return sorted_points_cache
    },
    // Event handler groups, spread onto their target elements by ConvexHull3D/4D
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
    render_once,
    render_overlay_once,
  }
}
