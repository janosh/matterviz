<script lang="ts">
  import type { IconName } from '$lib/icons'
  import { SubpageGrid } from '$lib/layout'

  const subpages: {
    href: string
    title: string
    description: string
    icon: IconName
  }[] = [
    {
      href: `/reciprocal/brillouin-zone`,
      title: `Brillouin Zone`,
      description:
        `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`,
      icon: `BrillouinZone`,
    },
    {
      href: `/reciprocal/bands`,
      title: `Band Structure`,
      description:
        `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`,
      icon: `BandStructure`,
    },
    {
      href: `/reciprocal/dos`,
      title: `Density of States`,
      description:
        `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`,
      icon: `DensityOfStates`,
    },
    {
      href: `/reciprocal/bands-and-dos`,
      title: `Bands + DOS`,
      description:
        `Side-by-side band structure and density of states with synchronized energy axis.`,
      icon: `BandsDOS`,
    },
    {
      href: `/reciprocal/brillouin-bands-dos`,
      title: `Brillouin + Bands + DOS`,
      description:
        `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`,
      icon: `ThreePanels`,
    },
    {
      href: `/reciprocal/fermi-surface`,
      title: `Fermi Surface`,
      description:
        `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`,
      icon: `FermiSurface`,
    },
  ]
</script>

<SubpageGrid
  title="Reciprocal Space"
  subtitle="Brillouin zones, electronic band structures, density of states, and Fermi surfaces."
  {subpages}
/>
