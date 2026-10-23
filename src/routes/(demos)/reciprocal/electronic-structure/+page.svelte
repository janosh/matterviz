<script lang="ts">
  import { open_material } from '#lib'
  import type { BandGridData } from '#lib/fermi-surface/index.js'
  import type { ElectronicPane } from '#lib/spectral/index.js'
  import { band_grid_dos, is_fermi_surface_data } from '#lib/fermi-surface/index.js'
  import { ElectronicStructure, normalize_band_structure } from '#lib/spectral/index.js'
  import { is_structure_like, structure_from_json } from '#lib/structure/parse.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import { to_error } from 'svelte-widgets/utils'
  import raw_bands from '#site/electronic/cu-fcc-bands.json.gz'
  import { cu_pressure_sweep } from '#site/electronic/cu-pressure-sweep.js'
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
  // the same calculation compressed to six volumes, each frame's spectra built when first shown
  const cu_sweep = $derived(
    band_data && cu_pressure_sweep({ structure, band_data, band_struct }),
  )
  const sweep_panes: ElectronicPane[] = [
    `structure`,
    `fermi`,
    `trends`,
    `bands`,
    `dos`,
    `phonon`,
  ]
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
    class="bleed-1400"
    style="--electronic-border-radius: 8px"
  />
{:else}
  <p>Loading Cu band grid…</p>
{/if}

<h2>Pressure sweep</h2>

<p class="demo-intro">
  The same viewer along a sweep: the control bar steps or plays through the frames, every pane
  follows, and the descriptors pane plots a per-frame value against pressure (pick the
  descriptor in its header, click a point to jump there). Frames bring their structures up
  front and their band grid, bands and DOS through a loader when first shown, as a remote
  source would. This sweep is approximate, for demonstrating the viewer: the Cu calculation
  above with its cell scaled to each volume, band energies rescaled about E<sub>F</sub> as free
  electrons (∝ 1/a²) and pressures from a Birch–Murnaghan equation of state (B₀ = 140 GPa, B₀′
  = 5). The phonon pane below the electronic spectra shows a nearest-neighbour force-constant
  model of fcc stiffening with Grüneisen γ = 2, with an Eliashberg function α²F(ω) as one more
  DOS curve; its λ, ω<sub>log</sub> and ω₂ (overlaid on ω<sub>log</sub>) are descriptors. No
  frame is a calculation at its pressure.
</p>

{#if cu_sweep && band_data}
  {@const fermi_energy = band_data.fermi_energy}
  <ElectronicStructure
    sweep={cu_sweep.sweep}
    load_frame={cu_sweep.load_frame}
    panes={sweep_panes}
    fermi_props={{ show_controls: `hover` }}
    bands_props={{
      y_axis: { label: `Energy (eV)`, range: [fermi_energy - 6, fermi_energy + 6] },
    }}
    class="bleed-1400 sweep-demo"
    style="--electronic-border-radius: 8px; --electronic-height: 1100px"
  />
{/if}
