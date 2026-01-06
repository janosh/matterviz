<script lang="ts">
  import { toggle_fullscreen } from '$lib/layout'
  import { normalize_show_controls } from '$lib/controls'
  import type { ShowControlsProp } from '$lib/controls'
  import EmptyState from '$lib/EmptyState.svelte'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import Icon from '$lib/Icon.svelte'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { set_fullscreen_bg } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { type CameraProjection, DEFAULTS } from '$lib/settings'
  import type { Crystal } from '$lib/structure'
  import { parse_any_structure } from '$lib/structure/parse'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import BrillouinZoneControls from './BrillouinZoneControls.svelte'
  import BrillouinZoneExportPane from './BrillouinZoneExportPane.svelte'
  import BrillouinZoneInfoPane from './BrillouinZoneInfoPane.svelte'
  import BrillouinZoneScene from './BrillouinZoneScene.svelte'
  import { compute_brillouin_zone, reciprocal_lattice } from './compute'
  import type { BrillouinZoneData } from './types'

  type BZHandlerData = {
    structure?: Crystal
    bz_data?: BrillouinZoneData
    bz_order?: number
    filename?: string
    file_size?: number
    error_msg?: string
    fullscreen?: boolean
  }
  let {
    structure = $bindable(),
    bz_order = $bindable(1),
    bz_data = $bindable(),
    controls_open = $bindable(false),
    info_pane_open = $bindable(false),
    surface_color = $bindable(`#4488ff`),
    surface_opacity = $bindable(0.3),
    edge_color = $bindable(`#000000`),
    edge_width = $bindable(0.05),
    show_vectors = $bindable(true),
    vector_scale = $bindable(1.0),
    camera_projection = $bindable(`perspective`),
    show_controls,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    png_dpi = $bindable(150),
    fullscreen_toggle = DEFAULTS.structure.fullscreen_toggle,
    data_url,
    structure_string,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    k_path_points = [],
    k_path_labels = [],
    hovered_k_point = null,
    hovered_qpoint_index = null,
    children,
    on_file_load,
    on_error,
    on_fullscreen_change,
    ...rest
  }:
    & {
      structure?: Crystal
      bz_order?: number
      bz_data?: BrillouinZoneData
      controls_open?: boolean
      info_pane_open?: boolean
      surface_color?: string
      surface_opacity?: number
      edge_color?: string
      edge_width?: number
      show_vectors?: boolean
      vector_scale?: number
      camera_projection?: CameraProjection
      /**
       * Controls visibility configuration.
       * - 'always': controls always visible
       * - 'hover': controls visible on component hover (default)
       * - 'never': controls never visible
       * - object: { mode, hidden, style } for fine-grained control
       *
       * Control names: 'filename', 'fullscreen', 'info-pane', 'export-pane', 'controls'
       */
      show_controls?: ShowControlsProp
      fullscreen?: boolean
      width?: number
      height?: number
      wrapper?: HTMLDivElement
      png_dpi?: number
      hovered?: boolean
      dragover?: boolean
      allow_file_drop?: boolean
      fullscreen_toggle?: Snippet<[{ fullscreen: boolean }]> | boolean
      data_url?: string
      on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
      spinner_props?: ComponentProps<typeof Spinner>
      loading?: boolean
      error_msg?: string
      structure_string?: string
      // K-path points in Cartesian reciprocal space coordinates (not fractional coords)
      // Should be computed using the reciprocal lattice matrix (includes 2π factor)
      k_path_points?: Vec3[]
      // K-path labels with positions in Cartesian reciprocal space coordinates
      // Each position should match a corresponding point in k_path_points
      k_path_labels?: { position: Vec3; label: string | null }[]
      // Currently hovered k-point in Cartesian reciprocal space coordinates
      hovered_k_point?: Vec3 | null
      // Index of the currently hovered q-point in the band structure
      hovered_qpoint_index?: number | null
      children?: Snippet<
        [{ structure?: Crystal; bz_data?: BrillouinZoneData }]
      >
      on_file_load?: (data: BZHandlerData) => void
      on_error?: (data: BZHandlerData) => void
      on_fullscreen_change?: (data: BZHandlerData) => void
    }
    & HTMLAttributes<HTMLDivElement> = $props()

  let scene = $state(undefined)
  let camera = $state(undefined)
  let export_pane_open = $state(false)
  let current_filename = $state<string | undefined>(undefined)

  // Normalize show_controls prop into consistent config
  let controls_config = $derived(normalize_show_controls(show_controls))

  // Parse and load structure from content
  function parse_structure(content: string | ArrayBuffer, filename: string) {
    const text = content instanceof ArrayBuffer
      ? new TextDecoder().decode(content)
      : content
    const parsed = parse_any_structure(text, filename)
    if (!parsed) throw new Error(`Failed to parse structure from ${filename}`)

    structure = parsed as Crystal
    current_filename = filename
    const file_size = new Blob([content]).size
    on_file_load?.({ structure, bz_data, bz_order, filename, file_size })
  }

  // Load with error handling
  function safe_parse(content: string | ArrayBuffer, filename: string) {
    try {
      parse_structure(content, filename)
    } catch (err) {
      error_msg = `Failed to parse ${filename}: ${
        err instanceof Error ? err.message : err
      }`
      on_error?.({ error_msg, filename })
    }
  }

  // Compute BZ when structure/order changes
  $effect(() => {
    if (!structure || !(`lattice` in structure) || !structure.lattice) {
      bz_data = undefined
      return
    }

    try {
      const k_lattice = reciprocal_lattice(structure.lattice.matrix)
      // Ensure bz_order is 1, 2, or 3
      const valid_order = Math.min(Math.max(1, bz_order), 3) as 1 | 2 | 3
      bz_data = compute_brillouin_zone(k_lattice, valid_order)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error_msg = `BZ computation failed: ${msg}`
      bz_data = undefined
      untrack(() => on_error?.({ error_msg, structure, bz_order }))
    }
  })

  // Load structure from URL or string
  $effect(() => {
    const handle_error = (err: unknown, source: string) => {
      error_msg = err instanceof Error ? err.message : String(err)
      on_error?.({ error_msg, filename: source })
    }

    if (data_url && !structure) {
      loading = true
      error_msg = undefined
      load_from_url(
        data_url,
        (content, filename) =>
          on_file_drop
            ? on_file_drop(content, filename)
            : safe_parse(content, filename),
      )
        .catch((err) => handle_error(err, data_url))
        .finally(() => (loading = false))
    } else if (structure_string && !data_url) {
      loading = true
      error_msg = undefined
      try {
        safe_parse(structure_string, `string`)
      } catch (err) {
        handle_error(err, `string`)
      } finally {
        loading = false
      }
    }
  })

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    loading = true
    error_msg = undefined

    try {
      const handler = on_file_drop || safe_parse
      const handled = await handle_url_drop(event, handler).catch(() => false)
      if (handled) return

      const file = event.dataTransfer?.files[0]
      if (file) {
        const { content, filename } = await decompress_file(file)
        if (content) handler(content, filename)
      }
    } catch (err) {
      error_msg = `File drop failed: ${err}`
      on_error?.({ error_msg })
    } finally {
      loading = false
    }
  }

  function onkeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.tagName === `INPUT` || target.tagName === `TEXTAREA`) return

    if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    else if (event.key === `i`) info_pane_open = !info_pane_open
    else if (event.key === `Escape`) {
      if (info_pane_open) info_pane_open = false
      else controls_open = false
    }
  }

  $effect(() => { // fullscreen and background
    if (typeof window === `undefined`) return
    const fs_el = document.fullscreenElement
    if (fullscreen && fs_el !== wrapper && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else if (!fullscreen && fs_el === wrapper) document.exitFullscreen()
    set_fullscreen_bg(wrapper, fullscreen, `--bz-bg-fullscreen`)
  })
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
    on_fullscreen_change?.({ structure, bz_data, bz_order, fullscreen })
  }}
