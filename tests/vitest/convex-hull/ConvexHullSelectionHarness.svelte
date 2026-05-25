<script lang="ts">
  import { ConvexHull2D, ConvexHull3D, ConvexHull4D } from '$lib/convex-hull'
  import type { ConvexHullEntry, PhaseData } from '$lib/convex-hull'

  const elements_by_dim = {
    '2d': [`Li`, `O`],
    '3d': [`Li`, `O`, `Na`],
    '4d': [`Li`, `O`, `Na`, `Cl`],
  } as const
  const components = { '2d': ConvexHull2D, '3d': ConvexHull3D, '4d': ConvexHull4D }

  let { dim }: { dim: keyof typeof elements_by_dim } = $props()
  let Hull = $derived(components[dim])

  const entries_for = (prefix: string): PhaseData[] => {
    const elements = elements_by_dim[dim]
    const composition = Object.fromEntries(elements.map((element) => [element, 1]))
    return [
      ...elements.map((element) => ({
        composition: { [element]: 1 },
        energy: 0,
        entry_id: `${prefix}-${element.toLowerCase()}`,
        e_above_hull: 0,
      })),
      { composition, energy: -1, entry_id: `${prefix}-compound`, e_above_hull: 0.1 },
    ]
  }

  let entries = $state.raw(entries_for(`old`))
  let stable_entries = $state.raw<ConvexHullEntry[]>([])
  let unstable_entries = $state.raw<ConvexHullEntry[]>([])
  let selected_entry = $state.raw<ConvexHullEntry | null>(null)
</script>

<button
  type="button"
  data-testid="replace-convex-entries"
  onclick={() => (entries = entries_for(`new`))}
>
  Replace Entries
</button>
<button
  type="button"
  data-testid="refresh-convex-entries"
  onclick={() => (entries = entries_for(`old`))}
>
  Refresh Entries
</button>
<span data-testid="selected-entry">{selected_entry?.entry_id ?? `none`}</span>
<button
  type="button"
  data-testid="select-entry"
  onclick={() => (selected_entry = unstable_entries[0] ?? stable_entries[0] ?? null)}
>
  Select Entry
</button>

<Hull {entries} bind:selected_entry bind:stable_entries bind:unstable_entries />
