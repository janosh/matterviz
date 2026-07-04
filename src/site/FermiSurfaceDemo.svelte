<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import type { FileInfo } from '$lib'
  import FilePicker from '$lib/FilePicker.svelte'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import type { BandGridData, FermiFileLoadData, FermiSurfaceData } from '$lib/fermi-surface'
  import {
    extract_fermi_surface,
    FermiSlice,
    FermiSurface,
    is_band_grid_data,
    is_fermi_surface_data,
    parse_fermi_file,
  } from '$lib/fermi-surface'
  import type { Vec3 } from '$lib/math'
  import { fermi_file_colors, fermi_surface_files } from '$site/fermi-surfaces'
  import { onMount } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // show_slice: render the 2D slice section + Miller controls
  // sync_url: sync the active file to the `?file=` query param
  let {
    show_slice = false,
    sync_url = false,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    show_slice?: boolean
    sync_url?: boolean
  } = $props()

  let active_file = $state<string | null>(null)
  // Use $state.raw for large data objects to avoid deep proxy creation overhead
  // These objects contain thousands of vertices/faces - wrapping in proxies takes 15+ seconds
  let fermi_data = $state.raw<FermiSurfaceData | undefined>(undefined)
  let band_data = $state.raw<BandGridData | undefined>(undefined)
  let error_msg = $state<string | undefined>(undefined)
  let loading = $state(false)
  let slice_miller = $state<Vec3>([0, 0, 1])
  let slice_distance = $state(0)

  const update_url = (filename: string) => {
    if (!sync_url || !browser) return
    // Clone page.url (read-only reactive state from $app/state) instead of mutating in place
    const url = new URL(page.url)
    url.searchParams.set(`file`, filename)
    goto(url, { replaceState: true, keepFocus: true, noScroll: true })
  }

  const load_file = async (file: FileInfo) => {
    if (!file.url) return
    active_file = file.name
    error_msg = undefined
    loading = true
    update_url(file.name)

    try {
      const { load_from_url } = await import(`$lib/io`)

      await load_from_url(file.url, (content, filename) => {
        const text =
          content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content

        const parsed = parse_fermi_file(text, filename)
        if (is_fermi_surface_data(parsed)) {
          fermi_data = parsed
          band_data = undefined
        } else if (is_band_grid_data(parsed)) {
          band_data = parsed
          fermi_data = extract_fermi_surface(band_data, { mu: 0, wigner_seitz: true })
        } else {
          error_msg = `Unable to parse ${filename}`
        }
      })
    } catch (error) {
      error_msg = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  // Load file from URL param (when synced) or default on mount
  onMount(() => {
    const file_param = sync_url ? page.url.searchParams.get(`file`) : null
    const file_from_url = file_param
      ? fermi_surface_files.find((file) => file.name === file_param)
      : null

    // Default to IFermi JSON files (pre-computed meshes, fastest to load)
    // Then pb.bxsf.gz (17³ grid, ~5K points) - fast baseline for marching cubes
    // Avoid cu_fs.bxsf.gz (31³ grid, ~30K points) which is slow to parse/render
    const target_file =
      file_from_url ??
      fermi_surface_files.find((file) => file.name.startsWith(`fs_`)) ??
      fermi_surface_files.find((file) => file.name === `pb.bxsf.gz`) ??
      fermi_surface_files.find((file) => file.name.endsWith(`.bxsf.gz`))

    if (target_file) void load_file(target_file)
  })

  let active_files = $derived(active_file ? [active_file] : [])
</script>

<FilePicker
  files={fermi_surface_files}
  {active_files}
  file_type_colors={fermi_file_colors}
  show_category_filters
  on_drag_start={(file) => (active_file = file.name)}
  on_click={(file) => void load_file(file)}
  style="margin-block: 1em"
/>

<FermiSurface
  bind:fermi_data
  bind:band_data
  bind:error_msg
  bind:loading
  show_controls="hover"
  on_file_drop={(filename: string) => {
    active_file = filename
    update_url(filename)
  }}
  on_file_load={(data: FermiFileLoadData) => {
    active_file = data.filename
    fermi_data = data.fermi_data
    band_data = data.band_data
    error_msg = undefined
  }}
  tooltip_config={{
    suffix: (_data) => `File: <code>${active_file ?? `none`}</code>`,
  }}
  {...rest}
/>

{#if show_slice && fermi_data}
  <section class="slice-section">
    <header>
      <h2 style="margin: 0">2D Slice</h2>
      <MillerIndexInput bind:value={slice_miller} />
      <label>
        d:
        <input type="range" bind:value={slice_distance} min="-1" max="1" step="0.05" />
        <code>{slice_distance.toFixed(2)}</code>
      </label>
    </header>
    <FermiSlice {fermi_data} miller_indices={slice_miller} distance={slice_distance} />
  </section>
{/if}

<style>
  section {
    background: var(--surface-bg);
    border-radius: 6px;
    position: relative;
    margin-block: 1.5rem;
  }
  section.slice-section header {
    display: flex;
    position: absolute;
    top: 1ex;
    left: 1em;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    z-index: 10;
    pointer-events: auto;
  }
  section.slice-section label {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  section.slice-section input[type='range'] {
    pointer-events: auto;
  }
</style>
