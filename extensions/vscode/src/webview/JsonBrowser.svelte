<script lang="ts">
  // Split-pane JSON browser for the VS Code extension.
  // Left sidebar shows a JsonTree for navigating the file's JSON structure.
  // Right canvas renders one or more visualization panels in a split layout.
  // Users can click tree nodes to render in the main panel, or drag nodes
  // to specific edges to create horizontal/vertical splits.
  import BrillouinZone from '$lib/brillouin/BrillouinZone.svelte';
  import ConvexHull from '$lib/convex-hull/ConvexHull.svelte';
  import type { PhaseData } from '$lib/convex-hull/types';
  import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte';
  import { is_fermi_surface_data } from '$lib/fermi-surface/types';
  import type { VolumetricData } from '$lib/isosurface/types';
  import JsonTree from '$lib/layout/json-tree/JsonTree.svelte';
  import IsobaricBinaryPhaseDiagram from '$lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte';
  import type { PhaseDiagramData } from '$lib/phase-diagram/types';
  import { merge, type DefaultSettings } from '$lib/settings';
  import Bands from '$lib/spectral/Bands.svelte';
  import BandsAndDos from '$lib/spectral/BandsAndDos.svelte';
  import Dos from '$lib/spectral/Dos.svelte';
  import type { BaseBandStructure, DosInput } from '$lib/spectral/types';
  import type { AnyStructure, LatticeType } from '$lib/structure';
  import {
      is_optimade_raw,
      normalize_fractional_coords,
      parse_optimade_from_raw,
  } from '$lib/structure/parse';
  import Structure from '$lib/structure/Structure.svelte';
  import type { RowData } from '$lib/table';
  import HeatmapTable from '$lib/table/HeatmapTable.svelte';
  import type { XrdPattern } from '$lib/xrd';
  import XrdPlot from '$lib/xrd/XrdPlot.svelte';
  import { mount, unmount } from 'svelte';
  import {
      detect_view_type,
      scan_renderable_paths,
      TYPE_COLORS,
      TYPE_LABELS,
      type RenderableType
  } from './detect';

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
  // Each panel holds a mounted component. Panels are arranged in a flat list
  // with split info (direction) between consecutive panels.
  // Panel sizing is stored as a parallel array of flex weights.
  interface PanelInfo {
    id: string
    data_path: string
    detected_type: RenderableType
    val: unknown
    component: ReturnType<typeof mount> | null
    element: HTMLElement | null
  }

  type SplitDirection = `horizontal` | `vertical`

  let panels = $state<PanelInfo[]>([])
  let panel_sizes = $state<number[]>([]) // flex weight per panel (parallel to panels[])
  let split_directions = $state<SplitDirection[]>([]) // direction between panels[i] and panels[i+1]

  // Debounce timer for rapid clicks (cleaned up when component is destroyed)
  let select_timer: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => { if (select_timer) clearTimeout(select_timer) })

  // Scan for renderable paths asynchronously to avoid blocking the UI on large JSON files.
  // Uses requestIdleCallback to yield to the main thread during tree rendering.
  let renderable_paths = $state(new Map<string, { type: RenderableType; label: string }>())
  $effect(() => {
    const current_value = value
    const idle_handle = requestIdleCallback(() => {
      renderable_paths = scan_renderable_paths(current_value)
    })
    return () => cancelIdleCallback(idle_handle)
  })

  // === Draggable sidebar divider ===
  let sidebar_width = $state(320)
  let is_sidebar_dragging = $state(false)

  // Generic drag cleanup helper -- in a webview iframe the cursor can leave the
  // document entirely, so we listen for mouseup, blur, and pointerleave to ensure
  // the drag always terminates.
  function start_drag(
    on_move: (event: MouseEvent) => void,
    on_done: () => void,
  ): void {
    let cleaned_up = false
    function cleanup(): void {
      if (cleaned_up) return
      cleaned_up = true
      on_done()
      window.removeEventListener(`mousemove`, on_move)
      window.removeEventListener(`mouseup`, cleanup)
      window.removeEventListener(`blur`, cleanup)
      document.documentElement.removeEventListener(`mouseleave`, cleanup)
    }
    window.addEventListener(`mousemove`, on_move)
    window.addEventListener(`mouseup`, cleanup)
    window.addEventListener(`blur`, cleanup)
    document.documentElement.addEventListener(`mouseleave`, cleanup)
  }

  function on_sidebar_divider_mousedown(event: MouseEvent): void {
    event.preventDefault()
    is_sidebar_dragging = true
    const start_x = event.clientX
    const start_width = sidebar_width
    start_drag(
      (move_event) => {
        const delta = move_event.clientX - start_x
        sidebar_width = Math.max(150, Math.min(start_width + delta, window.innerWidth * 0.6))
      },
      () => { is_sidebar_dragging = false },
    )
  }

  // === Drag-and-drop from tree ===
  let drop_zone = $state<`top` | `bottom` | `left` | `right` | `center` | null>(null)
  let drop_target_panel_idx = $state<number>(-1)
  let canvas_element: HTMLElement | undefined = $state()

  let sidebar_element: HTMLElement | undefined = $state()

  // Convert a data path (relative to JSON root) to the tree path used by JsonTree
  function data_to_tree_path(data_path: string): string {
    return filename ? (data_path ? `${filename}.${data_path}` : filename) : data_path
  }

  // Build a Set of tree paths that are renderable (for fast draggable lookup)
  let renderable_tree_paths = $derived(new Map(
    [...renderable_paths].map(([data_path, info]) =>
      [data_to_tree_path(data_path), { data_path, ...info }]
    )
  ))

  // Mark renderable tree nodes as draggable via attribute (no per-node listeners)
  function mark_draggable_nodes(): void {
    if (!sidebar_element) return
    for (const node of sidebar_element.querySelectorAll(`[data-path]`)) {
      const el = node as HTMLElement
      const tree_path = el.getAttribute(`data-path`) ?? ``
      el.draggable = renderable_tree_paths.has(tree_path)
    }
  }

  // Single delegated dragstart handler on sidebar (no per-node listeners needed)
  $effect(() => {
    if (!sidebar_element) return
    function on_dragstart(event: DragEvent): void {
      const target = (event.target as HTMLElement).closest(`[data-path]`) as HTMLElement | null
      if (!target) return
      const tree_path = target.getAttribute(`data-path`) ?? ``
      const info = renderable_tree_paths.get(tree_path)
      if (!info || !event.dataTransfer) { event.preventDefault(); return }
      event.dataTransfer.setData(`text/plain`, JSON.stringify({ data_path: info.data_path, detected_type: info.type }))
      event.dataTransfer.effectAllowed = `copy`
    }
    sidebar_element.addEventListener(`dragstart`, on_dragstart)
    return () => sidebar_element!.removeEventListener(`dragstart`, on_dragstart)
  })

  // === Badge injection ===
  function apply_badges(): void {
    if (!sidebar_element || renderable_paths.size === 0) return
    for (const existing of sidebar_element.querySelectorAll(`.renderable-badge`)) {
      existing.remove()
    }
    for (const [data_path, info] of renderable_paths) {
      const node = sidebar_element.querySelector(`[data-path="${CSS.escape(data_to_tree_path(data_path))}"]`)
      if (!node) continue
      const colon_el = node.querySelector(`.colon`)
      const insert_after = colon_el ?? node.querySelector(`.node-key`) ?? node
      const badge = document.createElement(`span`)
      badge.className = `renderable-badge`
      badge.textContent = info.label
      badge.title = `Drag to canvas or click to render`
      badge.style.cssText = `font-size:9px;padding:1px 4px;margin-left:4px;border-radius:3px;background:${TYPE_COLORS[info.type]};color:white;font-weight:500;white-space:nowrap;cursor:grab;flex-shrink:0;`
      badge.addEventListener(`click`, (event) => {
        event.stopPropagation()
        const val = resolve_path(value, data_path)
        if (val !== undefined) replace_or_add_panel(data_path, info.type, val)
      })
      insert_after.after(badge)
    }
  }

  // Re-apply badges + draggable attributes when tree DOM changes.
  // Guard with a flag so our own badge DOM mutations don't re-trigger the observer,
  // and coalesce rapid mutations into a single rAF.
  let applying_badges = false
  $effect(() => {
    if (!sidebar_element) return
    let pending_raf: number | null = null
    function schedule_refresh(): void {
      if (pending_raf) return
      pending_raf = requestAnimationFrame(() => {
        pending_raf = null
        if (applying_badges) return
        applying_badges = true
        try { apply_badges(); mark_draggable_nodes() }
        finally { applying_badges = false }
      })
    }
    schedule_refresh()
    const observer = new MutationObserver(schedule_refresh)
    observer.observe(sidebar_element, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (pending_raf) cancelAnimationFrame(pending_raf)
    }
  })

  // === Panel management ===

  function make_panel_id(): string {
    return `panel_${crypto.randomUUID()}`
  }

  // Click replaces the single/first panel; drag adds a split
  function replace_or_add_panel(data_path: string, detected_type: RenderableType, val: unknown): void {
    if (panels.length === 0) {
      panels = [{ id: make_panel_id(), data_path, detected_type, val, component: null, element: null }]
      panel_sizes = [1]
    } else {
      unmount_panel(0)
      panels[0] = { id: make_panel_id(), data_path, detected_type, val, component: null, element: null }
      panels = [...panels] // trigger reactivity
    }
    requestAnimationFrame(() => mount_all_panels())
  }

  function add_panel_with_split(
    data_path: string,
    detected_type: RenderableType,
    val: unknown,
    target_idx: number,
    zone: `top` | `bottom` | `left` | `right`,
  ): void {
    const new_panel: PanelInfo = {
      id: make_panel_id(), data_path, detected_type, val, component: null, element: null,
    }
    const direction: SplitDirection = (zone === `top` || zone === `bottom`) ? `vertical` : `horizontal`
    const insert_before = zone === `top` || zone === `left`

    if (panels.length === 0) {
      panels = [new_panel]
      panel_sizes = [1]
    } else {
      const new_panels = [...panels]
      const new_sizes = [...panel_sizes]
      const new_dirs = [...split_directions]
      const insert_idx = insert_before ? target_idx : target_idx + 1
      // Split the target panel's size in half: new panel gets half, target keeps half
      const target_size = new_sizes[target_idx] ?? 1
      new_sizes[target_idx] = target_size / 2
      new_panels.splice(insert_idx, 0, new_panel)
      new_sizes.splice(insert_idx, 0, target_size / 2)
      // Add direction between the two panels
      new_dirs.splice(target_idx, 0, direction)
      panels = new_panels
      panel_sizes = new_sizes
      split_directions = new_dirs
    }
    requestAnimationFrame(() => mount_all_panels())
  }

  function close_panel(idx: number): void {
    unmount_panel(idx)
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

  function unmount_panel(idx: number): void {
    const panel = panels[idx]
    if (panel?.component) {
      try { unmount(panel.component) } catch (err) { console.error(`JsonBrowser: unmount failed:`, err) }
      panel.component = null
    }
    if (panel?.element) panel.element.innerHTML = ``
  }

  // === Component mounting ===

  function prepare_structure(val: unknown): unknown {
    if (is_optimade_raw(val)) {
      const result = parse_optimade_from_raw(val)
      if (result) return result
    }
    const record = val as Record<string, unknown>
    if (Array.isArray(record.sites) && record.lattice) {
      return normalize_fractional_coords(val as Parameters<typeof normalize_fractional_coords>[0])
    }
    return val
  }

  // Convert column-based or row-based data to RowData[] for HeatmapTable
  function prepare_table_data(val: unknown): RowData[] {
    if (Array.isArray(val)) return val as RowData[]
    // Column-based: { col_a: [1,2,3], col_b: [4,5,6] } -> [{ col_a: 1, col_b: 4 }, ...]
    const data = val as Record<string, unknown[]>
    const keys = Object.keys(data).filter((key) => Array.isArray(data[key]))
    if (keys.length === 0) return []
    return Array.from({ length: (data[keys[0]] as unknown[]).length }, (_, idx) =>
      Object.fromEntries(keys.map((key) => [key, (data[key] as unknown[])[idx]])) as RowData
    )
  }

  // Map user defaults to structure component props (mirrors main.ts structure_props)
  function struct_props(merged: DefaultSettings): Record<string, unknown> {
    const { structure } = merged
    return {
      scene_props: { ...structure, gizmo: structure.show_gizmo },
      lattice_props: {
        show_cell_vectors: structure.show_cell_vectors,
        cell_edge_opacity: structure.cell_edge_opacity,
        cell_surface_opacity: structure.cell_surface_opacity,
        cell_edge_color: structure.cell_edge_color,
        cell_surface_color: structure.cell_surface_color,
      },
      color_scheme: merged.color_scheme,
      background_color: merged.background_color,
      background_opacity: merged.background_opacity,
      show_image_atoms: structure.show_image_atoms,
    }
  }

  function mount_into(target: HTMLElement, val: unknown, detected_type: RenderableType): ReturnType<typeof mount> | null {
    target.innerHTML = ``
    // Force layout so Three.js gets real dimensions
    void target.offsetHeight

    const merged = merge(defaults)
    const common_props = { fullscreen_toggle: false, style: `height:100%` }
    const struct_common = { allow_file_drop: false, enable_tips: false, ...struct_props(merged), ...common_props }

    try {
      if (detected_type === `structure`) {
        return mount(Structure, { target, props: { structure: prepare_structure(val) as AnyStructure, ...struct_common } })
      } else if (detected_type === `fermi_surface` || detected_type === `band_grid`) {
        const fermi_props: Record<string, unknown> = { allow_file_drop: false, ...common_props }
        if (is_fermi_surface_data(val as Parameters<typeof is_fermi_surface_data>[0])) fermi_props.fermi_data = val
        else fermi_props.band_data = val
        return mount(FermiSurface, { target, props: fermi_props })
      } else if (detected_type === `convex_hull`) {
        return mount(ConvexHull, { target, props: { entries: val as PhaseData[], ...common_props } })
      } else if (detected_type === `phase_diagram`) {
        return mount(IsobaricBinaryPhaseDiagram, { target, props: { data: val as PhaseDiagramData, ...common_props } })
      } else if (detected_type === `volumetric`) {
        const vol_data = val as { lattice: LatticeType }
        return mount(Structure, { target, props: { structure: { sites: [], lattice: vol_data.lattice } as AnyStructure, volumetric_data: [val as VolumetricData], ...struct_common } })
      } else if (detected_type === `bands_and_dos`) {
        const data = val as Record<string, unknown>
        // Support both { band_structure, dos } wrapper and combined-fields format
        const band_data = (data.band_structure ?? val) as BaseBandStructure
        const dos_data = (data.dos ?? val) as DosInput
        return mount(BandsAndDos, { target, props: { band_structs: band_data, doses: dos_data, ...common_props } })
      } else if (detected_type === `band_structure`) {
        return mount(Bands, { target, props: { band_structs: val as BaseBandStructure, ...common_props, padding: { b: 60 } } })
      } else if (detected_type === `dos`) {
        return mount(Dos, { target, props: { doses: val as DosInput, ...common_props, padding: { b: 60 } } })
      } else if (detected_type === `brillouin_zone`) {
        const bz_data = val as Record<string, unknown>
        const bz_props: Record<string, unknown> = { allow_file_drop: false, ...common_props }
        if (bz_data.structure) bz_props.structure = prepare_structure(bz_data.structure)
        return mount(BrillouinZone, { target, props: bz_props })
      } else if (detected_type === `xrd`) {
        return mount(XrdPlot, { target, props: { patterns: val as XrdPattern, allow_file_drop: false, ...common_props } })
      } else if (detected_type === `table`) {
        const table_data = prepare_table_data(val)
        return mount(HeatmapTable, { target, props: { data: table_data, ...common_props } })
      }
    } catch (err) {
      console.error(`JsonBrowser: mount failed for ${detected_type}:`, err)
    }
    return null
  }

  function mount_all_panels(): void {
    for (let idx = 0; idx < panels.length; idx++) {
      const panel = panels[idx]
      if (panel.component) continue // already mounted
      const el = document.getElementById(panel.id)
      if (!el) continue
      panel.element = el
      panel.component = mount_into(el, panel.val, panel.detected_type)
    }
  }

  // === Drop zone detection ===

  function get_drop_zone(event: DragEvent, rect: DOMRect): `top` | `bottom` | `left` | `right` | `center` {
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
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) {
        drop_zone = get_drop_zone(event, rect)
        drop_target_panel_idx = idx
        break
      }
    }
    // Prevent mixed-axis splits until nested layouts are supported
    if (split_directions.length > 0) {
      const layout = split_directions[0]
      if (layout === `vertical` && (drop_zone === `left` || drop_zone === `right`)) {
        drop_zone = `center`
      } else if (layout === `horizontal` && (drop_zone === `top` || drop_zone === `bottom`)) {
        drop_zone = `center`
      }
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
      const { data_path, detected_type } = JSON.parse(raw) as { data_path: string; detected_type: RenderableType }
      const val = resolve_path(value, data_path)
      if (!val || !detected_type) return
      if (panels.length === 0 || zone === `center` || !zone) {
        replace_or_add_panel(data_path, detected_type, val)
      } else {
        add_panel_with_split(data_path, detected_type, val, target_idx, zone)
      }
    } catch (err) { console.error(`JsonBrowser: drop failed:`, err) }
  }

  // === Panel split divider dragging ===
  let split_dragging_idx = $state(-1)

  function on_split_divider_mousedown(event: MouseEvent, split_idx: number): void {
    event.preventDefault()
    split_dragging_idx = split_idx
    const direction = split_directions[split_idx]
    if (!direction) return
    const panel_container = canvas_element?.querySelector(`.panel-container`) as HTMLElement | null
    if (!panel_container) return
    const container_rect = panel_container.getBoundingClientRect()

    const is_vertical = direction === `vertical`
    const start_pos = is_vertical ? event.clientY : event.clientX
    const container_size = is_vertical ? container_rect.height : container_rect.width
    // Total flex of the two adjacent panels
    const left_idx = split_idx
    const right_idx = split_idx + 1
    const total_flex = (panel_sizes[left_idx] ?? 1) + (panel_sizes[right_idx] ?? 1)
    const start_left_size = panel_sizes[left_idx] ?? total_flex / 2

    start_drag(
      (move_event) => {
        const current_pos = is_vertical ? move_event.clientY : move_event.clientX
        const delta_fraction = (current_pos - start_pos) / container_size
        const delta_flex = delta_fraction * total_flex
        const new_left = Math.max(total_flex * 0.1, Math.min(total_flex * 0.9, start_left_size + delta_flex))
        panel_sizes[left_idx] = new_left
        panel_sizes[right_idx] = total_flex - new_left
      },
      () => { split_dragging_idx = -1 },
    )
  }

  // === Helpers ===

  function strip_root_prefix(path: string): string {
    if (!filename || !path.startsWith(filename)) return path
    const stripped = path.slice(filename.length)
    return stripped.startsWith(`.`) ? stripped.slice(1) : stripped
  }

  function handle_select(path: string, val: unknown): void {
    const data_path = strip_root_prefix(path)
    if (select_timer) clearTimeout(select_timer)
    select_timer = setTimeout(() => {
      const detected = detect_view_type(val)
      if (detected) replace_or_add_panel(data_path, detected, val)
    }, 150)
  }

  function resolve_path(root: unknown, path: string): unknown {
    if (!path) return root
    const segments = path.replace(/\[(\d+)\]/g, `.$1`).split(`.`).filter(Boolean)
    let current: unknown = root
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== `object`) return undefined
      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  // The first split direction determines the flex layout direction
  let layout_direction = $derived(split_directions.length > 0 ? split_directions[0] : `vertical`)

  // Helper to get type color without inline `as` casts that break Deno's Svelte parser
  function type_color(key: string): string {
    return TYPE_COLORS[key as RenderableType] ?? `#888`
  }
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
<div class="json-browser" class:dragging={is_sidebar_dragging || split_dragging_idx >= 0}>
  <aside class="sidebar" bind:this={sidebar_element} style="width: {sidebar_width}px">
    <JsonTree
      {value}
      root_label={filename}
      default_fold_level={1}
      onselect={handle_select}
      show_header
    />
  </aside>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="divider sidebar-divider" onmousedown={on_sidebar_divider_mousedown}></div>

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
            Found {renderable_paths.size} renderable item{renderable_paths.size === 1 ? `` : `s`}.
            Click to render, or drag to an edge to create a split view.
          </p>
          <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;">
            {#each [...renderable_paths] as [data_path, info] (data_path)}
              <button
                type="button"
                class="renderable-chip"
                style="background: {type_color(info.type)}22; border: 1px solid {type_color(info.type)}66;"
                onclick={() => {
                  const val = resolve_path(value, data_path)
                  if (val !== undefined) {
                    replace_or_add_panel(data_path, info.type, val)
                  }
                }}
              >
                <span class="chip-dot" style="background: {type_color(info.type)};"></span>
                {info.label}: <code>{data_path || `root`}</code>
              </button>
            {/each}
          </div>
          {@render type_list(`All recognized types:`, `margin-top: 20px`)}
        {/if}
      </div>
    {:else}
      <!-- Panel layout -->
      <div class="panel-container" class:vertical={layout_direction === `vertical`} class:horizontal={layout_direction === `horizontal`}>
        {#each panels as panel, idx (panel.id)}
          {#if idx > 0 && split_directions[idx - 1]}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="split-divider"
              class:vertical={split_directions[idx - 1] === `vertical`}
              class:horizontal={split_directions[idx - 1] === `horizontal`}
              class:active={split_dragging_idx === idx - 1}
              onmousedown={(event) => on_split_divider_mousedown(event, idx - 1)}
            ></div>
          {/if}
          <div
            class="viz-panel"
            id={panel.id}
            style="flex: {panel_sizes[idx] ?? 1}"
          >
            <!-- Close button -->
            {#if panels.length > 1}
              <button
                type="button"
                class="panel-close"
                title="Close this panel"
                onclick={() => close_panel(idx)}
              >&times;</button>
            {/if}
            <!-- Panel label -->
            <div class="panel-label" style="background: {TYPE_COLORS[panel.detected_type]}cc;">
              {TYPE_LABELS[panel.detected_type]}: {panel.data_path}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Drop zone overlay -->
    {#if drop_zone && drop_zone !== `center`}
      <div class="drop-indicator {drop_zone}"></div>
    {/if}
  </div>
</div>

<style>
  .json-browser {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
  .json-browser.dragging {
    user-select: none;
  }
  .sidebar {
    flex-shrink: 0;
    min-width: 150px;
    max-width: 60%;
    overflow: auto;
    padding: 4px;
  }
  .divider {
    width: 5px;
    flex-shrink: 0;
    background: var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
    cursor: col-resize;
    transition: background 0.15s;
  }
  .divider:hover, .json-browser.dragging .sidebar-divider {
    background: var(--vscode-focusBorder, #007fd4);
  }
  .canvas {
    flex: 1;
    height: 100%;
    position: relative;
    overflow: hidden;
    min-width: 200px;
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
  .panel-close {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    background: rgba(0,0,0,0.5);
    color: white;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .viz-panel:hover .panel-close {
    opacity: 0.8;
  }
  .panel-close:hover {
    opacity: 1;
    background: rgba(200,0,0,0.7);
  }
  .panel-label {
    position: absolute;
    bottom: 4px;
    left: 4px;
    z-index: 10;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    color: white;
    opacity: 0.7;
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
  }
  .split-divider.vertical {
    height: 5px;
    cursor: row-resize;
  }
  .split-divider.horizontal {
    width: 5px;
    cursor: col-resize;
  }
  .split-divider:hover, .split-divider.active {
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
</style>
