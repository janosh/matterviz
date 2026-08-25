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
    [
      `Brillouin Zone`,
      `/reciprocal/brillouin-zone`,
      `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`,
      BrillouinZone,
    ],
    [
      `Band Structure`,
      `/reciprocal/bands`,
      `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`,
      BandStructure,
    ],
    [
      `Density of States`,
      `/reciprocal/dos`,
      `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`,
      DensityOfStates,
    ],
    [
      `Bands + DOS`,
      `/reciprocal/bands-and-dos`,
      `Side-by-side band structure and density of states with synchronized energy axis.`,
      BandsDOS,
    ],
    [
      `Brillouin + Bands + DOS`,
      `/reciprocal/brillouin-bands-dos`,
      `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`,
      ThreePanels,
    ],
    [
      `Fermi Surface`,
      `/reciprocal/fermi-surface`,
      `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`,
      FermiSurface,
    ],
    [
      `Phonon Mode Explorer`,
      `/reciprocal/phonon-mode-explorer`,
      `Click phonon-band points to animate their atomic eigenvectors in a configurable 3D supercell.`,
      BandStructure,
    ],
  ]
</script>

<SubpageGrid
  title="Reciprocal Space"
  subtitle="Brillouin zones, electronic band structures, density of states, and Fermi surfaces."
  {subpages}
/>
