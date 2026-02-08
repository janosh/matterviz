<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { DragOverlay, StatusMessage } from '$lib/feedback'
  import { load_from_url } from '$lib/io'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import { sample_hkl_slice } from '$lib/isosurface/slice'
  import { format_num } from '$lib/labels'
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
  import { onMount } from 'svelte'

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

  // HKL slice view state
  let miller_indices = $state<Vec3>([0, 0, 1]) // default (001) = z-plane
  let slice_position = $state(0.5) // fractional distance along plane normal [0, 1]
  let slice_canvas = $state<HTMLCanvasElement | undefined>()
  let slice_range = $state<[number, number]>([0, 1])

  // Use precomputed data_range from the active volume
  let data_range = $derived(volumetric_data?.[active_volume_idx]?.data_range)

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
    goto(`${page.url.pathname}?${params.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }

  async function load_file(name: string, url: string) {
    active_file = name
    loading = true
    error_msg = undefined
    parse_time_ms = undefined
    structure = undefined
    volumetric_data = undefined

    try {
      const parse_start = performance.now()
      await load_from_url(url, (content, filename) => {
        const text = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content

        const vol_result = parse_volumetric_file(text, filename)
        if (vol_result) {
          structure = vol_result.structure as AnyStructure
          volumetric_data = vol_result.volumes
          active_volume_idx = 0
          // Auto-set reasonable isovalue based on precomputed data range
          const vol = vol_result.volumes[0]
          if (vol) {
            isosurface_settings = auto_isosurface_settings(vol.data_range)
          }
        } else {
          // Fall back to regular structure parsing
          const parsed = parse_any_structure(text, filename)
          if (parsed) {
            structure = parsed
          } else {
            error_msg = `Failed to parse ${filename}`
          }
        }
      })
      parse_time_ms = Math.round(performance.now() - parse_start)
    } catch (err) {
      error_msg = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  // Sync URL when isosurface settings change (isovalue/show_negative are read
  // inside update_url, so Svelte auto-tracks them as dependencies)
  $effect(() => update_url())

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
  <Structure
    bind:structure
    bind:volumetric_data
    bind:isosurface_settings
    bind:active_volume_idx
    bind:loading
    bind:error_msg
    show_controls="always"
    on_file_load={(data) => {
      active_file = data.filename
    }}
  >
    {#if active_file}
      <h3 class="filename-label">
        {active_file.replace(/\.gz$/, ``)}
      </h3>
    {/if}
  </Structure>
</div>

{#if error_msg}
  <StatusMessage message={error_msg} type="error" />
{/if}

{#if data_range && volumetric_data}
  {@const vol = volumetric_data[active_volume_idx]}
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

{#if volumetric_data?.[active_volume_idx]}
  <div class="slice-section">
    <div class="slice-header">
      <h3>Cross-Section Slice</h3>
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
        snap_ticks={false}
        tick_side="secondary"
        style="height: 100%"
        --cbar-thickness="14px"
        --cbar-font-size="0.75em"
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
    height: 500px;
    :global(.matterviz-structure) {
      height: 100%;
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
    h3 {
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
</style>
