<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { DragOverlay, StatusMessage } from '$lib/feedback'
  import { load_from_url } from '$lib/io'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import { sample_hkl_slice } from '$lib/isosurface/slice'
  import { format_num } from '$lib/labels'
  import { calc_lattice_params } from '$lib/math'
  import type { Vec3 } from '$lib/math'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import { ColorBar } from '$lib/plot'
  import { parse_any_structure } from '$lib/structure/parse'
  import { volumetric_files } from '$site/isosurfaces'
  import type { AnyStructure, IsosurfaceSettings, VolumetricData } from 'matterviz'
  import {
    auto_isosurface_settings,
    DEFAULT_ISOSURFACE_SETTINGS,
    Structure,
  } from 'matterviz'
  import { onDestroy, onMount } from 'svelte'

  let structure = $state<AnyStructure | undefined>()
  let volumetric_data = $state<VolumetricData[] | undefined>()
  let isosurface_settings = $state<IsosurfaceSettings>({
    ...DEFAULT_ISOSURFACE_SETTINGS,
  })
  let active_volume_idx = $state(0)
  let active_file = $state<string | undefined>()
  let loading = $state(false)
  let error_msg = $state<string | undefined>()
  let parse_time_ms = $state<number | undefined>()
  let dragover_hint = $state(false)
  let parse_source = $state<`volumetric` | `structure` | undefined>()
  let parsed_file_type = $state<string | undefined>()

  // Reference-comparison mode state
  let show_comparison_mode = $state(false)
  let uploaded_reference_image_url = $state<string | undefined>()
  let reference_image_url = $state(``)
  let reference_overlay_opacity = $state(0.45)
  let reference_overlay_enabled = $state(true)
  // Shared scene props keep both viewers camera-synced in comparison mode.
  let synced_scene_props = $state<{ camera_position: Vec3 }>({
    camera_position: [0, 0, 0],
  })

  // Provenance/debug panel state
  let show_debug_panel = $state(false)

  // HKL slice view state
  let miller_indices = $state<Vec3>([0, 0, 1]) // default (001) = z-plane
  let slice_position = $state(0.5) // fractional distance along plane normal [0, 1]
  let slice_canvas = $state<HTMLCanvasElement | undefined>()
  let slice_range = $state<[number, number]>([0, 1])
  let slice_canvas_height = $state(200)

  // Use precomputed data_range from the active volume
  let data_range = $derived(volumetric_data?.[active_volume_idx]?.data_range)
  let active_volume = $derived(volumetric_data?.[active_volume_idx])
  let active_lattice_params = $derived.by(() =>
    active_volume?.lattice ? calc_lattice_params(active_volume.lattice) : undefined
  )
  let reference_image_src = $derived.by(() => {
    if (uploaded_reference_image_url) return uploaded_reference_image_url
    const trimmed_url = reference_image_url.trim()
    return trimmed_url || undefined
  })

  function infer_file_type(filename: string): string {
    const normalized = filename.toLowerCase().replace(/\.(gz|bz2|xz|zst)$/, ``)
    if (normalized.endsWith(`.cube`)) return `.cube`
    if (normalized.includes(`chgcar`)) return `CHGCAR`
    if (normalized.includes(`elfcar`)) return `ELFCAR`
    if (normalized.includes(`locpot`)) return `LOCPOT`
    if (normalized.includes(`aeccar`)) return `AECCAR`
    return `unknown`
  }

  function decode_content(content: string | ArrayBuffer): string {
    return content instanceof ArrayBuffer
      ? new TextDecoder().decode(content)
      : content
  }

  function reset_loaded_content() {
    structure = undefined
    volumetric_data = undefined
    active_volume_idx = 0
  }

  function reset_parse_metadata() {
    parse_time_ms = undefined
    parse_source = undefined
    parsed_file_type = undefined
  }

  function parse_and_apply(text: string, filename: string) {
    const detected_file_type = infer_file_type(filename)
    const vol_result = parse_volumetric_file(text, filename)
    if (vol_result) {
      structure = vol_result.structure as AnyStructure
      volumetric_data = vol_result.volumes
      active_volume_idx = 0
      parse_source = `volumetric`
      parsed_file_type = detected_file_type
      const vol = vol_result.volumes[0]
      if (vol) isosurface_settings = auto_isosurface_settings(vol.data_range)
      return
    }

    const parsed = parse_any_structure(text, filename)
    if (parsed) {
      structure = parsed
      volumetric_data = undefined
      parse_source = `structure`
      parsed_file_type = detected_file_type
      return
    }

    error_msg = `Failed to parse ${filename}`
  }

  function update_url() {
    if (!browser || !active_file) return
    const params = new URLSearchParams()
    params.set(`file`, active_file)
    if (isosurface_settings.isovalue !== DEFAULT_ISOSURFACE_SETTINGS.isovalue) {
      params.set(`isovalue`, isosurface_settings.isovalue.toPrecision(4))
    }
    if (
      isosurface_settings.show_negative !== DEFAULT_ISOSURFACE_SETTINGS.show_negative
    ) {
      params.set(`show_negative`, String(isosurface_settings.show_negative))
    }
    // Use window.location instead of page.url to avoid creating a reactive
    // dependency that would cause an infinite loop with the $effect
    goto(`${window.location.pathname}?${params.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }

  async function load_file(name: string, url: string) {
    active_file = name
    loading = true
    error_msg = undefined
    reset_parse_metadata()
    reset_loaded_content()

    try {
      const parse_start = performance.now()
      await load_from_url(url, (content, filename) => {
        parse_and_apply(decode_content(content), filename)
      })
      parse_time_ms = Math.round(performance.now() - parse_start)
    } catch (err) {
      error_msg = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  // Sync URL when isosurface settings change.
  // Skip during initial mount (active_file is set by onMount's load_file).
  let mounted = false
  $effect(() => {
    // Read reactive values to establish tracking (void suppresses eslint no-unused-expressions)
    void isosurface_settings.isovalue
    void isosurface_settings.show_negative
    void active_file
    if (mounted) update_url()
  })
  onMount(() => {
    mounted = true
  })

  // === Slice rendering ===
  // Render a 2D heatmap slice through the volumetric data using ImageData for performance
  function render_slice() {
    const vol = volumetric_data?.[active_volume_idx]
    if (!vol || !slice_canvas) return

    // Sample the slice along the HKL plane
    const result = sample_hkl_slice(vol, miller_indices, slice_position)
    if (!result) return
    const { data: slice_data, width, height, min: s_min, max: s_max } = result

    // Render to canvas using ImageData for efficient pixel-level writes
    const scale = Math.min(300 / width, 300 / height, 10)
    const canvas_width = Math.round(width * scale)
    const canvas_height = Math.round(height * scale)
    slice_canvas.width = canvas_width
    slice_canvas.height = canvas_height
    slice_canvas_height = canvas_height

    const ctx = slice_canvas.getContext(`2d`)
    if (!ctx) return

    slice_range = [s_min, s_max]

    const img_data = ctx.createImageData(canvas_width, canvas_height)
    const pixels = img_data.data
    const val_range = s_max - s_min || 1

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const val = slice_data[row * width + col]
        // Normalize to [0,1] then reverse for RdBu (1=blue/low, 0=red/high)
        const normalized = 1 - (val - s_min) / val_range

        // Inline RdBu-like diverging colormap: blue (0) → white (0.5) → red (1)
        // Matches d3's interpolateRdBu so canvas and ColorBar stay in sync
        let r_col: number, g_col: number, b_col: number
        if (normalized < 0.5) {
          const frac = normalized * 2
          r_col = Math.round(103 + (247 - 103) * frac)
          g_col = Math.round(169 + (247 - 169) * frac)
          b_col = Math.round(207 + (247 - 207) * frac)
        } else {
          const frac = (normalized - 0.5) * 2
          r_col = Math.round(247 - (247 - 202) * frac)
          g_col = Math.round(247 - (247 - 0) * frac)
          b_col = Math.round(247 - (247 - 32) * frac)
        }

        // Fill the scaled pixel block (flip y so origin is at bottom-left)
        const flipped_row = height - 1 - row
        const px_y_start = Math.round(flipped_row * scale)
        const px_y_end = Math.round((flipped_row + 1) * scale)
        const px_x_start = Math.round(col * scale)
        const px_x_end = Math.round((col + 1) * scale)
        for (let py = px_y_start; py < px_y_end; py++) {
          for (let px = px_x_start; px < px_x_end; px++) {
            const offset = (py * canvas_width + px) * 4
            pixels[offset] = r_col
            pixels[offset + 1] = g_col
            pixels[offset + 2] = b_col
            pixels[offset + 3] = 255
          }
        }
      }
    }

    ctx.putImageData(img_data, 0, 0)
  }

  // Re-render slice when relevant state changes (Svelte 5 auto-tracks dependencies)
  $effect(() => {
    if (volumetric_data && slice_canvas) render_slice()
  })

  // Load file from URL param or default on mount
  onMount(() => {
    const file_param = page.url.searchParams.get(`file`)
    const target = file_param
      ? volumetric_files.find((file) => file.name === file_param)
      : volumetric_files[0]

    if (target) {
      // Apply URL params for isovalue/show_negative after loading
      const isovalue_param = page.url.searchParams.get(`isovalue`)
      const show_neg_param = page.url.searchParams.get(`show_negative`)

      load_file(target.name, target.url).then(() => {
        if (isovalue_param) {
          const parsed = parseFloat(isovalue_param)
          if (!isNaN(parsed)) {
            isosurface_settings.isovalue = parsed
          }
        }
        if (show_neg_param) {
          isosurface_settings.show_negative = show_neg_param === `true`
        }
      })
    }
  })

  function handle_reference_image_upload(event: Event) {
    const input_elem = event.target as HTMLInputElement
    const file = input_elem.files?.[0]
    if (!file) return
    if (uploaded_reference_image_url) {
      URL.revokeObjectURL(uploaded_reference_image_url)
    }
    uploaded_reference_image_url = URL.createObjectURL(file)
    reference_image_url = ``
  }

  function handle_dropped_file(content: string | ArrayBuffer, filename: string) {
    active_file = filename
    error_msg = undefined
    reset_parse_metadata()
    reset_loaded_content()
    const parse_start = performance.now()
    const text = decode_content(content)
    parse_and_apply(text, filename)
    parse_time_ms = Math.round(performance.now() - parse_start)
  }

  function handle_camera_move(data: { camera_position?: Vec3 }) {
    const camera_position = data.camera_position
    if (
      !camera_position || camera_position.some((val) => !isFinite(val))
    ) return
    synced_scene_props.camera_position = [...camera_position] as Vec3
  }

  onDestroy(() => {
    if (uploaded_reference_image_url) {
      URL.revokeObjectURL(uploaded_reference_image_url)
    }
  })
</script>

<svelte:head>
  <title>Isosurface Visualization | Matterviz</title>
</svelte:head>

<h1>Isosurface Visualization</h1>

<p>
  Render isosurfaces from volumetric data overlaid on atomic structures. Supports VASP
  <code>CHGCAR</code>/<code>AECCAR</code>/<code>ELFCAR</code>/<code>LOCPOT</code>
  and Gaussian <code>.cube</code> file formats. Drag and drop your own files onto the
  viewer.
</p>

<nav class="file-buttons">
  {#each volumetric_files as file (file.name)}
    <button
      class:active={active_file === file.name}
      onclick={() => load_file(file.name, file.url)}
      title={file.description}
    >
      <strong>{file.format}</strong>
      <span>{file.label}</span>
    </button>
  {/each}
</nav>

<section class="compare-toolbar">
  <label>
    <input type="checkbox" bind:checked={show_comparison_mode} />
    Compare mode
  </label>
  <span class="toolbar-divider" aria-hidden="true"></span>
  <div class="ref-controls">
    <span class="group-label">Reference overlay</span>
    <label>
      Ref URL
      <input
        type="url"
        placeholder="https://.../vesta.png"
        bind:value={reference_image_url}
      />
    </label>
    <label>
      Upload ref
      <input type="file" accept="image/*" onchange={handle_reference_image_upload} />
    </label>
    <label>
      <input type="checkbox" bind:checked={reference_overlay_enabled} />
      Overlay
    </label>
    <label>
      Opacity
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        bind:value={reference_overlay_opacity}
      />
      <span>{format_num(reference_overlay_opacity, `.2f`)}</span>
    </label>
  </div>
  <label>
    <input type="checkbox" bind:checked={show_debug_panel} />
    Debug panel
  </label>
</section>

<div
  class="viewer-container"
  class:dragover-hint={dragover_hint}
  role="region"
  aria-label="Isosurface viewer - drop volumetric files here"
  ondragenter={(event: DragEvent) => {
    event.preventDefault()
    dragover_hint = true
  }}
  ondragleave={(event: DragEvent) => {
    // Only clear if leaving the container (not entering a child)
    const related = event.relatedTarget
    if (
      !(related instanceof Node) || !(event.currentTarget as Node).contains(related)
    ) {
      dragover_hint = false
    }
  }}
  ondrop={() => (dragover_hint = false)}
>
  <DragOverlay visible={dragover_hint} message="Drop CHGCAR, ELFCAR, LOCPOT, or .cube" />
  <div class="viewer-grid" class:compare-mode={show_comparison_mode}>
    <div class="viewer-pane">
      <Structure
        bind:structure
        bind:volumetric_data
        bind:isosurface_settings
        bind:active_volume_idx
        bind:loading
        bind:error_msg
        bind:scene_props={synced_scene_props}
        show_controls="always"
        on_file_drop={handle_dropped_file}
        on_camera_move={handle_camera_move}
        on_file_load={(data) => {
          active_file = data.filename
          reset_parse_metadata()
        }}
      >
        {#if active_file}
          <p class="filename-label">
            {active_file.replace(/\.gz$/, ``)}
          </p>
        {/if}
      </Structure>
      {#if reference_overlay_enabled && reference_image_src}
        <img
          class="reference-overlay"
          src={reference_image_src}
          alt="Reference isosurface overlay view"
          style:opacity={reference_overlay_opacity}
        />
      {/if}
    </div>
    {#if show_comparison_mode}
      <div class="viewer-pane comparison-pane">
        <Structure
          bind:structure
          bind:volumetric_data
          bind:isosurface_settings
          bind:active_volume_idx
          bind:loading
          bind:error_msg
          bind:scene_props={synced_scene_props}
          show_controls="never"
          on_camera_move={handle_camera_move}
          enable_info_pane={false}
          enable_measure_mode={false}
          allow_file_drop={false}
        />
        {#if reference_overlay_enabled && reference_image_src}
          <img
            class="reference-overlay"
            src={reference_image_src}
            alt="Reference isosurface view"
            style:opacity={reference_overlay_opacity}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if error_msg}
  <StatusMessage message={error_msg} type="error" />
{/if}

{#if data_range && volumetric_data}
  {@const vol = active_volume}
  <div class="stats-bar">
    {#if vol}
      <span title="Grid dimensions">Grid: {vol.grid_dims.join(` × `)}</span>
      <span title="Data minimum">Min: {format_num(data_range.min, `.3~g`)}</span>
      <span title="Data maximum">Max: {format_num(data_range.max, `.3~g`)}</span>
      <span title="Data mean">Mean: {format_num(data_range.mean, `.3~g`)}</span>
      <span title="Total grid points">
        Points: {format_num(vol.grid_dims[0] * vol.grid_dims[1] * vol.grid_dims[2])}
      </span>
    {/if}
    {#if parse_time_ms !== undefined}
      <span title="Parse + decompress time">Parse: {parse_time_ms} ms</span>
    {/if}
  </div>
{/if}

{#if show_debug_panel}
  <section class="debug-panel">
    <h2>Volumetric Debug Panel</h2>
    <div class="debug-grid">
      <span>File</span>
      <code>{active_file ?? `-`}</code>
      <span>Type</span>
      <code>{parsed_file_type ?? `-`}</code>
      <span>Parse source</span>
      <code>{parse_source ?? `-`}</code>
      <span>Volume block</span>
      <code>{
        volumetric_data
        ? `${active_volume_idx + 1} / ${volumetric_data.length}`
        : `-`
      }</code>
      <span>Data ordering</span>
      <code>{active_volume?.data_order ?? `-`}</code>
      <span>Periodic</span>
      <code>{active_volume ? String(active_volume.periodic) : `-`}</code>
      <span>Grid dims</span>
      <code>{active_volume ? active_volume.grid_dims.join(` × `) : `-`}</code>
      <span>Isovalue</span>
      <code>{format_num(isosurface_settings.isovalue, `.4~g`)}</code>
      <span>Data min/max/mean</span>
      <code>
        {
          active_volume
          ? `${format_num(active_volume.data_range.min, `.3~g`)} / ${
            format_num(active_volume.data_range.max, `.3~g`)
          } / ${format_num(active_volume.data_range.mean, `.3~g`)}`
          : `-`
        }
      </code>
      <span>Lattice params</span>
      <code>
        {
          active_lattice_params
          ? `a=${format_num(active_lattice_params.a, `.3~g`)}, b=${
            format_num(active_lattice_params.b, `.3~g`)
          }, c=${format_num(active_lattice_params.c, `.3~g`)}, α=${
            format_num(active_lattice_params.alpha, `.3~g`)
          }, β=${format_num(active_lattice_params.beta, `.3~g`)}, γ=${
            format_num(active_lattice_params.gamma, `.3~g`)
          }`
          : `-`
        }
      </code>
      <span>Lattice matrix</span>
      <code>
        {
          active_volume
          ? active_volume.lattice
            .map((row) =>
              `[${row.map((val) => format_num(val, `.3~g`)).join(`, `)}]`
            )
            .join(` `)
          : `-`
        }
      </code>
    </div>
  </section>
{/if}

{#if volumetric_data?.[active_volume_idx]}
  <div class="slice-section">
    <div class="slice-header">
      <h2>Cross-Section Slice</h2>
      <MillerIndexInput bind:value={miller_indices} />
      <label class="slice-position">
        d = {format_num(slice_position, `.2f`)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          bind:value={slice_position}
        />
      </label>
    </div>
    <div class="slice-view">
      <canvas bind:this={slice_canvas}></canvas>
      <ColorBar
        orientation="vertical"
        range={slice_range}
        color_scale="interpolateRdBu"
        tick_labels={5}
        bar_style="height: {slice_canvas_height}px"
        --cbar-font-size="0.75em"
        --cbar-tick-label-font-weight="normal"
      />
    </div>
  </div>
{/if}

<section class="features">
  <h2>Features</h2>
  <ul>
    <li>
      <strong>CHGCAR</strong> &ndash; VASP charge density, spin density, ELF, and local
      potential
    </li>
    <li>
      <strong>.cube</strong> &ndash; Gaussian/CP2K molecular orbitals, electron density,
      ESP
    </li>
    <li>
      <strong>Dual lobes</strong> &ndash; Positive and negative isosurfaces with
      independent colors
    </li>
    <li>
      <strong>Interactive controls</strong> &ndash; Adjust isovalue, opacity, colors, and
      wireframe
    </li>
    <li>
      <strong>Transparency</strong> &ndash; Two-pass rendering for correct transparent
      surfaces
    </li>
    <li><strong>Drag & drop</strong> &ndash; Load your own volumetric data files</li>
    <li>
      <strong>Spin-polarized</strong> &ndash; Switch between charge density and
      magnetization volumes
    </li>
    <li>
      <strong>Cross-section</strong> &ndash; 2D heatmap slices through volumetric data
    </li>
  </ul>
</section>

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  p {
    margin-bottom: 1em;
    max-width: 60em;
  }
  .file-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
    margin-bottom: 0.5em;
    button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0.3em 0.7em;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 6px;
      background: var(--surface-bg, #f5f5f5);
      cursor: pointer;
      transition: all 0.15s;
      &:hover {
        background: var(--surface-hover, #e8e8e8);
        border-color: var(--primary, #3b82f6);
      }
      &.active {
        background: var(--primary, #3b82f6);
        color: white;
        border-color: var(--primary, #3b82f6);
        strong {
          opacity: 1;
        }
      }
      strong {
        font-size: 0.65em;
        text-transform: uppercase;
        opacity: 0.6;
        letter-spacing: 0.03em;
      }
      span {
        font-size: 0.85em;
      }
    }
  }
  .viewer-container {
    position: relative;
    min-height: 500px;
  }
  .viewer-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.7em;
    height: 500px;
    &.compare-mode {
      grid-template-columns: 1fr 1fr;
    }
  }
  .viewer-pane {
    position: relative;
    height: 100%;
    :global(.matterviz-structure) {
      height: 100%;
    }
  }
  .comparison-pane {
    border: 1px dashed var(--border-color, #ccc);
    border-radius: 6px;
  }
  .reference-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    z-index: 5;
  }
  .compare-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em 1em;
    margin: 0.5em 0 0.8em;
    padding: 0.5em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 6px;
    align-items: center;
    label {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      font-size: 0.85em;
      input[type='url'] {
        min-width: 220px;
      }
    }
  }
  .toolbar-divider {
    width: 1px;
    align-self: stretch;
    background: var(--border-color, #ccc);
    opacity: 0.6;
  }
  .ref-controls {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em 1em;
    padding: 0.2em 0.6em;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 5px;
    .group-label {
      font-size: 0.8em;
      opacity: 0.8;
    }
  }
  .filename-label {
    position: absolute;
    margin: 1ex 1em;
    font-family: monospace;
    z-index: 1;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  .stats-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em 1.2em;
    padding: 0.5em 0.8em;
    margin-top: 0.5em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 6px;
    font-size: 0.8em;
    font-family: monospace;
    span {
      white-space: nowrap;
      opacity: 0.85;
    }
  }
  .slice-section {
    margin-top: 1em;
  }
  .slice-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em 0.8em;
    margin-bottom: 0.5em;
    font-size: 0.9em;
    h2 {
      margin: 0;
      font-size: 1rem;
    }
    .slice-position {
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 0.4em;
      font-family: monospace;
      input[type='range'] {
        width: 200px;
      }
    }
  }
  .slice-view {
    display: flex;
    align-items: stretch;
    gap: 1em;
    margin-top: 0.5em;
    canvas {
      outline: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      image-rendering: pixelated;
    }
  }
  .features {
    margin-top: 1.5em;
    padding: 1em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 6px;
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
    }
    ul {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 0.4rem 1.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.9rem;
    }
  }
  .debug-panel {
    margin-top: 0.8em;
    padding: 0.7em;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 6px;
    h2 {
      margin: 0 0 0.5em;
      font-size: 0.95rem;
    }
  }
  .debug-grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.2em 0.8em;
    align-items: start;
    span {
      font-size: 0.8em;
      opacity: 0.75;
      white-space: nowrap;
    }
    code {
      font-size: 0.8em;
      overflow-wrap: anywhere;
    }
  }
</style>
