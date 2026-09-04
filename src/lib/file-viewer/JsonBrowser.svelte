<script lang="ts">
  import { contrast_text_color, pick_contrast_color, resolve_backdrop } from '$lib/colors'
  import { format_path, resolve_path } from '$lib/json-path'
  import { plural } from '$lib/labels'
  import JsonTree from 'svelte-widgets/JsonTree.svelte'
  import { relative_path_segments } from 'svelte-widgets/json-tree/utils'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import { clamp } from '$lib/math'
  import { merge } from '$lib/settings'
  import type { DefaultSettings } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import {
    is_structure_like,
    optimade_structure_from_raw,
    optimade_to_structure,
    structure_from_json,
  } from '$lib/structure/parse'
  import { to_error } from '$lib/utils'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import { type mount, onDestroy, unmount } from 'svelte'
  import {
    detect_view_type,
    scan_renderable_paths,
    TYPE_COLORS,
    TYPE_LABELS,
    volume_json_to_isosurface_input,
  } from './detect'
  import type { RenderableType } from './detect'
  import { mount_viewer, type ViewerMountType } from './mount-viewer'

  let {
    value,
    defaults,
    filename,
  }: {
    value: unknown
    defaults?: DefaultSettings
    filename?: string
  } = $props()

  // === Panel state ===
  // Panels are a flat list with a split direction between consecutive panels and a parallel
  // array of flex weights. Each panel's viewer is mounted by the attach_viewer attachment on
  // its element, so a panel lives exactly as long as its DOM node (the list is keyed by id).
  interface PanelSpec {
    data_path: string
    detected_type: RenderableType
    val: unknown
  }
  interface PanelInfo extends PanelSpec {
    id: number // each-block key: a replaced panel gets a new id and so a fresh viewer
  }

  type SplitDirection = `horizontal` | `vertical`

  // raw: panels are replaced, never mutated, and a deep proxy over large JSON values would
  // slow every viewer that reads them
  let panels = $state.raw<PanelInfo[]>([])
  let panel_sizes = $state<number[]>([]) // flex weight per panel (parallel to panels[])
  let split_directions = $state<SplitDirection[]>([]) // direction between panels[i] and panels[i+1]

  // Debounce timer for rapid tree selections (see handle_select)
  let select_timer: ReturnType<typeof setTimeout> | undefined

  // Scan for renderable paths after the tree has rendered so large JSON files don't block
  // the first paint (setTimeout rather than requestIdleCallback, which Safari lacks).
  let renderable_paths = $state(new Map<string, RenderableType>())
  let auto_rendered = false
  let last_scanned_value: unknown
  $effect(() => {
    const current_value = value
    // PanelInfo.val captures the subtree, so a replaced document would leave open panels
    // showing the old one and a sticky auto_rendered would suppress auto-render of the new root
    if (current_value !== last_scanned_value) {
      last_scanned_value = current_value
      auto_rendered = false
      close_all_panels()
    }
    const scan_handle = setTimeout(() => {
      renderable_paths = scan_renderable_paths(current_value)
      // Auto-render if the root value itself is a single renderable type
      // (avoids forcing the user to click for single-type JSON files)
      const root_type = renderable_paths.get(``)
      if (root_type && !auto_rendered) {
        auto_rendered = true
        replace_or_add_panel({ data_path: ``, detected_type: root_type, val: current_value })
      }
    }, 0)
    return () => clearTimeout(scan_handle)
  })

  // Sidebar width in px (PaneDivider writes it to --split-pane-size): the tree wants ~320 px
  // regardless of how wide the editor is, and the divider's pixel clamps keep both panes
  // usable on a drag and as the browser resizes
  const SIDEBAR_MIN_PX = 150
  const CANVAS_MIN_PX = 200
  let sidebar_px = $state(320)

  // a pending selection must not render into a dead browser
  onDestroy(() => clearTimeout(select_timer))

  // === Drag-and-drop from tree ===
  let drop_zone = $state<`top` | `bottom` | `left` | `right` | `center` | null>(null)
  let drop_target_panel_idx = $state<number>(-1)
  let canvas_element: HTMLElement | undefined = $state()
  const backdrop = resolve_backdrop(() => canvas_element, {
    css_var: [`--vscode-editor-background`, `--page-bg`, `--surface-bg`],
  })

  let sidebar_element: HTMLElement | undefined = $state()

  // Strip internal suffix used to register multiple renderable types at the same path
  function strip_type_suffix(path: string): string {
    const idx = path.indexOf(`\u0000`)
    return idx !== -1 ? path.slice(0, idx) : path
  }

  // The panel a badge, chip or drop payload asks for; null when its type is unknown or its
  // path no longer resolves in `value`
  function resolve_renderable(raw_path: unknown, detected_type: unknown): PanelSpec | null {
    if (typeof raw_path !== `string`) return null
    if (typeof detected_type !== `string` || !(detected_type in TYPE_LABELS)) return null
    const data_path = strip_type_suffix(raw_path)
    const val = resolve_path(value, data_path)
    if (val === undefined) return null
    return { data_path, detected_type: detected_type as RenderableType, val }
  }

  // Convert a data path (relative to JSON root) to the tree path used by JsonTree, whose
  // root node is labelled with the verbatim filename and whose children append `.key` or
  // `[idx]` to it (so `[0]` must not get a dot: `data.json[0]`, not `data.json.[0]`)
  function data_to_tree_path(data_path: string): string {
    const clean = strip_type_suffix(data_path)
    if (!filename) return clean
    if (!clean) return filename
    return clean.startsWith(`[`) ? `${filename}${clean}` : `${filename}.${clean}`
  }
  // Inverse of data_to_tree_path for paths reported by JsonTree
  const tree_to_data_path = (tree_path: string): string =>
    format_path(relative_path_segments(tree_path, filename))

  // Build a map of tree paths that are renderable (for fast draggable lookup).
  // Skip synthetic suffix paths (\x00...) since those have their own badge drag handlers.
  let renderable_tree_paths = $derived(
    new Map(
      [...renderable_paths]
        .filter(([data_path]) => !data_path.includes(`\u0000`))
        .map(([data_path, type]) => [data_to_tree_path(data_path), { data_path, type }]),
    ),
  )

  // Single delegated dragstart handler on sidebar (no per-node listeners needed)
  $effect(() => {
    if (!sidebar_element) return
    function on_dragstart(event: DragEvent): void {
      if (!event.dataTransfer) {
        event.preventDefault()
        return
      }
      const origin = event.target
      if (!(origin instanceof HTMLElement)) return
      // A badge carries its own path/type; a tree node is looked up by its tree path
      const badge = origin.closest<HTMLElement>(`.renderable-badge`)
      const node = badge ? null : origin.closest<HTMLElement>(`[data-path]`)
      if (!badge && !node) return
      const info = badge
        ? {
            data_path: badge.dataset.renderable_path ?? ``,
            type: badge.dataset.renderable_type,
          }
        : renderable_tree_paths.get(node?.dataset.path ?? ``)
      if (!info) {
        event.preventDefault()
        return
      }
      const payload = { data_path: info.data_path, detected_type: info.type ?? `` }
      event.dataTransfer.setData(`text/plain`, JSON.stringify(payload))
      event.dataTransfer.effectAllowed = `copy`
    }
    sidebar_element.addEventListener(`dragstart`, on_dragstart)
    return () => sidebar_element?.removeEventListener(`dragstart`, on_dragstart)
  })

  // === Badge injection ===
  // One pass over the tree's nodes: mark renderable ones draggable (no per-node listeners)
  // and inject a badge per renderable path, keyed by the node's tree path
  function apply_badges(): void {
    if (!sidebar_element) return
    for (const existing of sidebar_element.querySelectorAll(`.renderable-badge`)) {
      existing.remove()
    }
    const badges_by_tree_path = Map.groupBy(renderable_paths, ([data_path]) =>
      data_to_tree_path(data_path),
    )
    for (const node of sidebar_element.querySelectorAll<HTMLElement>(`[data-path]`)) {
      const tree_path = node.dataset.path ?? ``
      node.draggable = renderable_tree_paths.has(tree_path)
      const insert_after =
        node.querySelector(`.colon`) ?? node.querySelector(`.node-key`) ?? node
      for (const [data_path, type] of badges_by_tree_path.get(tree_path) ?? []) {
        const badge = document.createElement(`span`)
        badge.className = `renderable-badge`
        badge.textContent = TYPE_LABELS[type]
        badge.title = `Drag to canvas or click to render`
        badge.dataset.renderable_path = data_path
        badge.dataset.renderable_type = type
        badge.style.background = TYPE_COLORS[type]
        badge.style.color = pick_contrast_color({ background: TYPE_COLORS[type] })
        badge.draggable = true
        insert_after.after(badge)
      }
    }
  }

  // Delegated click handler for badges (avoids per-badge listeners that leak on re-render)
  // Uses capture phase to intercept before tree node fold/select handlers
  $effect(() => {
    if (!sidebar_element) return
    function on_badge_click(event: MouseEvent): void {
      const origin = event.target
      if (!(origin instanceof HTMLElement)) return
      const badge = origin.closest<HTMLElement>(`.renderable-badge`)
      if (!badge) return
      event.stopPropagation()
      event.preventDefault()
      const { renderable_path, renderable_type } = badge.dataset
      const spec = resolve_renderable(renderable_path ?? ``, renderable_type)
      if (spec) replace_or_add_panel(spec)
    }
    sidebar_element.addEventListener(`click`, on_badge_click, true)
    return () => sidebar_element?.removeEventListener(`click`, on_badge_click, true)
  })

  // Escape key closes all panels, returning to the overview
  $effect(() => {
    if (panels.length === 0) return
    function on_keydown(event: KeyboardEvent): void {
      if (event.key !== `Escape`) return
      if (is_editable_event_target(event.target)) return
      close_all_panels()
    }
    globalThis.addEventListener(`keydown`, on_keydown)
    return () => globalThis.removeEventListener(`keydown`, on_keydown)
  })

  // Re-apply badges when the tree DOM changes, coalescing rapid mutations into one rAF.
  // Badge insertion itself mutates the observed subtree and would re-schedule at rAF rate
  // forever, so the observer is detached while applying (a flag around apply_badges cannot
  // catch the asynchronously delivered records, and takeRecords() would also swallow unrelated
  // tree mutations queued in the meantime).
  $effect(() => {
    if (!sidebar_element) return
    // The scan lands after the tree has rendered, so a fresh result must re-apply badges
    // even though no tree node changed
    void renderable_tree_paths
    const observe_opts = { childList: true, subtree: true }
    let pending_raf: number | null = null
    const observer = new MutationObserver(schedule_refresh)
    function schedule_refresh(): void {
      if (pending_raf !== null) return
      pending_raf = requestAnimationFrame(() => {
        pending_raf = null
        observer.disconnect()
        apply_badges()
        if (sidebar_element) observer.observe(sidebar_element, observe_opts)
      })
    }
    schedule_refresh()
    observer.observe(sidebar_element, observe_opts)
    return () => {
      observer.disconnect()
      if (pending_raf !== null) cancelAnimationFrame(pending_raf)
    }
  })

  // === Panel management ===

  let panel_id_count = 0
  const make_panel = (spec: PanelSpec): PanelInfo => ({ id: panel_id_count++, ...spec })

  // Click replaces the single/first panel; drag adds a split. Re-selecting what the first
  // panel already shows is a no-op: a new id would tear down and rebuild its viewer
  function replace_or_add_panel(spec: PanelSpec): void {
    const [first] = panels
    if (
      first?.data_path === spec.data_path &&
      first.detected_type === spec.detected_type &&
      first.val === spec.val
    )
      return
    if (!first) panel_sizes = [1]
    panels = [make_panel(spec), ...panels.slice(1)]
  }

  // Only reached with a panel to split (on_canvas_drop sends an empty canvas to
  // replace_or_add_panel), so the target panel always exists
  function add_panel_with_split(
    spec: PanelSpec,
    target_idx: number,
    zone: `top` | `bottom` | `left` | `right`,
  ): void {
    const direction: SplitDirection =
      zone === `top` || zone === `bottom` ? `vertical` : `horizontal`
    const insert_idx = zone === `top` || zone === `left` ? target_idx : target_idx + 1
    const new_panels = [...panels]
    const new_sizes = [...panel_sizes]
    const new_dirs = [...split_directions]
    // Split the target panel's size in half: new panel gets half, target keeps half
    const target_size = new_sizes[target_idx] ?? 1
    new_sizes[target_idx] = target_size / 2
    new_panels.splice(insert_idx, 0, make_panel(spec))
    new_sizes.splice(insert_idx, 0, target_size / 2)
    // Add direction between the two panels
    new_dirs.splice(target_idx, 0, direction)
    panels = new_panels
    panel_sizes = new_sizes
    split_directions = new_dirs
  }

  function close_panel(idx: number): void {
    const new_panels = [...panels]
    const new_sizes = [...panel_sizes]
    const new_dirs = [...split_directions]
    // Give the closed panel's size to its neighbor
    const closed_size = new_sizes[idx] ?? 0
    const neighbor_idx = idx > 0 ? idx - 1 : idx + 1
    if (neighbor_idx < new_sizes.length) new_sizes[neighbor_idx] += closed_size
    new_panels.splice(idx, 1)
    new_sizes.splice(idx, 1)
    // Remove the adjacent split direction
    if (new_dirs.length > 0) {
      const dir_idx = Math.min(idx, new_dirs.length - 1)
      new_dirs.splice(dir_idx, 1)
    }
    panels = new_panels
    panel_sizes = new_sizes
    split_directions = new_dirs
  }

  function close_all_panels(): void {
    panels = []
    panel_sizes = []
    split_directions = []
  }

  // === Component mounting ===

  // Throws rather than casting: attach_viewer turns this into a panel message naming the problem
  function prepare_structure(val: unknown): AnyStructure {
    const optimade = optimade_structure_from_raw(val)
    if (optimade) return optimade_to_structure(optimade)
    if (!is_structure_like(val)) {
      throw new TypeError(
        `JSON value is neither an OPTIMADE response nor a pymatgen-style structure`,
      )
    }
    return structure_from_json(val)
  }

  // Raw JSON values need promoting to the typed inputs the viewers expect (structures get
  // lattices/coordinates normalised, volumetric grids become typed arrays); the shared
  // mount_viewer table then does the same dispatch as the webview entry point
  function json_to_viewer_input(
    detected_type: RenderableType,
    val: unknown,
  ): { type: ViewerMountType; data: unknown } {
    if (detected_type === `structure`)
      return { type: `structure`, data: prepare_structure(val) }
    if (detected_type === `volumetric`)
      return { type: `isosurface`, data: volume_json_to_isosurface_input(val) }
    if (detected_type === `brillouin_zone`) {
      const record = val as Record<string, unknown>
      return {
        type: detected_type,
        data: record.structure
          ? { ...record, structure: prepare_structure(record.structure) }
          : val,
      }
    }
    return { type: detected_type, data: val }
  }

  // Merge defaults once (reused across all panel mounts)
  const merged_defaults = $derived(merge(defaults))

  // Mounts the panel's viewer into its element and unmounts it when the element goes away
  // (panel closed, replaced or the browser destroyed), so GPU devices and three.js renderers
  // never leak. Reading merged_defaults here remounts every panel when the defaults change
  const attach_viewer = (panel: PanelInfo) => (target: HTMLElement) => {
    const on_close = () => {
      const idx = panels.findIndex((candidate) => candidate.id === panel.id)
      if (idx === -1) return
      if (panels.length > 1) close_panel(idx)
      else close_all_panels()
    }
    let app: ReturnType<typeof mount> | null = null
    let error_el: HTMLElement | null = null
    try {
      const { type, data } = json_to_viewer_input(panel.detected_type, panel.val)
      app = mount_viewer(target, type, data, { defaults: merged_defaults, on_close })
    } catch (error) {
      console.error(`JsonBrowser: mount failed for ${panel.detected_type}:`, error)
      // A blank panel would look like an empty dataset; say what went wrong instead
      error_el = document.createElement(`div`)
      error_el.className = `panel-error`
      error_el.textContent = `Failed to render ${TYPE_LABELS[panel.detected_type]}: ${to_error(error).message}`
      target.replaceChildren(error_el)
    }
    return () => {
      error_el?.remove()
      if (!app) return
      // A viewer whose teardown throws must not keep its sibling panels from releasing theirs
      try {
        unmount(app)
      } catch (error) {
        console.error(`JsonBrowser: unmount failed for ${panel.detected_type}:`, error)
      }
    }
  }

  // === Drop zone detection ===

  function get_drop_zone(
    event: DragEvent,
    rect: DOMRect,
  ): `top` | `bottom` | `left` | `right` | `center` {
    const rel_x = (event.clientX - rect.left) / rect.width
    const rel_y = (event.clientY - rect.top) / rect.height
    const edge_threshold = 0.25
    if (rel_y < edge_threshold) return `top`
    if (rel_y > 1 - edge_threshold) return `bottom`
    if (rel_x < edge_threshold) return `left`
    if (rel_x > 1 - edge_threshold) return `right`
    return `center`
  }

  function on_canvas_dragover(event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = `copy`
    if (!canvas_element) return
    // Default to center/first panel; override if cursor is inside a specific panel
    drop_zone = `center`
    drop_target_panel_idx = 0
    const panel_els = canvas_element.querySelectorAll(`.viz-panel`)
    for (let idx = 0; idx < panel_els.length; idx++) {
      const rect = panel_els[idx].getBoundingClientRect()
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        drop_zone = get_drop_zone(event, rect)
        drop_target_panel_idx = idx
        break
      }
    }
    // Prevent mixed-axis splits until nested layouts are supported
    const cross_axis =
      split_directions[0] === `vertical` ? [`left`, `right`] : [`top`, `bottom`]
    if (split_directions.length > 0 && cross_axis.includes(drop_zone ?? ``)) {
      drop_zone = `center`
    }
  }

  function on_canvas_dragleave(event: DragEvent): void {
    // Only clear if leaving the canvas entirely
    if (canvas_element && !canvas_element.contains(event.relatedTarget as Node)) {
      drop_zone = null
      drop_target_panel_idx = -1
    }
  }

  function on_canvas_drop(event: DragEvent): void {
    event.preventDefault()
    const raw = event.dataTransfer?.getData(`text/plain`)
    // Capture the already-computed drop state before clearing it
    const zone = drop_zone
    const target_idx = Math.max(0, drop_target_panel_idx)
    drop_zone = null
    drop_target_panel_idx = -1
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { data_path?: string; detected_type?: unknown }
      const spec = resolve_renderable(parsed.data_path, parsed.detected_type)
      if (!spec) return
      if (panels.length === 0 || zone === `center` || !zone) replace_or_add_panel(spec)
      else add_panel_with_split(spec, target_idx, zone)
    } catch (error) {
      console.error(`JsonBrowser: drop failed:`, error)
    }
  }

  // === Panel split divider dragging ===
  // The divider captures the pointer, so moves and the release reach it wherever the cursor
  // goes (even outside a webview iframe), with no document listeners to unregister. The two
  // panels either side share their flex weight; the drag moves weight between them.
  let split_drag = $state<{
    idx: number
    pointer_id: number
    start_pos: number
    container_size: number
    total_flex: number
    start_left: number
  } | null>(null)

  function start_split_drag(
    event: PointerEvent & { currentTarget: HTMLElement },
    split_idx: number,
  ): void {
    const direction = split_directions[split_idx]
    const panel_container = event.currentTarget.parentElement
    if (split_drag || event.button !== 0 || !direction || !panel_container) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const container_rect = panel_container.getBoundingClientRect()
    const is_vertical = direction === `vertical`
    const total_flex = (panel_sizes[split_idx] ?? 1) + (panel_sizes[split_idx + 1] ?? 1)
    split_drag = {
      idx: split_idx,
      pointer_id: event.pointerId,
      start_pos: is_vertical ? event.clientY : event.clientX,
      container_size: is_vertical ? container_rect.height : container_rect.width,
      total_flex,
      start_left: panel_sizes[split_idx] ?? total_flex / 2,
    }
  }
  function move_split_drag(event: PointerEvent): void {
    if (!split_drag || event.pointerId !== split_drag.pointer_id) return
    const { idx, start_pos, container_size, total_flex, start_left } = split_drag
    if (container_size <= 0) return
    const current_pos = split_directions[idx] === `vertical` ? event.clientY : event.clientX
    const moved_flex = ((current_pos - start_pos) / container_size) * total_flex
    const new_left = clamp(start_left + moved_flex, total_flex * 0.1, total_flex * 0.9)
    panel_sizes[idx] = new_left
    panel_sizes[idx + 1] = total_flex - new_left
  }
  function end_split_drag(event: PointerEvent): void {
    if (split_drag?.pointer_id === event.pointerId) split_drag = null
  }

  // === Helpers ===

  // Clicking a renderable tree node renders it in the main panel. JsonTree reports a selection
  // on every ArrowUp/ArrowDown and twice on a double-click, and each render tears down a full
  // viewer (Three.js scene included), so selections are debounced to the last one
  function handle_select(tree_path: string, val: unknown): void {
    clearTimeout(select_timer)
    select_timer = setTimeout(() => {
      const detected_type = detect_view_type(val)
      if (detected_type)
        replace_or_add_panel({ data_path: tree_to_data_path(tree_path), detected_type, val })
    }, 150)
  }

  // The first split direction determines the flex layout direction
  let layout_direction = $derived(
    split_directions.length > 0 ? split_directions[0] : `vertical`,
  )

  const type_color = (key: string) => TYPE_COLORS[key as RenderableType]
