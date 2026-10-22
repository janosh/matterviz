<script lang="ts">
  import { open_material } from '#lib'
  import type { BandGridData } from '#lib/fermi-surface/index.js'
  import { FermiSurfaceBands, is_fermi_surface_data } from '#lib/fermi-surface/index.js'
  import { normalize_band_structure } from '#lib/spectral/helpers.js'
  import { to_error } from 'svelte-widgets/utils'
  import raw_bands from '#site/electronic/cu-fcc-bands.json.gz'
  import { fermi_surface_files } from '#site/fermi-surfaces.js'
  import { onMount } from 'svelte'

  // fcc Cu band grid and band structure (rows = the grid's band numbers − 1) from one simulated
  // calculation. The bands stay out of the electronic glob, which band demos parse eagerly.
  const grid_name = `cu_fcc_bands.bxsf.gz`
  const band_struct = normalize_band_structure(raw_bands)
  if (!band_struct) throw new Error(`Invalid band structure in cu-fcc-bands.json.gz`)
  let band_data = $state.raw<BandGridData>()
  let error_msg = $state<string>()

  onMount(async () => {
    try {
      const url = fermi_surface_files.find((file) => file.name === grid_name)?.url
      if (!url) throw new Error(`Demo file ${grid_name} not found`)
      const opened = await open_material(url)
      try {
        if (opened.type !== `fermi_surface` || is_fermi_surface_data(opened.data)) {
          throw new Error(`${grid_name} is not a band grid`)
        }
        band_data = opened.data
      } finally {
        opened.dispose()
      }
    } catch (error) {
      error_msg = to_error(error).message
    }
  })
</script>

<svelte:head>
  <title>Fermi Surface + Bands | Matterviz</title>
</svelte:head>

<h1>Fermi Surface + Band Structure</h1>

<p class="demo-intro">
  fcc Cu: the Fermi surface beside the band structure of the same calculation, bands matched by
  their index in the run, and the band path drawn through the zone. Hover a band point to see
  the constant-energy surface at its energy, its k-point and its path segment in 3D; hover the
  path or a symmetry label in 3D to find it on the bands. Click a band to pin that energy and
  isolate its sheet (click again for all bands).
</p>

{#if error_msg}
  <p style="color: var(--error-color, crimson)">{error_msg}</p>
{:else if band_data}
  <FermiSurfaceBands
    {band_data}
    {band_struct}
    fermi_props={{ show_controls: `hover` }}
    bands_props={{
      y_axis: {
        label: `Energy (eV)`,
        range: [band_data.fermi_energy - 4, band_data.fermi_energy + 4],
      },
    }}
    class="bleed-1400"
    style="--fermi-height: 520px"
  />
{:else}
  <p>Loading Cu band grid…</p>
{/if}
