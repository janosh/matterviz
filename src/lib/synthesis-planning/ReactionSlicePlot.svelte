<script lang="ts">
  // The reaction slice of a route rendered as a convex hull in pseudo-component space: the solid
  // precursors are the corners at 0, every reachable phase sits at its mixing fractions with its
  // driving force per atom of reacting mixture (precursors plus consumed gas) as "formation
  // energy" (pymatgen InterfacialReactivity view).
  // 2 precursors give a pseudo-binary, 3 a pseudo-ternary, 4 a pseudo-quaternary hull.
  import { format_formula_html } from '#lib/composition/index.js'
  import { ConvexHull } from '#lib/convex-hull/index.js'
  import type { PhaseData } from '#lib/convex-hull/index.js'
  import type { ComponentProps } from 'svelte'
  import { reaction_slice_points } from './thermo'
  import type { SynthesisRoute } from './types'

  // entries and components come from the route; every other ConvexHull prop passes through
  let {
    route,
    ...rest
  }: { route: SynthesisRoute } & Omit<
    ComponentProps<typeof ConvexHull>,
    `entries` | `components`
  > = $props()

  // edits that rebuild the route object keep these, so the hull isn't recomputed
  const reaction = $derived(route.reaction)
  const selectivity = $derived(route.selectivity)
  const solids = $derived(reaction.reactants.filter(({ phase }) => !phase.is_gas))
  const components = $derived(solids.map(({ phase }) => phase.formula))

  const entries = $derived(
    reaction_slice_points({ reaction, selectivity }).map(
      ({ phase, mixture, driving_force }): PhaseData => ({
        entry_id: phase.id,
        reduced_formula: phase.formula,
        composition: mixture,
        energy: driving_force,
        e_form_per_atom: driving_force,
      }),
    ),
  )
  const formulas_html = $derived(components.map((formula) => format_formula_html(formula)))
</script>

{#if components.length >= 2 && components.length <= 4}
  <ConvexHull
    {entries}
    {components}
    highlighted_entries={[reaction.products[0].phase.id]}
    x_axis={{ label: `Atom fraction of ${formulas_html[1]} in ${formulas_html.join(`–`)}` }}
    y_axis={{ label: `ΔE<sub>rxn</sub> (eV/atom of mixture)` }}
    show_unstable_labels
    controls={{ title: `Reaction slice` }}
    enable_info_pane={false}
    enable_structure_preview={false}
    allow_file_drop={false}
    {...rest}
    style="height: 400px; --hull-title-top: 0; {rest.style ?? ``}"
  />
{/if}
