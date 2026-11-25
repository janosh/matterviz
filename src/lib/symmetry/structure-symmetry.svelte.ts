import type { Crystal } from '#lib/structure/index.js'
import { getAbortSignal } from 'svelte'
import { analyze_structure_symmetry, type SymmetryDataset } from './analyze'

// The symmetry dataset of a reactive structure (call during component init), re-analyzed when
// it changes and reset meanwhile, so the previous one's results do not linger. Results are
// tagged with their structure (`of`) since derived state reads them before the effect resets
// them; a rerun or unmount aborts a superseded worker job, whose result never lands.
export const structure_symmetry = (get_structure: () => Crystal | null | undefined) => {
  let symmetry = $state.raw<{ data?: SymmetryDataset; error?: unknown; of?: Crystal }>({})
  $effect(() => {
    symmetry = {}
    const of = get_structure()
    if (!of?.lattice) return
    const signal = getAbortSignal()
    void analyze_structure_symmetry(of, {}, signal)
      .then(
        (data) => ({ data }),
        (error: unknown) => ({ error }),
      )
      .then((outcome) => {
        if (!signal.aborted) symmetry = { ...outcome, of }
      })
  })
  return {
    get current() {
      return symmetry
    },
  }
}
