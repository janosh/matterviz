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
  import { SubpageGrid } from 'svelte-widgets'

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    {
      label: `Brillouin Zone`,
      href: `/reciprocal/brillouin-zone`,
      description: `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`,
      icon: BrillouinZone,
    },
    {
      label: `Band Structure`,
      href: `/reciprocal/bands`,
      description: `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`,
      icon: BandStructure,
    },
    {
      label: `Density of States`,
      href: `/reciprocal/dos`,
      description: `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`,
      icon: DensityOfStates,
    },
    {
      label: `Bands + DOS`,
      href: `/reciprocal/bands-and-dos`,
      description: `Side-by-side band structure and density of states with synchronized energy axis.`,
      icon: BandsDOS,
    },
    {
      label: `Brillouin + Bands + DOS`,
      href: `/reciprocal/brillouin-bands-dos`,
      description: `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`,
      icon: ThreePanels,
    },
    {
      label: `Fermi Surface`,
      href: `/reciprocal/fermi-surface`,
      description: `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`,
      icon: FermiSurface,
    },
    {
      label: `Phonon Mode Explorer`,
      href: `/reciprocal/phonon-mode-explorer`,
      description: `Click phonon-band points to animate their atomic eigenvectors in a configurable 3D supercell.`,
      icon: BandStructure,
    },
  ]
</script>

<SubpageGrid
  title="Reciprocal Space"
  subtitle="Brillouin zones, electronic band structures, density of states, and Fermi surfaces."
  {subpages}
/>
