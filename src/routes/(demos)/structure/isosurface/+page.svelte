<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { DragOverlay, StatusMessage } from 'svelte-widgets'
  import { open_material, type OpenedMaterial } from '$lib/file-viewer/open'
  import FilePicker from '$lib/FilePicker.svelte'
  import { format_num } from '$lib/labels'
  import { volumetric_files } from '$site/isosurfaces'
  import { file_param, replace_url } from '$site/state.svelte'
  import type {
    AnyStructure,
    IsosurfaceSettings,
    StructureDisplayMode,
    VolumetricData,
    VolumetricFileData,
  } from 'matterviz'
  import {
    auto_isosurface_settings,
    auto_volume_layer,
    DEFAULT_ISOSURFACE_SETTINGS,
    Structure,
  } from 'matterviz'
  import { onMount } from 'svelte'
  import { to_error } from '$lib/utils'

  let structure = $state<AnyStructure | undefined>()
  let volumetric_data = $state.raw<VolumetricData[] | undefined>()
  let isosurface_settings = $state<IsosurfaceSettings>({
    ...DEFAULT_ISOSURFACE_SETTINGS,
  })
  let active_volume_idx = $state(0)
  let display_mode = $state<StructureDisplayMode>(`structure`)
  let active_file = $state<string | undefined>()
  let loading = $state(false)
  let error_msg = $state<string | undefined>()
  let parse_time_ms = $state<number | undefined>()
  let dragover_hint = $state(false)

  // Use precomputed data_range from the active volume
  let data_range = $derived(volumetric_data?.[active_volume_idx]?.data_range)
  let active_volume = $derived(volumetric_data?.[active_volume_idx])

  function reset_loaded_content() {
    structure = undefined
    volumetric_data = undefined
    active_volume_idx = 0
  }

  function apply_material(opened: OpenedMaterial) {
    if (opened.type === `structure`) {
      structure = opened.data
      volumetric_data = undefined
      return
    }
    if (opened.type !== `isosurface`)
      throw new Error(`Expected structure data, got ${opened.type}`)
    const parsed = opened.data
    structure = parsed.structure as AnyStructure
    volumetric_data = parsed.volumes
    active_volume_idx = 0
    const volume = parsed.volumes[0]
    if (volume) isosurface_settings = auto_isosurface_settings(volume)
  }

  function update_url() {
    if (!browser || !active_file) return
    const params = new URLSearchParams()
    params.set(`file`, active_file)
    // The first layer's isovalue/negative lobe are the URL-shareable knobs, written only when
    // they differ from what a fresh load of the file would pick anyway
    const [layer] = isosurface_settings.layers
    const first_volume = volumetric_data?.[0]
    if (layer && first_volume) {
      const defaults = auto_volume_layer(first_volume, 0)
      if (layer.isovalue !== defaults.isovalue) {
        params.set(`isovalue`, layer.isovalue.toPrecision(4))
      }
      if (layer.show_negative !== defaults.show_negative) {
        params.set(`show_negative`, String(layer.show_negative))
      }
    }
    if (display_mode === `slice`) params.set(`view`, display_mode)
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
      const opened = await open_material(url)
      try {
        apply_material(opened)
      } finally {
        opened.dispose()
      }
      parse_time_ms = Math.round(performance.now() - parse_start)
    } catch (error) {
      error_msg = to_error(error).message
    } finally {
      loading = false
    }
  }

  // The active-file guard makes the initial pre-load effect a no-op.
  $effect(update_url)

  // Load file from URL param or default on mount
  onMount(() => {
    const requested = file_param()
    display_mode = page.url.searchParams.get(`view`) === `slice` ? `slice` : `structure`
    const target = requested
      ? volumetric_files.find((file) => file.name === requested)
      : volumetric_files[0]

    if (target) {
      // Apply URL params for isovalue/show_negative after loading
      const isovalue_param = page.url.searchParams.get(`isovalue`)
      const show_neg_param = page.url.searchParams.get(`show_negative`)

      load_file(target.name, target.url).then(() => {
        const [layer] = isosurface_settings.layers
        if (!layer) return
        const parsed = Number(isovalue_param)
        if (isovalue_param && !isNaN(parsed)) layer.isovalue = parsed
        if (show_neg_param) layer.show_negative = show_neg_param === `true`
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
  <code>CHGCAR</code>/<code>AECCAR</code>/<code>ELFCAR</code>/<code>LOCPOT</code>/
  <code>PARCHG</code> and Gaussian <code>.cube</code> file formats. Drag and drop your own
  files onto the viewer. Spin-polarized VASP files load as charge and magnetization volumes;
  the cross-section view slices along HKL or arbitrary Cartesian planes. To render several
  volumes at once and color one surface by another volume's values (e.g. density by ESP), see
  the
  <a href="/structure/multi-volume">multi-volume demo</a>.
</p>

<FilePicker
  files={volumetric_files}
  active_files={active_file ? [active_file] : []}
  on_click={(file) => load_file(file.name, file.url)}
  style="margin-bottom: 0.5em"
/>

<Structure
  bind:structure
  bind:volumetric_data
  bind:isosurface_settings
  bind:active_volume_idx
  bind:display_mode
  bind:loading
  bind:error_msg
  bind:dragover={dragover_hint}
  show_controls="always"
  on_file_load={({ source_filename }) => {
    active_file = source_filename
    parse_time_ms = undefined
  }}
  class="bleed-1400"
  style="height: 600px"
>
  <DragOverlay
    visible={dragover_hint}
    message="Drop CHGCAR, AECCAR, ELFCAR, LOCPOT, PARCHG, or .cube"
  />
  {#if active_file}
    <p class="demo-overlay-label">
      {active_file.replace(/\.gz$/, ``)}
    </p>
  {/if}
</Structure>

{#if error_msg}
  <StatusMessage message={error_msg} type="error" />
{/if}

{#if data_range && volumetric_data}
  {@const vol = active_volume}
  <div class="demo-stats-bar">
    {#if vol}
      <span title="Grid dimensions">Grid: {vol.dims.join(` × `)}</span>
      <span title="Data minimum">Min: {format_num(data_range.min, `.3~g`)}</span>
      <span title="Data maximum">Max: {format_num(data_range.max, `.3~g`)}</span>
      <span title="Data mean">Mean: {format_num(data_range.mean, `.3~g`)}</span>
      <span title="Total grid points">
        Points: {format_num(vol.values.length)}
      </span>
    {/if}
    {#if parse_time_ms !== undefined}
      <span title="Parse + decompress time">Parse: {parse_time_ms} ms</span>
    {/if}
  </div>
{/if}

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  p {
    margin-bottom: 1em;
    max-width: 60em;
  }
</style>
