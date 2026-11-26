<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'
  import {
    Atom,
    ElectronShells,
    Filter,
    PaletteSwatch,
    PeriodicTable,
    PieChart,
    Subscript,
  } from 'svelte-widgets/icons'

  type Subpage = ComponentProps<typeof SubpageGrid>[`subpages`][number]
  // [href, label, icon, description]
  // oxfmt-ignore
  const pages: [string, string, Subpage[`icon`], string][] = [
    [`/periodic-table`, `Periodic Table`, PeriodicTable, `Heatmap periodic table of element properties, with multi-value tiles, inset plots and hover details.`],
    [`/hydrogen`, `Element Pages`, Atom, `A page per element, from hydrogen to oganesson, with its photo, Bohr model, properties and trends across the table.`],
    [`/periodic-table/element-colors`, `Element Color Schemes`, PaletteSwatch, `Compare the Jmol, VESTA, alloy and other element color palettes side by side on the periodic table.`],
    [`/composition`, `Chemical Composition`, PieChart, `Pie, bubble and bar charts of a composition, colored by element, with label, amount and size controls.`],
    [`/composition/formula`, `Chemical Formula`, Subscript, `Formulas with colored element symbols, subscripts and oxidation states, parsed from nested, hydrate or charged notation.`],
    [`/composition/formula-filter`, `Formula Filter`, Filter, `Search input that infers exact formula, chemical system or element subset matching from what you type.`],
    [`/bohr-atoms`, `Bohr Atoms`, ElectronShells, `Bohr models of every element with orbiting electrons arranged in their shells.`],
  ]
  const subpages = pages.map(([href, label, icon, description]): Subpage => ({
    href,
    label,
    icon,
    description,
  }))
</script>

<SubpageGrid
  title="Elements"
  subtitle="The periodic table, per-element pages, element colors, and chemical compositions and formulas."
  {subpages}
/>
