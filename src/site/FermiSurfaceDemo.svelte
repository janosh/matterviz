<script lang="ts">
  import { to_error } from 'svelte-widgets/utils'
  import { open_material, type FileInfo } from '#lib'
  import FilePicker from '#lib/FilePicker.svelte'
  import MillerIndexInput from '#lib/MillerIndexInput.svelte'
  import type {
    BandGridData,
    FermiSurfaceData,
    SliceShading,
  } from '#lib/fermi-surface/index.js'
  import { FermiSlice, FermiSurface, is_fermi_surface_data } from '#lib/fermi-surface/index.js'
  import type { Vec3 } from '#lib/math.js'
  import { format_num } from '#lib/labels.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { fermi_file_paints, fermi_surface_files } from '#site/fermi-surfaces.js'
  import { file_param, latest_load, set_file_param } from '#site/state.svelte.js'
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
  let slice_shading = $state<SliceShading | `none`>(`pockets`)
  // Shared with the slice so its contours, shading and bands match the 3D view
  let mu = $state(0)
  let interpolation_factor = $state(DEFAULTS.fermi.interpolation_factor)
  let selected_bands = $state<number[] | undefined>(undefined)
  // Cursor on the slice → dot in 3D; hovered 3D point → marker in the slice
  let slice_hovered_k = $state<Vec3 | null>(null)
  let surface_hovered_k = $state<Vec3 | null>(null)

  // A slow earlier pick (cu_fs.bxsf.gz parses for seconds) must not replace a newer one
  const loads = latest_load()
  const load_file = async (file: FileInfo) => {
    if (!file.url) return
    const is_current = loads.start()
    active_file = file.name
    error_msg = undefined
    loading = true
    if (sync_url) set_file_param(file.name)

    try {
      const opened = await open_material(file.url)
      try {
        if (!is_current()) return
        if (opened.type !== `fermi_surface`) {
          throw new Error(`Expected Fermi surface data, got ${opened.type}`)
        }
        const parsed = opened.data
        if (is_fermi_surface_data(parsed)) {
          fermi_data = parsed
          band_data = undefined
        } else {
          band_data = parsed
          fermi_data = undefined
        }
      } finally {
        opened.dispose()
      }
    } catch (error) {
      if (is_current()) error_msg = to_error(error).message
    } finally {
      if (is_current()) loading = false
    }
  }

  // Load file from URL param (when synced) or default on mount
  onMount(() => {
    const requested = sync_url ? file_param() : null
    const file_from_url = requested
      ? fermi_surface_files.find((file) => file.name === requested)
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
  file_type_paints={fermi_file_paints}
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
  bind:mu
  bind:interpolation_factor
  bind:selected_bands
  k_marker={show_slice ? slice_hovered_k : null}
  on_point_hover={(hover) => (surface_hovered_k = hover?.position_cartesian ?? null)}
  slice_plane={show_slice
    ? { miller_indices: slice_miller, distance: slice_distance }
    : undefined}
  show_controls="hover"
  on_file_load={({ source_filename }) => {
    loads.cancel() // a dropped file supersedes any pick still loading
    error_msg = undefined
    if (!source_filename) return
    active_file = source_filename
    if (sync_url) set_file_param(source_filename)
  }}
  tooltip={{
    suffix: (_data) => `File: <code>${active_file ?? `none`}</code>`,
  }}
  {...rest}
/>

{#if show_slice && fermi_data}
  <section class="slice-section">
    <header>
      <h2 id="2d-slice" style="margin: 0">2D Slice</h2>
      <MillerIndexInput bind:value={slice_miller} />
      <label>
        d:
        <input type="range" bind:value={slice_distance} min="-1" max="1" step="0.05" />
        <code>{format_num(slice_distance, `.2f`)}</code>
      </label>
      {#if band_data}
        <label>
          Shading
          <select bind:value={slice_shading}>
            <option value="pockets">Pockets (holes hatched)</option>
            <option value="occupied">Occupied side</option>
            <option value="energy">ε − E_F</option>
            <option value="none">None</option>
          </select>
        </label>
      {/if}
    </header>
    <FermiSlice
      {fermi_data}
      {band_data}
      {mu}
      {interpolation_factor}
      {selected_bands}
      shading={slice_shading}
      marker={surface_hovered_k}
      bind:hovered_k={slice_hovered_k}
      miller_indices={slice_miller}
      distance={slice_distance}
    />
  </section>
{/if}

<style>
  section {
    background: var(--surface-bg);
    border-radius: 6px;
    position: relative;
    margin-block: 1.5rem;
  }
  /* in flow above the plot: floating over it, the header hid the slice contour and k_y axis */
  section.slice-section header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding: 1ex 1em 0;
  }
  section.slice-section label {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
</style>
