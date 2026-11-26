<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'
  import {
    BinaryPhaseDiagramIcon,
    ChemPotIcon,
    ConvexHullIcon,
    PourbaixIcon,
    PressureTemperatureIcon,
    SynthesisIcon,
    TernaryTemperatureIcon,
  } from '#site/overview-icons'

  type Subpage = ComponentProps<typeof SubpageGrid>[`subpages`][number]
  // [href, label, icon, description]
  // oxfmt-ignore
  const pages: [string, string, Subpage[`icon`], string][] = [
    [`/convex-hull`, `Convex Hulls`, ConvexHullIcon, `Binary, ternary and quaternary formation-energy hulls with stability coloring, highlighted entries and a statistics panel.`],
    [`/convex-hull/chempot-diagram`, `Chemical Potential Diagram`, ChemPotIcon, `Stability domains of every phase in chemical-potential space, in 2D for binaries and 3D for ternaries.`],
    [`/convex-hull/synthesis-planning`, `Synthesis Planner`, SynthesisIcon, `Rank precursor routes by driving force and selectivity, and see how temperature and gas pressure shift them.`],
    [`/phase-diagram`, `Binary Phase Diagram`, BinaryPhaseDiagramIcon, `Isobaric temperature–composition diagrams from JSON, SVG or CALPHAD .tdb files, with tie-lines and lever-rule readouts.`],
    [`/phase-diagram/ternary`, `Ternary T–x Phase Diagram`, TernaryTemperatureIcon, `Ternary stability landscapes swept over temperature from Gibbs energies, with exactly located phase transitions.`],
    [`/phase-diagram/pressure-temperature`, `Pressure–Temperature`, PressureTemperatureIcon, `Single-component P–T diagrams with stability fields, coexistence lines, triple and critical points and their uncertainties.`],
    [`/phase-diagram/pourbaix`, `Pourbaix Diagram`, PourbaixIcon, `Potential–pH diagrams of which species of a metal is stable in water, for one or two metals.`],
  ]
  const subpages = pages.map(([href, label, icon, description]): Subpage => ({
    href,
    label,
    icon,
    description,
  }))
</script>

<SubpageGrid
  title="Thermodynamics"
  subtitle="Convex hulls, chemical potential diagrams, synthesis planning, and phase diagrams over composition, temperature, pressure and pH."
  {subpages}
/>
