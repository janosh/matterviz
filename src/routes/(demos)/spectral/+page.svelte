<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import {
    BandStructure,
    BandsDOS,
    BrillouinZone,
    DensityOfStates,
    FermiSurface,
    ThreePanels,
  } from 'svelte-widgets/icons'
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'

  type Subpage = ComponentProps<typeof SubpageGrid>[`subpages`][number]
  // [slug under /spectral, label, icon, description]
  // oxfmt-ignore
  const pages: [string, string, Subpage[`icon`], string][] = [
    [`brillouin-zone`, `Brillouin Zone`, BrillouinZone, `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`],
    [`bands`, `Band Structure`, BandStructure, `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`],
    [`dos`, `Density of States`, DensityOfStates, `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`],
    [`bands-and-dos`, `Bands + DOS`, BandsDOS, `Side-by-side band structure and density of states with synchronized energy axis.`],
    [`brillouin-bands-dos`, `Brillouin + Bands + DOS`, ThreePanels, `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`],
    [`fermi-surface`, `Fermi Surface`, FermiSurface, `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`],
    [`electronic-structure`, `Electronic Structure`, ThreePanels, `Crystal structure, Fermi surface, band structure and DOS of one calculation in one linked viewer, also stepped along a pressure sweep.`],
    [`ir-raman`, `IR + Raman`, DensityOfStates, `IR and Raman spectra from phonon eigenvectors, Born effective charges and Raman tensors.`],
    [`phonon-mode-explorer`, `Phonon Mode Explorer`, BandStructure, `Click phonon-band points to animate their atomic eigenvectors in a configurable 3D supercell.`],
  ]
  const subpages = pages.map(([slug, label, icon, description]): Subpage => ({
    href: `/spectral/${slug}`,
    label,
    icon,
    description,
  }))
</script>

<SubpageGrid
  title="Electronic & Phonons"
  subtitle="Brillouin zones, electronic and phonon band structures, density of states, Fermi surfaces, and IR/Raman spectra."
  {subpages}
/>
