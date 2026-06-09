// Shared canvas-interaction scaffold (runes-in-closure factory) for ConvexHull3D/4D.
import { set_fullscreen_bg, setup_fullscreen_effect } from '$lib/layout'
import type { AnyStructure } from '$lib/structure'
import * as helpers from './helpers'
import type { ConvexHullEntry, HoverData3D, PhaseData } from './types'

export interface CanvasInteractionInputs {
  // Static config
  wheel_clamp: [min: number, max: number] // zoom clamp range
  fullscreen_bg_var: string // e.g. `--hull-3d-bg-fullscreen`
  // Reactive getters / element refs
  canvas: () => HTMLCanvasElement | undefined
  wrapper: () => HTMLDivElement | undefined
  // Canvas 2D context + dims live in the component (read by its draw functions)
  ctx: () => CanvasRenderingContext2D | null
  set_ctx: (ctx: CanvasRenderingContext2D | null) => void
  set_canvas_dims: (dims: { width: number; height: number; scale: number }) => void
  visible_entries: () => ConvexHullEntry[]
  plot_entries: () => ConvexHullEntry[]
  selected_entry: () => ConvexHullEntry | null
  set_selected_entry: (entry: ConvexHullEntry | null) => void
  fullscreen: () => boolean
  enable_click_selection: () => boolean
  enable_structure_preview: () => boolean
  on_point_click: () => ((entry: ConvexHullEntry) => void) | undefined
  on_point_hover: () => ((data: HoverData3D | null) => void) | undefined
  on_file_drop: () => ((entries: PhaseData[]) => void) | undefined
  zoom: () => number
  set_zoom: (zoom: number) => void
  // Component-specific behavior
  project_point: (x: number, y: number, z: number) => { x: number; y: number; depth: number }
  extract_structure: (entry: ConvexHullEntry) => AnyStructure | null
  render_frame: () => void
  on_drag: (dx: number, dy: number, panning: boolean) => void
  on_fullscreen_change: () => void // e.g. reset camera pan center
  actions: () => Record<string, () => void> // keydown actions map (thunk avoids TDZ)
}