/>

<div
  class:dragover
  class:active={info_pane_open || controls_open || export_pane_open}
  role="region"
  aria-label="Brillouin zone viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    if (!allow_file_drop) return
    dragover = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    dragover = false
  }}
  {onkeydown}
  {...rest}
  class="brillouin-zone {rest.class ?? ``}"
>
  {@render children?.({ structure, bz_data })}
  {#if loading}
    <Spinner text="Loading structure..." {...spinner_props} />
  {:else if error_msg}
    <div class="error-state">
      <p class="error">{error_msg}</p>
      <button onclick={() => (error_msg = undefined)}>Dismiss</button>
    </div>
  {:else if structure && `lattice` in structure}
    <section
      class="control-buttons {controls_config.class}"
      style={controls_config.style}
    >
      {#if controls_config.mode !== `never`}
        {#if current_filename && controls_config.visible(`filename`)}
          <span class="filename">{current_filename}</span>
        {/if}

        {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
          <button
            type="button"
            onclick={() => fullscreen_toggle && toggle_fullscreen(wrapper)}
            title="{fullscreen ? `Exit` : `Enter`} fullscreen"
            aria-pressed={fullscreen}
            class="fullscreen-toggle"
            {@attach tooltip()}
          >
            {#if typeof fullscreen_toggle === `function`}
              {@render fullscreen_toggle({ fullscreen })}
            {:else}
              <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
            {/if}
          </button>
        {/if}

        {#if controls_config.visible(`info-pane`)}
          <BrillouinZoneInfoPane {structure} {bz_data} bind:pane_open={info_pane_open} />
        {/if}

        {#if controls_config.visible(`export-pane`)}
          <BrillouinZoneExportPane
            bind:export_pane_open
            {bz_data}
            {wrapper}
            {scene}
            {camera}
            bind:png_dpi
            filename={current_filename || `brillouin-zone`}
          />
        {/if}

        {#if controls_config.visible(`controls`)}
          <BrillouinZoneControls
            bind:controls_open
            bind:bz_order
            bind:surface_color
            bind:surface_opacity
            bind:edge_color
            bind:edge_width
            bind:show_vectors
            bind:camera_projection
          />
        {/if}
      {/if}
    </section>

    {#if typeof WebGLRenderingContext !== `undefined`}
      <div style="overflow: hidden; height: 100%">
        <Canvas>
          <BrillouinZoneScene
            {bz_data}
            {surface_color}
            {surface_opacity}
            {edge_color}
            {edge_width}
            {show_vectors}
            {vector_scale}
            {camera_projection}
            {k_path_points}
            {k_path_labels}
            {hovered_k_point}
            {hovered_qpoint_index}
            bind:scene
            bind:camera
          />
        </Canvas>
      </div>
    {/if}
  {:else if structure}
    <p class="warn">Structure must have a lattice to compute Brillouin zone</p>
  {:else}
    <EmptyState>
      <h3>Drop Structure File</h3>
      <p>Supports CIF, POSCAR, JSON, (ext)XYZ, (+ .gz)</p>
    </EmptyState>
  {/if}
</div>

<style>
  .brillouin-zone {
    position: relative;
    container-type: size;
    height: var(--bz-height, 500px);
    width: var(--bz-width, 100%);
    max-width: var(--bz-max-width, 100%);
    min-width: var(--bz-min-width, 300px);
    border-radius: var(--bz-border-radius, var(--border-radius, 3pt));
    background: var(--bz-bg, var(--surface-bg));
    color: var(--bz-text-color, var(--text-color));
  }
  .brillouin-zone.active {
    z-index: var(--bz-active-z-index, 2);
  }
  .brillouin-zone:fullscreen {
    background: var(--bz-bg-fullscreen, var(--surface-bg));
    overflow: hidden;
  }
  .brillouin-zone:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .brillouin-zone.dragover {
    background: var(--bz-dragover-bg, var(--dragover-bg));
    border: var(--bz-dragover-border, var(--dragover-border));
  }
  .brillouin-zone :global(canvas) {
    user-select: none;
  }
  section.control-buttons {
    position: absolute;
    display: flex;
    top: var(--bz-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--bz-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: clamp(6pt, 1cqmin, 9pt);
    z-index: var(--bz-buttons-z-index, 100000000);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    align-items: center;
  }
  /* Mode: always - controls always visible */
  section.control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: hover - controls visible on component hover */
  .brillouin-zone:hover section.control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: never - stays hidden (default state, no additional CSS needed) */
  section.control-buttons > :global(button) {
    background-color: transparent;
    display: flex;
    padding: 4px;
    border-radius: var(--border-radius, 3pt);
    font-size: clamp(0.85em, 2cqmin, 2.5em);
  }
  section.control-buttons :global(button:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .filename {
    font-family: monospace;
    font-size: 0.9em;
    background: var(--code-bg, rgba(0, 0, 0, 0.1));
    padding: 3pt 6pt;
    border-radius: 3pt;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  p.warn {
    text-align: center;
    padding: 2rem;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
    box-sizing: border-box;
  }
  .error-state p {
    color: var(--error-color, #ff6b6b);
    margin: 0 0 1rem;
  }
  .error-state button {
    padding: 0.5rem 1rem;
    background: var(--error-color, #ff6b6b);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .error-state button:hover {
    background: var(--error-color-hover, #ff5252);
  }
</style>
