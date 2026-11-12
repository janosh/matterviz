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

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    {
      label: `Brillouin Zone`,
      href: `/spectral/brillouin-zone`,
      description: `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`,
      icon: BrillouinZone,
    },
    {
      label: `Band Structure`,
      href: `/spectral/bands`,
      description: `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`,
      icon: BandStructure,
    },
    {
      label: `Density of States`,
      href: `/spectral/dos`,
      description: `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`,
      icon: DensityOfStates,
    },
    {
      label: `Bands + DOS`,
      href: `/spectral/bands-and-dos`,
      description: `Side-by-side band structure and density of states with synchronized energy axis.`,
      icon: BandsDOS,
    },
    {
      label: `Brillouin + Bands + DOS`,
      href: `/spectral/brillouin-bands-dos`,
      description: `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`,
      icon: ThreePanels,
    },
    {
      label: `Fermi Surface`,
      href: `/spectral/fermi-surface`,
      description: `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`,
      icon: FermiSurface,
    },
    {
      label: `Electronic Structure`,
      href: `/spectral/electronic-structure`,
      description: `Crystal structure, Fermi surface, band structure and DOS of one calculation in one linked viewer, also stepped along a pressure sweep.`,
      icon: ThreePanels,
    },
    {
      label: `IR + Raman`,
      href: `/spectral/ir-raman`,
      description: `IR and Raman spectra from phonon eigenvectors, Born effective charges and Raman tensors.`,
      icon: DensityOfStates,
    },
    {
      label: `Phonon Mode Explorer`,
      href: `/spectral/phonon-mode-explorer`,
      description: `Click phonon-band points to animate their atomic eigenvectors in a configurable 3D supercell.`,
      icon: BandStructure,
    },
  ]
</script>

<SubpageGrid
  title="Electronic & Phonons"
  subtitle="Brillouin zones, electronic and phonon band structures, density of states, Fermi surfaces, and IR/Raman spectra."
  {subpages}
/>
