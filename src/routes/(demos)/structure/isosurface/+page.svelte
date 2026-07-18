<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { D3InterpolateName } from '$lib/colors'
  import { DragOverlay, StatusMessage } from '$lib/feedback'
  import FilePicker from '$lib/FilePicker.svelte'
  import { load_from_url, type FileLoadMeta } from '$lib/io'
  import { ISO_COLORMAPS } from '$lib/isosurface/coloring'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import type { VolumeSliceMode } from '$lib/isosurface/slice-rendering'
  import { sample_hkl_slice, sample_plane_slice } from '$lib/isosurface/slice'
  import type { SliceResult } from '$lib/isosurface/slice'
  import VolumeSlice from '$lib/isosurface/VolumeSlice.svelte'
  import { format_num } from '$lib/labels'
  import type { Vec2, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import { parse_any_structure } from '$lib/structure/parse'
  import { volumetric_files } from '$site/isosurfaces'
  import { replace_url } from '$site/state.svelte'
  import type { AnyStructure, IsosurfaceSettings, VolumetricData } from 'matterviz'
  import { auto_isosurface_settings, DEFAULT_ISOSURFACE_SETTINGS, Structure } from 'matterviz'
  import { onMount } from 'svelte'
  import { to_error } from '$lib/utils'

  let structure = $state<AnyStructure | undefined>()
  let volumetric_data = $state.raw<VolumetricData[] | undefined>()
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
  let slice_resolution = $state(512) // display default; 0 uses the volume's native grid
  let slice_plane_mode = $state<`cartesian` | `hkl`>(`hkl`)
  let cartesian_point = $state<Vec3>([0, 0, 0])
  let cartesian_normal = $state<Vec3>([0, 0, 1])
  let cartesian_up = $state<Vec3>([1, 0, 0])
  let slice_mode = $state<VolumeSliceMode>(`both`)
  let slice_colormap = $state<D3InterpolateName>(`interpolateRdBu`)
  let contour_levels = $state(10)
  let slice_range_min = $state<number | undefined>()
  let slice_range_max = $state<number | undefined>()
  let slice_color_range = $derived<Vec2 | undefined>(
    Number.isFinite(slice_range_min) && Number.isFinite(slice_range_max)
      ? [slice_range_min as number, slice_range_max as number]
      : undefined,
  )

  // Use precomputed data_range from the active volume
  let data_range = $derived(volumetric_data?.[active_volume_idx]?.data_range)
  let active_volume = $derived(volumetric_data?.[active_volume_idx])

  const decode_content = (content: string | ArrayBuffer): string =>
    content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content

  function reset_loaded_content() {
    structure = undefined
    volumetric_data = undefined
    active_volume_idx = 0
  }

  const volume_center = (volume: VolumetricData): Vec3 =>
    math.add(volume.origin, math.create_frac_to_cart(volume.lattice)([0.5, 0.5, 0.5]))
  const vector_field = (label: string, name: string, vector: Vec3) => ({
    label,
    name,
    vector,
  })

  function reset_cartesian_plane(volume = active_volume): void {
    if (volume) cartesian_point = volume_center(volume)
  }

  function set_cartesian_plane(normal: Vec3, up: Vec3): void {
    cartesian_normal = normal
    cartesian_up = up
    reset_cartesian_plane()
  }

  function parse_and_apply(text: string, filename: string) {
    try {
      const vol_result = parse_volumetric_file(text, filename)
      if (vol_result) {
        structure = vol_result.structure as AnyStructure
        volumetric_data = vol_result.volumes
        active_volume_idx = 0
        const vol = vol_result.volumes[0]
        if (vol) {
          isosurface_settings = auto_isosurface_settings(vol.data_range)
          reset_cartesian_plane(vol)
        }
        return
      }

      structure = parse_any_structure(text, filename)
      volumetric_data = undefined
    } catch (exc) {
      error_msg = `Failed to parse ${filename}: ${to_error(exc).message}`
    }
  }

  function update_url() {
    if (!browser || !active_file) return
    const params = new URLSearchParams()
    params.set(`file`, active_file)
    if (isosurface_settings.isovalue !== DEFAULT_ISOSURFACE_SETTINGS.isovalue) {
      params.set(`isovalue`, isosurface_settings.isovalue.toPrecision(4))
    }
    if (isosurface_settings.show_negative !== DEFAULT_ISOSURFACE_SETTINGS.show_negative) {
      params.set(`show_negative`, String(isosurface_settings.show_negative))
    }
    // Use window.location instead of page.url to avoid creating a reactive
    // dependency that would cause an infinite loop with the $effect
    replace_url(`${globalThis.location.pathname}?${params.toString()}`)
  }

  async function load_file(name: string, url: string) {
    active_file = name
    loading = true
    error_msg = undefined
    parse_time_ms = undefined
    reset_loaded_content()

    try {
      const parse_start = performance.now()
      await load_from_url(url, (content, filename) => {
        parse_and_apply(decode_content(content), filename)
      })
      parse_time_ms = Math.round(performance.now() - parse_start)
    } catch (error) {
      error_msg = to_error(error).message
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
  // === Slice rendering ===
  // VolumeSlice handles color mapping, exact masks, and contours.
  let slice_result = $derived.by((): SliceResult | null => {
    const volume = volumetric_data?.[active_volume_idx]
    if (!volume) return null
    const resolution = slice_resolution > 0 ? slice_resolution : undefined
    if (slice_plane_mode === `hkl`) {
      // Sample the slice along the HKL plane
      return sample_hkl_slice(volume, miller_indices, slice_position, resolution)
    }
    return sample_plane_slice(
      volume,
      {
        point: cartesian_point,
        normal: cartesian_normal,
        up: cartesian_up,
      },
      { resolution },
    )
  })

  // Load file from URL param or default on mount
  onMount(() => {
    mounted = true
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
          const parsed = Number(isovalue_param)
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

  function handle_dropped_file(
    content: string | ArrayBuffer,
    filename: string,
    metadata: FileLoadMeta,
  ) {
    active_file = metadata.source_filename
    error_msg = undefined
    parse_time_ms = undefined
    reset_loaded_content()
    const parse_start = performance.now()
    const text = decode_content(content)
    parse_and_apply(text, filename)
    parse_time_ms = Math.round(performance.now() - parse_start)
  }
</script>

<svelte:head>
  <title>Isosurface Visualization | Matterviz</title>
</svelte:head>

<h1>Isosurface Visualization</h1>

<p>
  Render isosurfaces from volumetric data overlaid on atomic structures. Supports VASP
  <code>CHGCAR</code>/<code>AECCAR</code>/<code>ELFCAR</code>/<code>LOCPOT</code>/
  <code>PARCHG</code> and Gaussian <code>.cube</code> file formats. Drag and drop your own
  files onto the viewer. To render several volumes at once and color one surface by another
  volume's values (e.g. density by ESP), see the
  <a href="/structure/multi-volume">multi-volume demo</a>.
</p>

<FilePicker
  files={volumetric_files}
  active_files={active_file ? [active_file] : []}
  on_click={(file) => load_file(file.name, file.url)}
  style="margin-bottom: 0.5em"
/>

<div
  class="viewer-container"
  class:dragover-hint={dragover_hint}
  role="region"
  aria-label="Isosurface viewer - drop volumetric files here"
  ondragenter={(event: DragEvent) => {
    event.preventDefault()
    dragover_hint = true
  }}
  ondragleave={(event: DragEvent & { currentTarget: HTMLElement }) => {
    // Only clear if leaving the container (not entering a child)
    const related = event.relatedTarget
    if (!(related instanceof Node) || !event.currentTarget.contains(related)) {
      dragover_hint = false
    }
  }}
  ondrop={() => (dragover_hint = false)}
>
  <DragOverlay
    visible={dragover_hint}
    message="Drop CHGCAR, AECCAR, ELFCAR, LOCPOT, PARCHG, or .cube"
  />
  <div class="viewer-pane">
    <Structure
      bind:structure
      bind:volumetric_data
      bind:isosurface_settings
      bind:active_volume_idx
      bind:loading
      bind:error_msg
      show_controls="always"
      on_file_drop={handle_dropped_file}
    >
      {#if active_file}
        <p class="filename-label">
          {active_file.replace(/\.gz$/, ``)}
        </p>
      {/if}
    </Structure>
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

{#if volumetric_data?.[active_volume_idx]}
  <div class="slice-section">
    <div class="slice-header">
      <h2>Cross-Section Slice</h2>
      <label class="slice-control">
        Plane
        <select aria-label="Slice plane mode" bind:value={slice_plane_mode}>
          <option value="hkl">HKL</option>
          <option value="cartesian">Cartesian</option>
        </select>
      </label>
      {#if slice_plane_mode === `hkl`}
        <MillerIndexInput bind:value={miller_indices} />
        <label class="slice-control">
          d = {slice_position.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} bind:value={slice_position} />
        </label>
      {:else}
        {#each [vector_field(`Point (Å)`, `point`, cartesian_point), vector_field(`Normal`, `normal`, cartesian_normal)] as { label, name, vector } (name)}
          <label class="vector-control">
            <span>{label}</span>
            {#each [`x`, `y`, `z`] as axis, axis_idx (axis)}
              <input
                aria-label="Cartesian {name} {axis}"
                type="number"
                step={0.1}
                bind:value={vector[axis_idx]}
              />
            {/each}
          </label>
        {/each}
        <div class="plane-presets" aria-label="Cartesian plane presets">
          <button type="button" onclick={() => set_cartesian_plane([0, 0, 1], [1, 0, 0])}>
            XY
          </button>
          <button type="button" onclick={() => set_cartesian_plane([0, 1, 0], [1, 0, 0])}>
            XZ
          </button>
          <button type="button" onclick={() => set_cartesian_plane([1, 0, 0], [0, 1, 0])}>
            YZ
          </button>
          <button type="button" onclick={() => reset_cartesian_plane()}>Center</button>
        </div>
      {/if}
      <label class="slice-control">
        Resolution (0 = native)
        <input type="number" min={0} step={1} bind:value={slice_resolution} />
      </label>
    </div>
    <div class="slice-header rendering-controls">
      <label class="slice-control">
        View
        <select aria-label="Slice rendering mode" bind:value={slice_mode}>
          <option value="both">Filled + contours</option>
          <option value="filled">Filled</option>
          <option value="contours">Contours</option>
        </select>
      </label>
      <label class="slice-control">
        Colormap
        <select aria-label="Slice colormap" bind:value={slice_colormap}>
          {#each ISO_COLORMAPS as colormap (colormap)}
            <option value={colormap}>{colormap.replace(`interpolate`, ``)}</option>
          {/each}
        </select>
      </label>
      <label class="slice-control">
        Contours
        <input type="number" min={0} max={50} step={1} bind:value={contour_levels} />
      </label>
      <label class="slice-control">
        Range
        <input
          aria-label="Slice color minimum"
          type="number"
          step="any"
          placeholder="auto"
          bind:value={slice_range_min}
        />
        <span>to</span>
        <input
          aria-label="Slice color maximum"
          type="number"
          step="any"
          placeholder="auto"
          bind:value={slice_range_max}
        />
        <button
          type="button"
          onclick={() => {
            slice_range_min = undefined
            slice_range_max = undefined
          }}>Auto</button
        >
      </label>
    </div>
    <div class="slice-view" style:width={slice_result ? undefined : `100%`}>
      {#if slice_result}
        <VolumeSlice
          slice={slice_result}
          mode={slice_mode}
          colormap={slice_colormap}
          color_range={slice_color_range}
          {contour_levels}
          colorbar_title={active_volume?.label ?? `Value`}
          data-testid="volume-slice"
        />
      {:else}
        <StatusMessage
          message="The selected plane does not intersect the volume."
          type="warning"
          style="box-sizing: border-box; width: 100%; padding-block: 0.3em; font-size: 0.9em"
        />
      {/if}
    </div>
  </div>
{/if}

<section class="features">
  <h2>Features</h2>
  <ul>
    <li>
      <strong>CHGCAR/AECCAR/ELFCAR/LOCPOT/PARCHG</strong> &ndash; VASP charge density, partial charge
      density, ELF, and local potential
    </li>
    <li>
      <strong>.cube</strong> &ndash; Gaussian/CP2K molecular orbitals, electron density, ESP
    </li>
    <li>
      <strong>Dual lobes</strong> &ndash; Positive and negative isosurfaces with independent colors
    </li>
    <li>
      <strong>Interactive controls</strong> &ndash; Adjust isovalue, opacity, colors, and wireframe
    </li>
    <li>
      <strong>Transparency</strong> &ndash; Two-pass rendering for correct transparent surfaces
    </li>
    <li><strong>Drag & drop</strong> &ndash; Load your own volumetric data files</li>
    <li>
      <strong>Spin-polarized</strong> &ndash; Switch between charge density and magnetization volumes
    </li>
    <li>
      <strong>Cross-section</strong> &ndash; HKL and arbitrary Cartesian filled/contour maps
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
  .viewer-container {
    position: relative;
    min-height: 500px;
  }
  .viewer-pane {
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
    background: light-dark(rgba(220, 224, 230, 0.9), rgba(0, 0, 0, 0.5));
    color: light-dark(#222, white);
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
  .slice-header,
  .slice-control,
  .vector-control,
  .plane-presets {
    display: flex;
    align-items: center;
    gap: 0.4em;
  }
  .slice-header {
    flex-wrap: wrap;
    gap: 0.5em 0.8em;
    margin-bottom: 0.5em;
    font-size: 0.9em;
  }
  .slice-header h2 {
    margin: 0;
    font-size: 1rem;
  }
  .slice-control,
  .vector-control {
    white-space: nowrap;
    font-family: monospace;
  }
  .slice-control input[type='range'] {
    width: 150px;
  }
  .slice-control input[type='number'],
  .vector-control input {
    width: 4.5em;
    box-sizing: border-box;
    padding: 1px 2px;
    text-align: center;
    font-family: inherit;
  }
  .rendering-controls {
    padding-top: 0.35em;
    border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
  .slice-view {
    width: min(100%, 700px);
    margin-top: 0.5em;
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