export function create_canvas_interactions(inputs: CanvasInteractionInputs) {
  const [zoom_min, zoom_max] = inputs.wheel_clamp

  // Performance optimization: coalesce renders into one rAF
  let frame_id = 0

  // Interaction state
  let is_dragging = $state(false)
  let drag_started = $state(false)
  let last_mouse = $state({ x: 0, y: 0 })
  let hover_data = $state.raw<HoverData3D | null>(null)
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })

  // Drag and drop state
  let drag_over = $state(false)

  // Structure popup state
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let modal_place_right = $state(true)

  // Keep selection, hover, and popup pointing at current plot entry objects
  $effect(() => {
    const current_selection = helpers.current_entry(
      inputs.selected_entry(),
      inputs.plot_entries(),
    )
    if (inputs.selected_entry() && !current_selection) inputs.set_selected_entry(null)
    else if (
      current_selection &&
      !helpers.same_entry(current_selection, inputs.selected_entry())
    )
      inputs.set_selected_entry(current_selection)
    const current_hover = helpers.current_entry(hover_data?.entry, inputs.plot_entries())
    if (hover_data?.entry && !current_hover) {
      hover_data = null
      inputs.on_point_hover()?.(null)
    } else if (hover_data && current_hover && current_hover !== hover_data.entry) {
      hover_data = { ...hover_data, entry: current_hover }
    }
    if (modal_open) {
      const structure = current_selection && inputs.extract_structure(current_selection)
      if (structure) selected_structure = structure
      else {
        modal_open = false
        selected_structure = null
      }
    }
  })

  // Shared selection logic for click and Enter key
  function select_entry(entry: ConvexHullEntry) {
    inputs.on_point_click()?.(entry)
    if (inputs.enable_click_selection()) {
      inputs.set_selected_entry(entry)
      if (inputs.enable_structure_preview()) {
        const structure = inputs.extract_structure(entry)
        if (structure) {
          selected_structure = structure
          modal_place_right = helpers.calculate_modal_side(inputs.wrapper())
          modal_open = true
        }
      }
    }
  }

  const handle_keydown = (event: KeyboardEvent) => {
    const target = event.target
    if (target instanceof HTMLElement && /INPUT|TEXTAREA/.test(target.tagName)) return

    // Stop canvas-originated keydown re-running on wrapper (both have onkeydown)
    if (target === inputs.canvas()) event.stopPropagation()

    if (event.key === `Escape` && modal_open) {
      close_structure_popup()
      return
    }

    // Handle Enter for keyboard accessibility - select hovered entry
    if (event.key === `Enter`) {
      const entry = hover_data?.entry
      if (entry) select_entry(entry)
      else if (modal_open) close_structure_popup()
      return
    }

    inputs.actions()[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await helpers.parse_hull_entries_from_drop(event)
    if (data) inputs.on_file_drop()?.(data)
  }

  const set_drag_over = (over: boolean) => (event: DragEvent) => {
    event.preventDefault()
    drag_over = over
  }
  const handle_drag_over = set_drag_over(true)
  const handle_drag_leave = set_drag_over(false)

  async function copy_entry_data(entry: ConvexHullEntry, position: { x: number; y: number }) {
    await helpers.copy_entry_to_clipboard(entry, position, (visible, pos) => {
      copy_feedback.visible = visible
      copy_feedback.position = pos
    })
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    hover_data = null
    inputs.on_point_hover()?.(null)
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (!is_dragging) return
    const [dx, dy] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]

    // Mark as drag if any movement occurred
    if (dx !== 0 || dy !== 0) drag_started = true

    // With Cmd/Ctrl held: pan the view instead of rotating
    inputs.on_drag(dx, dy, event.metaKey || event.ctrlKey)

    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_up = () => {
    // leave drag_started set so the trailing click can detect a concluded drag;
    // handle_click reads then clears it, and handle_mouse_down resets it next interaction
    is_dragging = false
  }

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    inputs.set_zoom(
      Math.max(zoom_min, Math.min(zoom_max, inputs.zoom() * (event.deltaY > 0 ? 0.98 : 1.02))),
    )
  }

  const handle_hover = (event: MouseEvent) => {
    if (is_dragging) return
    const entry = find_entry_at_mouse(event)
    hover_data = entry ? { entry, position: { x: event.clientX, y: event.clientY } } : null
    inputs.on_point_hover()?.(hover_data)
  }

  const find_entry_at_mouse = (event: MouseEvent): ConvexHullEntry | null =>
    helpers.find_hull_entry_at_mouse(
      inputs.canvas(),
      event,
      inputs.visible_entries(),
      inputs.project_point,
    )

  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    const was_drag = drag_started // Check if this was a drag operation (any mouse movement during drag)
    drag_started = false // Reset for next interaction
    if (was_drag) return // Don't trigger click if this was a drag

    const entry = find_entry_at_mouse(event)
    if (!entry) {
      if (modal_open) close_structure_popup()
      return
    }
    select_entry(entry)
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    inputs.set_selected_entry(null)
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) void copy_entry_data(entry, { x: event.clientX, y: event.clientY })
  }

  function render_once() {
    if (frame_id) return
    frame_id = requestAnimationFrame(() => {
      inputs.render_frame()
      frame_id = 0
    })
  }

  function update_canvas_size() {
    const canvas = inputs.canvas()
    if (!canvas) return
    const dpr = globalThis.devicePixelRatio || 1
    const container = canvas.parentElement
    const rect = container?.getBoundingClientRect()
    const [width, height] = rect ? [rect.width, rect.height] : [400, 400]

    // Only update canvas dimensions if they actually changed
    // (assigning canvas.width/height clears the canvas even if values are the same)
    const new_width = Math.max(0, Math.round(width * dpr))
    const new_height = Math.max(0, Math.round(height * dpr))
    if (!inputs.ctx() || canvas.width !== new_width || canvas.height !== new_height) {
      canvas.width = new_width
      canvas.height = new_height
      const ctx = canvas.getContext(`2d`)
      inputs.set_ctx(ctx)
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = `high`
      }
    }
    inputs.set_canvas_dims({ width, height, scale: Math.min(width, height) / 600 })
    render_once()
  }

  $effect(() => {
    const canvas = inputs.canvas()
    if (!canvas) return undefined

    update_canvas_size() // Initial setup

    // Watch for resize events - only update canvas, don't reset camera
    const resize_observer = new ResizeObserver(update_canvas_size)

    const container = canvas.parentElement
    if (container) resize_observer.observe(container)

    return () => {
      if (frame_id) cancelAnimationFrame(frame_id)
      resize_observer.disconnect() // Cleanup on unmount
    }
  })

  // Fullscreen handling with camera reset
  let was_fullscreen = $state(inputs.fullscreen())
  $effect(() => {
    setup_fullscreen_effect(inputs.fullscreen(), inputs.wrapper(), (entering) => {
      if (entering !== was_fullscreen) {
        inputs.on_fullscreen_change()
        was_fullscreen = entering
      }
    })
    set_fullscreen_bg(inputs.wrapper(), inputs.fullscreen(), inputs.fullscreen_bg_var)
  })

  // Performance: Pre-compute and cache all point projections + depth sorting
  const sorted_points_cache = $derived.by(() => {
    if (!inputs.canvas() || inputs.visible_entries().length === 0) return []
    return inputs
      .visible_entries()
      .map((entry) => ({
        entry,
        projected: inputs.project_point(entry.x, entry.y, entry.z),
      }))
      .sort((left, right) => left.projected.depth - right.projected.depth)
  })

  return {
    get is_dragging() {
      return is_dragging
    },
    get hover_data() {
      return hover_data
    },
    get drag_over() {
      return drag_over
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
    get sorted_points_cache() {
      return sorted_points_cache
    },
    copy_feedback, // stable $state proxy; mutated in place for ClickFeedback binding
    handle_keydown,
    handle_file_drop,
    handle_drag_over,
    handle_drag_leave,
    handle_mouse_down,
    handle_mouse_move,
    handle_mouse_up,
    handle_wheel,
    handle_hover,
    handle_click,
    handle_double_click,
    close_structure_popup,
    render_once,
  }
}
