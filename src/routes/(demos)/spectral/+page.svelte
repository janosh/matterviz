<script lang="ts">
  import {
    BandStructure,
    BrillouinZone,
    DensityOfStates,
    FermiSurface,
  } from 'svelte-widgets/icons'
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'
  import {
    to_subpages,
    BandsDosIcon,
    BrillouinBandsDosIcon,
    CohpIcon,
    ElectronicStructureIcon,
    IrRamanIcon,
    PhononModeIcon,
  } from '#site/overview'

  // oxfmt-ignore
  const subpages = to_subpages([
    [`/spectral/brillouin-zone`, `Brillouin Zone`, BrillouinZone, `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`],
    [`/spectral/bands`, `Band Structure`, BandStructure, `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`],
    [`/spectral/dos`, `Density of States`, DensityOfStates, `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`],
    [`/spectral/bands-and-dos`, `Bands + DOS`, BandsDosIcon, `Side-by-side band structure and density of states with synchronized energy axis.`],
    [`/spectral/brillouin-bands-dos`, `Brillouin + Bands + DOS`, BrillouinBandsDosIcon, `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`],
    [`/spectral/fermi-surface`, `Fermi Surface`, FermiSurface, `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`],
    [`/spectral/electronic-structure`, `Electronic Structure`, ElectronicStructureIcon, `Crystal structure, Fermi surface, band structure and DOS of one calculation in one linked viewer, also stepped along a pressure sweep.`],
    [`/spectral/cohp`, `COHP / COOP`, CohpIcon, `LOBSTER bonding analysis: -COHP per atom pair beside the structure, bonds colored by -ICOHP.`],
    [`/spectral/ir-raman`, `IR + Raman`, IrRamanIcon, `IR and Raman spectra from phonon eigenvectors, Born effective charges and Raman tensors.`],
    [`/spectral/phonon-mode-explorer`, `Phonon Mode Explorer`, PhononModeIcon, `Click phonon-band points to animate their atomic eigenvectors in a configurable 3D supercell.`],
  ])
</script>

<SubpageGrid
  title="Electronic & Phonons"
  subtitle="Brillouin zones, electronic and phonon band structures, density of states, Fermi surfaces, and IR/Raman spectra."
  {subpages}
/>
