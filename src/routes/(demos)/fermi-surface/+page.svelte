<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import type { FileInfo } from '$lib'
  import { FilePicker } from '$lib'
  import type {
    BandGridData,
    FermiFileLoadData,
    FermiSurfaceData,
  } from '$lib/fermi-surface'
  import { FermiSlice, FermiSurface } from '$lib/fermi-surface'
  import type { Vec3 } from '$lib/math'
  import { fermi_file_colors, fermi_surface_files } from '$site/fermi-surfaces'
  import { onMount } from 'svelte'

  let active_file = $state<string | null>(null)
  // Use $state.raw for large data objects to avoid deep proxy creation overhead
  // These objects contain thousands of vertices/faces - wrapping in proxies takes 15+ seconds
  let fermi_data = $state.raw<FermiSurfaceData | undefined>(undefined)
  let band_data = $state.raw<BandGridData | undefined>(undefined)
  let error_msg = $state<string | undefined>(undefined)
  let loading = $state(false)
  let slice_miller = $state<Vec3>([0, 0, 1])
  let slice_distance = $state(0)

  function update_url(filename: string) {
    if (!browser) return
    page.url.searchParams.set(`file`, filename)
    goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }

  async function load_file(file: FileInfo) {
    if (!file.url) return
    active_file = file.name
    error_msg = undefined
    loading = true
    update_url(file.name)

    try {
      const { load_from_url } = await import(`$lib/io`)
      const { parse_fermi_file } = await import(`$lib/fermi-surface/parse`)
      const { extract_fermi_surface } = await import(`$lib/fermi-surface/compute`)

      await load_from_url(file.url, async (content, filename) => {
        const text = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content

        const parsed = parse_fermi_file(text, filename)
        if (parsed && `isosurfaces` in parsed) {
          fermi_data = parsed as FermiSurfaceData
          band_data = undefined
        } else if (parsed) {
          band_data = parsed as BandGridData
          fermi_data = extract_fermi_surface(band_data, { mu: 0, wigner_seitz: true })
        } else {
          error_msg = `Unable to parse ${filename}`
        }
      })
    } catch (err) {
      error_msg = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  // Wrapper to handle async load_file for synchronous callbacks
  function handle_file_click(file: FileInfo) {
    load_file(file).catch((err) => {
      error_msg = err instanceof Error ? err.message : String(err)
    })
  }

  // Load file from URL param or default on mount
  onMount(() => {
    const file_param = page.url.searchParams.get(`file`)
    const file_from_url = file_param
      ? fermi_surface_files.find((file) => file.name === file_param)
      : null

    // Default to IFermi JSON files (pre-computed meshes, fastest to load)
    // Then pb.bxsf.gz (17³ grid, ~5K points) - fast baseline for marching cubes
    // Avoid cu_fs.bxsf.gz (31³ grid, ~30K points) which is slow to parse/render
    const target_file = file_from_url ??
      fermi_surface_files.find((file) => file.name.startsWith(`fs_`)) ??
      fermi_surface_files.find((file) => file.name === `pb.bxsf.gz`) ??
      fermi_surface_files.find((file) => file.name.endsWith(`.bxsf.gz`))

    if (target_file) {
      load_file(target_file).catch((err) => {
        error_msg = err instanceof Error ? err.message : String(err)
      })
    }
  })

  let active_files = $derived(active_file ? [active_file] : [])
</script>

<svelte:head>
  <title>Fermi Surface | Matterviz</title>
</svelte:head>

<h1>Fermi Surface</h1>

<p>
  Interactive 3D visualization of Fermi surfaces extracted from electronic band structure
  data. Supports <code>BXSF</code>
  (<a href="http://www.xcrysden.org/" target="_blank" rel="noopener">XCrySDen</a>/<a
    href="https://www.quantum-espresso.org/"
    target="_blank"
    rel="noopener"
  >Quantum ESPRESSO</a>), <code>FRMSF</code>
  (<a href="https://mitsuaki1987.github.io/fermisurfer/" target="_blank" rel="noopener"
  >FermiSurfer</a>), and <a href="https://github.com/fermisurfaces/IFermi">IFermi</a>'s
  JSON formats. Drag and drop files onto the viewer to load them.
</p>

<FilePicker
  files={fermi_surface_files}
  {active_files}
  file_type_colors={fermi_file_colors}
  show_category_filters
  on_drag_start={(file) => (active_file = file.name)}
  on_click={handle_file_click}
  style="margin-block: 1em"
/>

<FermiSurface
  bind:fermi_data
  bind:band_data
  bind:error_msg
  bind:loading
  style="height: 500px"
  show_controls={400}
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
/>

{#if fermi_data}
  <section class="slice-section">
    <header>
      <h3 style="margin: 0">2D Slice</h3>
      <label>
        hkl:
        <input type="number" bind:value={slice_miller[0]} min="-3" max="3" />
        <input type="number" bind:value={slice_miller[1]} min="-3" max="3" />
        <input type="number" bind:value={slice_miller[2]} min="-3" max="3" />
      </label>
      <label>
        d: <input type="range" bind:value={slice_distance} min="-1" max="1" step="0.05" />
        <code>{slice_distance.toFixed(2)}</code>
      </label>
    </header>
    <FermiSlice {fermi_data} miller_indices={slice_miller} distance={slice_distance} />
  </section>
{/if}

<section style="padding: 1em">
  <h2 style="margin: 0 0 0.5rem; font-size: 1.1rem">Features</h2>
  <ul
    style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.4rem 1.5rem; margin: 0; padding: 0; list-style: none; font-size: 0.9rem"
  >
    <li>
      <strong>🔷 BXSF</strong> &ndash; <a href="http://www.xcrysden.org/">XCrySDen</a>/<a
        href="https://www.quantum-espresso.org/"
      >Quantum ESPRESSO</a> files
    </li>
    <li>
      <strong>🔶 FRMSF</strong> &ndash; <a
        href="https://mitsuaki1987.github.io/fermisurfer/"
      >FermiSurfer</a> format
    </li>
    <li><strong>🎨 Property Coloring</strong> &ndash; band, velocity, or spin</li>
    <li><strong>✂️ Slicing</strong> &ndash; 2D cross-sections along any plane</li>
    <li><strong>🔬 Brillouin Zone</strong> &ndash; 1st BZ overlay with axes</li>
    <li><strong>📊 Real-time</strong> &ndash; adjust μ and see changes instantly</li>
  </ul>
</section>

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
  }
  section.slice-section label {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  section.slice-section input[type='number'] {
    text-align: center;
  }
</style>
