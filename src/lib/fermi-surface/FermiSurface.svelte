<script lang="ts">
  import { EmptyState, Icon, Spinner, toggle_fullscreen } from '$lib'
  import type { BrillouinZoneData } from '$lib/brillouin'
  import { compute_brillouin_zone, reciprocal_lattice } from '$lib/brillouin'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { set_fullscreen_bg } from '$lib/layout'
  import type { CameraProjection } from '$lib/settings'
  import { DEFAULTS } from '$lib/settings'
  import type { PymatgenStructure } from '$lib/structure'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three'
  import { detect_irreducible_bz, extract_fermi_surface } from './compute'
  import FermiSurfaceControls from './FermiSurfaceControls.svelte'
  import FermiSurfaceScene from './FermiSurfaceScene.svelte'
  import { parse_fermi_file } from './parse'
  import type {
    BandGridData,
    ColorProperty,
    FermiErrorData,
    FermiFileLoadData,
    FermiSurfaceData,
    RepresentationMode,
  } from './types'

  type FermiHandlerData = {
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    bz_data?: BrillouinZoneData
    filename?: string
    file_size?: number
    error_msg?: string
    fullscreen?: boolean
  }

  let {
    fermi_data = $bindable(),
    band_data = $bindable(),
    structure,
    bz_data = $bindable(),
    mu = $bindable(0),
    controls_open = $bindable(false),
    color_property = $bindable(`band`),
    color_scale = $bindable(`interpolateViridis`),
    representation = $bindable(`solid`),
    surface_opacity = $bindable(0.8),
    selected_bands = $bindable(),
    show_bz = $bindable(true),
    bz_opacity = $bindable(0.1),
    show_vectors = $bindable(true),
    tile_bz = $bindable(false),
    // Clipping plane
    clip_enabled = $bindable(false),
    clip_axis = $bindable<`x` | `y` | `z`>(`z`),
    clip_position = $bindable(0),
    clip_flip = $bindable(false),
    // Interpolation
    interpolation_factor = $bindable(1),
    camera_projection = $bindable(`perspective`),
    show_controls = 0,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    fullscreen_toggle = DEFAULTS.structure.fullscreen_toggle,
    data_url,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    children,
    on_file_drop,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_mu_change,
    ...rest
  }: {
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    structure?: PymatgenStructure
    bz_data?: BrillouinZoneData
    mu?: number
    controls_open?: boolean
    color_property?: ColorProperty
    color_scale?: string
    representation?: RepresentationMode
    surface_opacity?: number
    selected_bands?: number[]
    show_bz?: boolean
    bz_opacity?: number
    show_vectors?: boolean
    tile_bz?: boolean
    clip_enabled?: boolean
    clip_axis?: `x` | `y` | `z`
    clip_position?: number
    clip_flip?: boolean
    interpolation_factor?: number
    camera_projection?: CameraProjection
    show_controls?: boolean | number
    fullscreen?: boolean
    width?: number
    height?: number
    wrapper?: HTMLDivElement
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    fullscreen_toggle?: Snippet<[{ fullscreen: boolean }]> | boolean
    data_url?: string
    spinner_props?: ComponentProps<typeof Spinner>
    loading?: boolean
    error_msg?: string
    children?: Snippet<
      [{ fermi_data?: FermiSurfaceData; bz_data?: BrillouinZoneData }]
    >
    on_file_drop?: (filename: string) => void
    on_file_load?: (data: FermiFileLoadData) => void
    on_error?: (data: FermiErrorData) => void
    on_fullscreen_change?: (data: FermiHandlerData) => void
    on_mu_change?: (mu: number) => void
  } & HTMLAttributes<HTMLDivElement> = $props()

  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let current_filename = $state<string | undefined>(undefined)
  let recompute_job_id = 0 // monotonic counter to track latest recompute call

  let visible_buttons = $derived(
    show_controls === true ||
      (typeof show_controls === `number` && width > show_controls),
  )

  // Yield to browser so spinner can render before heavy computation
  const tick = () =>
    new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r()))
    )

  // Parse and load Fermi surface from content (async for UI responsiveness)
  async function parse_fermi_content(
    content: string | ArrayBuffer,
    filename: string,
  ) {
    const text = content instanceof ArrayBuffer
      ? new TextDecoder().decode(content)
      : content

    const parsed = parse_fermi_file(text, filename)
    if (!parsed) throw new Error(`Failed to parse Fermi surface from ${filename}`)

    const file_size = new Blob([content]).size
    current_filename = filename

    // Check if it's already FermiSurfaceData or BandGridData
    if (`isosurfaces` in parsed) {
      fermi_data = parsed as FermiSurfaceData
      band_data = undefined
    } else {
      band_data = parsed as BandGridData
      fermi_data = extract_fermi_surface(band_data, { mu, wigner_seitz: true })
    }

    on_file_load?.({ fermi_data, band_data, filename, file_size })
  }

  // Load with error handling
  async function safe_parse(content: string | ArrayBuffer, filename: string) {
    try {
      await parse_fermi_content(content, filename)
    } catch (err) {
      error_msg = `Failed to parse ${filename}: ${
        err instanceof Error ? err.message : err
      }`
      on_error?.({ error_msg, filename })
    }
  }

  // Re-extract Fermi surface from band data with current settings
  async function recompute_fermi_surface() {
    if (!band_data) return
    const job_id = ++recompute_job_id // capture this job's ID
    loading = true
    await tick() // let spinner render before heavy computation
    // Check if this job is still the latest before proceeding
    if (job_id !== recompute_job_id) return
    try {
      const result = extract_fermi_surface(band_data, {
        mu,
        wigner_seitz: true,
        interpolation_factor,
      })
      // Only update state if this is still the latest job
      if (job_id === recompute_job_id) {
        fermi_data = result
      }
    } catch (err) {
      console.error(`Failed to re-extract Fermi surface:`, err)
    } finally {
      // Only clear loading if this is still the latest job
      if (job_id === recompute_job_id) loading = false
    }
  }

  // Debounce recompute to avoid excessive re-computation during rapid slider drags
  let recompute_timeout: ReturnType<typeof setTimeout>

  function handle_mu_change(new_mu: number) {
    mu = new_mu
    clearTimeout(recompute_timeout)
    recompute_timeout = setTimeout(() => void recompute_fermi_surface(), 150)
    on_mu_change?.(new_mu)
  }

  function handle_interpolation_change(new_factor: number) {
    interpolation_factor = new_factor
    clearTimeout(recompute_timeout)
    recompute_timeout = setTimeout(() => void recompute_fermi_surface(), 150)
  }

  // Export Fermi surface to various formats
  async function handle_export(format: `stl` | `obj` | `gltf`) {
    if (!scene) {
      console.error(`No scene available for export`)
      return
    }
    try {
      const { export_scene } = await import(`./export`)
      await export_scene(scene, format, current_filename || `fermi-surface`)
    } catch (err) {
      console.error(`Export failed:`, err)
      error_msg = `Export failed: ${err instanceof Error ? err.message : err}`
    }
  }

  // Compute BZ when structure or fermi_data changes
  $effect(() => {
    // Get k_lattice from available sources (priority order)
    const k_lattice = fermi_data?.k_lattice ??
      band_data?.k_lattice ??
      (structure?.lattice?.matrix
        ? reciprocal_lattice(structure.lattice.matrix)
        : null)

    if (!k_lattice) {
      bz_data = undefined
      return
    }

    try {
      bz_data = compute_brillouin_zone(k_lattice, 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`BZ computation failed:`, msg)
      bz_data = undefined
      // Only report error for structure-derived lattice (user-provided data)
      if (structure?.lattice?.matrix) {
        const err_msg = `BZ computation failed: ${msg}`
        error_msg = err_msg
        untrack(() => on_error?.({ error_msg: err_msg }))
      }
    }
  })

  // Auto-enable BZ tiling when irreducible data is detected
  $effect(() => {
    if (fermi_data && detect_irreducible_bz(fermi_data)) {
      tile_bz = true
    }
  })

  // Load from URL
  $effect(() => {
    if (data_url && !fermi_data && !band_data) {
      loading = true
      error_msg = undefined
      load_from_url(data_url, safe_parse)
        .catch((err) => {
          error_msg = err instanceof Error ? err.message : String(err)
          on_error?.({ error_msg, filename: data_url })
        })
        .finally(() => (loading = false))
    }
  })

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    loading = true
    error_msg = undefined

    try {
      // Check for URL drop first
      const url = event.dataTransfer?.getData(`text/uri-list`)
      const url_filename = url?.split(`/`).pop()?.split(`?`)[0]
      if (url_filename) on_file_drop?.(url_filename)
      const handled = await handle_url_drop(event, safe_parse).catch(() => false)
      if (handled) return

      const file = event.dataTransfer?.files[0]
      if (file) {
        if (!url_filename) on_file_drop?.(file.name) // notify if not already
        const { content, filename } = await decompress_file(file)
        if (content) await safe_parse(content, filename)
      }
    } catch (err) {
      error_msg = `File drop failed: ${err}`
      on_error?.({ error_msg })
    } finally {
      loading = false
    }
  }

  function handle_keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if ([`INPUT`, `TEXTAREA`].includes(target.tagName)) return
    // Only handle shortcuts when component is focused/hovered or contains focus
    if (!wrapper?.contains(document.activeElement) && !hovered) return

    if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    else if (event.key === `Escape`) controls_open = false
  }

  $effect(() => {
    if (typeof window === `undefined`) return
    const fs_el = document.fullscreenElement
    if (fullscreen && fs_el !== wrapper && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else if (!fullscreen && fs_el === wrapper) document.exitFullscreen()
    set_fullscreen_bg(wrapper, fullscreen, `--fermi-bg-fullscreen`)
  })
</script>

<svelte:window onkeydown={handle_keydown} />

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
    on_fullscreen_change?.({ fermi_data, bz_data, fullscreen })
  }}
