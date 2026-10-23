<script lang="ts">
  import { open_material } from '#lib'
  import type { BandGridData } from '#lib/fermi-surface/index.js'
  import { band_grid_dos, is_fermi_surface_data } from '#lib/fermi-surface/index.js'
  import { ElectronicStructure, normalize_band_structure } from '#lib/spectral/index.js'
  import { is_structure_like, structure_from_json } from '#lib/structure/parse.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import { to_error } from 'svelte-widgets/utils'
  import raw_bands from '#site/electronic/cu-fcc-bands.json.gz'
  import { fermi_surface_files } from '#site/fermi-surfaces.js'
  import { onMount } from 'svelte'

  // fcc Cu from one simulated calculation: its band grid, its band structure and the structure
  // embedded there, so real and reciprocal lattice share one Cartesian frame and the grid's
  // bands are the band structure's (rows = the grid's band numbers − 1). The DOS is computed
  // from the grid, so it covers the grid's bands only.
  const grid_name = `cu_fcc_bands.bxsf.gz`
  const band_struct = normalize_band_structure(raw_bands)
  if (!band_struct) throw new Error(`Invalid band structure in cu-fcc-bands.json.gz`)
  const raw_structure =
    raw_bands && typeof raw_bands === `object` && `structure` in raw_bands
      ? raw_bands.structure
      : undefined
  const structure = is_structure_like(raw_structure)
    ? structure_from_json(raw_structure)
    : undefined
  if (!is_crystal(structure)) throw new Error(`No crystal structure in cu-fcc-bands.json.gz`)
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
  const doses = $derived(band_data && { 'bands 3–6': band_grid_dos(band_data) })
</script>

<svelte:head>
  <title>Electronic Structure | Matterviz</title>
</svelte:head>

<h1>Electronic Structure</h1>

<p class="demo-intro">
  fcc Cu in one viewer: crystal structure, Fermi surface (folded into the first Brillouin
  zone), band structure and density of states of the same calculation. Real and reciprocal
  lattice share one Cartesian frame, so rotating either 3D scene turns the other with it (the
  link button in the top-right controls unlinks them). Hover a band or the DOS to see the
  constant-energy surface at that energy, and the band's k-point on the path through the zone;
  click a band to pin its energy and isolate its sheet. The pane menu shows any subset, the
  dividers resize the panes, and a dropped structure, Fermi surface, band structure or DOS file
  replaces the pane it belongs to.
</p>

{#if error_msg}
  <p style="color: var(--error-color, crimson)">{error_msg}</p>
{:else if band_data}
  {@const fermi_energy = band_data.fermi_energy}
  <ElectronicStructure
    {structure}
    {band_data}
    band_structs={{ Cu: band_struct }}
    {doses}
    fermi_props={{ show_controls: `hover` }}
    bands_props={{
      y_axis: { label: `Energy (eV)`, range: [fermi_energy - 4, fermi_energy + 4] },
    }}
    dos_props={{ y_axis: { range: [fermi_energy - 4, fermi_energy + 4] } }}
    class="bleed-1400"
    style="--electronic-border-radius: 8px"
  />
{:else}
  <p>Loading Cu band grid…</p>
{/if}