</script>

{#snippet type_list(header: string, extra_style?: string)}
  <div class="type-list" style={extra_style ?? ``}>
    <p class="type-list-header">{header}</p>
    {#each Object.entries(TYPE_LABELS) as [type_key, label] (type_key)}
      <span class="type-tag" style="border-color: {type_color(type_key)}44;">
        <span class="chip-dot" style="background: {type_color(type_key)};"></span>
        {label}
      </span>
    {/each}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="json-browser" class:dragging={split_drag !== null}>
  <aside class="sidebar" bind:this={sidebar_element}>
    <JsonTree
      {value}
      root_label={filename}
      default_fold_level={1}
      on_select={handle_select}
      show_header
    />
  </aside>

  <PaneDivider
    orientation="horizontal"
    bind:first_px={sidebar_px}
    min_px={SIDEBAR_MIN_PX}
    second_min_px={CANVAS_MIN_PX}
    aria-label="Resize JSON tree and viewer panes"
  />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="canvas"
    bind:this={canvas_element}
    ondragover={on_canvas_dragover}
    ondragleave={on_canvas_dragleave}
    ondrop={on_canvas_drop}
  >
    {#if panels.length === 0}
      <!-- Placeholder when no panels -->
      <div class="placeholder">
        {#if renderable_paths.size === 0}
          <p class="placeholder-title">No renderable data found</p>
          <p class="placeholder-sub">
            This JSON file doesn't contain recognized visualization data.
          </p>
          {@render type_list(`Recognized types:`)}
        {:else}
          <p class="placeholder-title">Click or drag a data node to visualize it</p>
          <p class="placeholder-sub">
            Found {plural(renderable_paths.size, `renderable item`)}. Click to render, or drag
            to an edge to create a split view.
          </p>
          <div
            style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;"
          >
            {#each [...renderable_paths] as [data_path, type] (data_path)}
              <button
                type="button"
                class="renderable-chip"
                style="background: {TYPE_COLORS[type]}22; border: 1px solid {TYPE_COLORS[
                  type
                ]}66;"
                onclick={() => {
                  const spec = resolve_renderable(data_path, type)
                  if (spec) replace_or_add_panel(spec)
                }}
              >
                <span class="chip-dot" style="background: {TYPE_COLORS[type]};"></span>
                {TYPE_LABELS[type]}: <code>{strip_type_suffix(data_path) || `root`}</code>
              </button>
            {/each}
          </div>
          {@render type_list(`All recognized types:`, `margin-top: 20px`)}
        {/if}
      </div>
    {:else}
      <!-- Panel layout -->
      <div
        class="panel-container"
        class:vertical={layout_direction === `vertical`}
        class:horizontal={layout_direction === `horizontal`}
      >
        {#each panels as panel, idx (panel.id)}
          {@const panel_background = `${TYPE_COLORS[panel.detected_type]}cc`}
          {#if idx > 0 && split_directions[idx - 1]}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="split-divider"
              class:vertical={split_directions[idx - 1] === `vertical`}
              class:horizontal={split_directions[idx - 1] === `horizontal`}
              class:active={split_drag?.idx === idx - 1}
              onpointerdown={(event) => start_split_drag(event, idx - 1)}
              onpointermove={move_split_drag}
              onpointerup={end_split_drag}
              onpointercancel={end_split_drag}
              onlostpointercapture={end_split_drag}
            ></div>
          {/if}
          <div class="viz-panel" style="flex: {panel_sizes[idx] ?? 1}">
            <div class="panel-mount" {@attach attach_viewer(panel)}></div>
            <!-- Panel label -->
            <div
              class="panel-label"
              style:background={panel_background}
              style:color={contrast_text_color({
                background: panel_background,
                backdrop: backdrop.current,
              })}
            >
              {TYPE_LABELS[panel.detected_type]}: {strip_type_suffix(panel.data_path)}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Drop zone overlay -->
    {#if drop_zone && drop_zone !== `center`}
      <div class={[`drop-indicator`, drop_zone]}></div>
    {/if}
  </div>
</div>

<style>
  .json-browser {
    display: grid;
    /* PaneDivider owns the sidebar width (px, clamped) and writes it to --split-pane-size */
    grid-template-columns: var(--split-pane-size, 320px) minmax(0, 1fr);
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--vscode-editor-background, var(--page-bg, var(--surface-bg, Canvas)));
    color: var(--vscode-editor-foreground, var(--text-color, CanvasText));
    --active-color: var(--vscode-focusBorder, #007fd4);
  }
  .json-browser.dragging {
    user-select: none;
  }
  .sidebar {
    min-width: 0;
    overflow: auto;
    padding: 4px;
  }
  .canvas {
    min-width: 0;
    height: 100%;
    position: relative;
    overflow: hidden;
  }
  /* === Panel layout === */
  .panel-container {
    display: flex;
    width: 100%;
    height: 100%;
  }
  .panel-container.vertical {
    flex-direction: column;
  }
  .panel-container.horizontal {
    flex-direction: row;
  }
  .viz-panel {
    position: relative;
    overflow: hidden;
    min-width: 100px;
    min-height: 80px;
  }
  .panel-mount {
    width: 100%;
    height: 100%;
  }
  /* Created imperatively by attach_viewer, so :global keeps Svelte from stripping the rule */
  :global(.panel-error) {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 1rem;
    text-align: center;
    color: var(--error-color, var(--vscode-errorForeground, #f85149));
  }
  .panel-label {
    position: absolute;
    bottom: 4px;
    left: 4px;
    z-index: 10;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    pointer-events: none;
    white-space: nowrap;
    max-width: calc(100% - 16px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* === Split dividers === */
  .split-divider {
    flex-shrink: 0;
    background: var(--vscode-panel-border, rgba(255, 255, 255, 0.15));
    transition: background 0.15s;
    z-index: 5;
    touch-action: none;
  }
  .split-divider.vertical {
    height: 5px;
    cursor: row-resize;
  }
  .split-divider.horizontal {
    width: 5px;
    cursor: col-resize;
  }
  .split-divider:hover,
  .split-divider.active {
    background: var(--vscode-focusBorder, #007fd4);
  }
  /* === Drop zone indicators === */
  .drop-indicator {
    position: absolute;
    background: rgba(0, 127, 212, 0.25);
    border: 2px solid var(--vscode-focusBorder, #007fd4);
    z-index: 20;
    pointer-events: none;
    transition: all 0.1s;
  }
  .drop-indicator.top {
    top: 0;
    left: 0;
    right: 0;
    height: 40%;
  }
  .drop-indicator.bottom {
    bottom: 0;
    left: 0;
    right: 0;
    height: 40%;
  }
  .drop-indicator.left {
    top: 0;
    left: 0;
    bottom: 0;
    width: 40%;
  }
  .drop-indicator.right {
    top: 0;
    right: 0;
    bottom: 0;
    width: 40%;
  }
  /* === Placeholder === */
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.8;
    padding: 2rem;
    text-align: center;
  }
  .placeholder-title {
    font-size: 16px;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .placeholder-sub {
    font-size: 13px;
    opacity: 0.65;
    max-width: 400px;
    line-height: 1.5;
  }
  .type-list {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    align-items: center;
  }
  .type-list-header {
    width: 100%;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.5;
    margin-bottom: 4px;
  }
  .type-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 10px;
    font-size: 11px;
    border: 1px solid;
    opacity: 0.7;
  }
  .renderable-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    cursor: pointer;
    color: inherit;
    transition: opacity 0.15s;
  }
  .renderable-chip:hover {
    opacity: 0.8;
  }
  .renderable-chip code {
    font-size: 11px;
    opacity: 0.8;
  }
  .chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  /* Badges are injected imperatively — use :global so Svelte doesn't strip the rule */
  :global(.renderable-badge) {
    font-size: 9px;
    padding: 1px 4px;
    margin-left: 4px;
    border-radius: 3px;
    font-weight: 500;
    white-space: nowrap;
    cursor: grab;
    flex-shrink: 0;
  }
</style>