/>

<div
  class:dragover
  class:active={controls_open}
  role="region"
  aria-label="Fermi surface viewer"
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
  {...rest}
  class="fermi-surface {rest.class ?? ``}"
>
  {@render children?.({ fermi_data, bz_data })}
  {#if loading}
    <Spinner
      text="Loading Fermi surface..."
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
      {...spinner_props}
    />
  {:else if error_msg}
    <div class="error-state">
      <p class="error">{error_msg}</p>
      <button onclick={() => (error_msg = undefined)}>Dismiss</button>
    </div>
  {:else if fermi_data || band_data}
    <section class:visible={visible_buttons} class="control-buttons">
      {#if visible_buttons}
        {#if current_filename}
          <span class="filename">{current_filename}</span>
        {/if}

        {#if fullscreen_toggle}
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

        <FermiSurfaceControls
          bind:controls_open
          {fermi_data}
          {band_data}
          bind:mu
          bind:color_property
          bind:color_scale
          bind:representation
          bind:surface_opacity
          bind:selected_bands
          bind:show_bz
          bind:bz_opacity
          bind:show_vectors
          bind:tile_bz
          bind:clip_enabled
          bind:clip_axis
          bind:clip_position
          bind:clip_flip
          bind:interpolation_factor
          bind:camera_projection
          on_mu_change={handle_mu_change}
          on_interpolation_change={handle_interpolation_change}
          on_export={handle_export}
        />
      {/if}
    </section>

    {#if typeof WebGLRenderingContext !== `undefined`}
      <Canvas renderMode="on-demand" dpr={Math.min(2, window.devicePixelRatio)}>
        <FermiSurfaceScene
          {fermi_data}
          {bz_data}
          {color_property}
          {color_scale}
          {representation}
          {surface_opacity}
          {selected_bands}
          {show_bz}
          {bz_opacity}
          {show_vectors}
          {tile_bz}
          {clip_enabled}
          {clip_axis}
          {clip_position}
          {clip_flip}
          {camera_projection}
          bind:scene
          bind:camera
        />
      </Canvas>
    {/if}
  {:else}
    <EmptyState>
      <h3>Drop Fermi Surface File</h3>
      <p>Supports BXSF, FRMSF, JSON (+ .gz)</p>
    </EmptyState>
  {/if}
</div>

<style>
  .fermi-surface {
    position: relative;
    container-type: size;
    height: var(--fermi-height, 500px);
    width: var(--fermi-width, 100%);
    max-width: var(--fermi-max-width, 100%);
    min-width: var(--fermi-min-width, 300px);
    border-radius: var(--fermi-border-radius, var(--border-radius, 3pt));
    background: var(--fermi-bg, var(--surface-bg));
    color: var(--fermi-text-color, var(--text-color));
  }
  /* Clip threlte HTML overlays (b₁/b₂/b₃ labels) when they fall outside canvas bounds.
  Targets threlte-generated container (parent of canvas), not main wrapper
  so control pane can still be dragged outside component bounds. */
  .fermi-surface :global(> div:has(> canvas)) {
    overflow: hidden;
  }
  .fermi-surface.active {
    z-index: var(--fermi-active-z-index, 2);
  }
  .fermi-surface:fullscreen {
    background: var(--fermi-bg-fullscreen, var(--surface-bg));
    overflow: hidden;
  }
  .fermi-surface:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .fermi-surface.dragover {
    background: var(--fermi-dragover-bg, var(--dragover-bg));
    border: var(--fermi-dragover-border, var(--dragover-border));
  }
  .fermi-surface :global(canvas) {
    user-select: none;
  }
  section.control-buttons {
    position: absolute;
    display: flex;
    top: var(--fermi-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--fermi-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: clamp(6pt, 1cqmin, 9pt);
    z-index: var(--fermi-buttons-z-index, 100000000);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    align-items: center;
  }
  section.control-buttons.visible {
    opacity: 1;
    pointer-events: auto;
  }
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
