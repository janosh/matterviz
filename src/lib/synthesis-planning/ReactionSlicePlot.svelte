<script lang="ts">
  // The reaction slice of a route rendered as a convex hull in pseudo-component space: the solid
  // precursors are the corners at 0, every reachable phase sits at its mixing fractions with its
  // driving force per atom of mixture as "formation energy" (pymatgen InterfacialReactivity view).
  // 2 precursors give a pseudo-binary, 3 a pseudo-ternary, 4 a pseudo-quaternary hull.
  import { format_formula_html } from '$lib/composition'
  import { ConvexHull } from '$lib/convex-hull'
  import type { PhaseData } from '$lib/convex-hull'
  import type { SynthesisRoute } from './types'

  let { route, ...rest }: { route: SynthesisRoute; [key: string]: unknown } = $props()

  const reaction = $derived(route.reaction)
  const selectivity = $derived(route.selectivity)
  const solids = $derived(reaction.reactants.filter(({ phase }) => !phase.is_gas))
  const components = $derived(solids.map(({ phase }) => phase.formula))

  const pseudo_entry = (
    entry_id: string,
    reduced_formula: string,
    composition: Record<string, number>,
    e_form_per_atom: number,
  ): PhaseData => ({
    entry_id,
    reduced_formula,
    composition,
    energy: e_form_per_atom,
    e_form_per_atom,
  })

  const entries = $derived.by((): PhaseData[] => {
    const solid_atoms = solids.map(
      ({ phase, coefficient }) => coefficient * phase.n_atoms_per_fu,
    )
    const total_atoms = solid_atoms.reduce((sum, atoms) => sum + atoms, 0)
    const target = reaction.products[0].phase
    return [
      ...solids.map(({ phase }) =>
        pseudo_entry(phase.id, phase.formula, { [phase.formula]: 1 }, 0),
      ),
      pseudo_entry(
        target.id,
        target.formula,
        Object.fromEntries(
          components.map((formula, idx) => [formula, solid_atoms[idx] / total_atoms]),
        ),
        reaction.driving_force,
      ),
      ...selectivity.competitors.map((comp) =>
        pseudo_entry(comp.phase.id, comp.phase.formula, comp.mixture, comp.driving_force),
      ),
    ]
  })
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
