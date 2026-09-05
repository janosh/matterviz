<script lang="ts">
  // Ranked routes as a sortable heatmap table; clicking a row selects the route
  import { HeatmapTable } from '$lib/table'
  import type { Label, RowData } from '$lib/table'
  import { format_equation_html } from './format'
  import type { SynthesisRoute } from './types'

  let {
    routes = [],
    selected_route_id = $bindable(null),
    ...rest
  }: {
    routes?: SynthesisRoute[]
    selected_route_id?: string | null
    [key: string]: unknown
  } = $props()

  const columns: Label[] = [
    { label: `#`, key: `rank`, sticky: true, format: `d`, color_scale: null },
    { label: `Reaction`, key: `reaction`, sticky: true, filter: `text` },
    {
      label: `Score`,
      key: `score`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      format: `.2f`,
      description: `Weighted sum of the scoring terms`,
    },
    {
      label: `ΔE (meV/atom)`,
      key: `energy`,
      better: `lower`,
      color_scale: `interpolateRdBu`,
      format: `.0f`,
      description: `Reaction energy per atom of target at the set temperature`,
    },
    {
      label: `Inverse hull (meV/atom)`,
      key: `inverse_hull`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      format: `.0f`,
      description: `Depth of the target below the hull of all other phases reachable from the precursors`,
    },
    {
      label: `Margin (meV/atom)`,
      key: `margin`,
      better: `lower`,
      color_scale: `interpolateRdBu`,
      format: `.0f`,
      description: `Target driving force minus the most favorable competitor's; negative = thermodynamically preferred`,
    },
    {
      label: `Competitors`,
      key: `n_more_favorable`,
      better: `lower`,
      format: `d`,
      description: `Phases with a larger driving force than the target`,
    },
    { label: `Net gas exchange`, key: `atmosphere`, filter: `category` },
    {
      label: `Onset (K)`,
      key: `onset`,
      better: `lower`,
      format: `d`,
      description: `First downhill temperature found for a gas-exchanging reaction (not a firing recommendation)`,
    },
    {
      label: `Practicality`,
      key: `practicality`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      format: `.2f`,
    },
    { label: `Steps`, key: `steps`, format: `d`, color_scale: null },
  ]

  const data = $derived<RowData[]>(
    routes.map((route, idx) => ({
      route_id: route.id,
      rank: idx + 1,
      reaction: format_equation_html(route.reaction.equation),
      score: route.score,
      energy: route.reaction.energy_per_atom * 1000,
      inverse_hull: route.selectivity.inverse_hull_energy * 1000,
      margin: route.selectivity.selectivity_margin * 1000,
      n_more_favorable: route.selectivity.n_more_favorable,
      onset: route.thermodynamics.onset_temperature ?? null,
      atmosphere: route.thermodynamics.atmosphere,
      practicality: route.practicality.score,
      steps: route.kind === `two_step` ? 2 : 1,
      class: route.id === selected_route_id ? `selected` : undefined,
    })),
  )

  function handle_row_click(_event: MouseEvent | KeyboardEvent, row: RowData): void {
    selected_route_id = typeof row.route_id === `string` ? row.route_id : null
  }
</script>

<div {...rest} class={[`route-table`, rest.class]}>
  <HeatmapTable
    {data}
    {columns}
    on_row_click={handle_row_click}
    initial_sort={{ column: `rank`, direction: `asc` }}
    density="compact"
    pagination={{ page_size: 15, page_sizes: [15, 30, 100] }}
    search={{ placeholder: `Filter reactions…` }}
    export_data={{ filename: `synthesis-routes` }}
  />
</div>

<style>
  .route-table {
    overflow-x: auto;
    max-width: 100%;
  }
  /* Outline on <tr> gets hidden by the sticky first cells, so frame the row cell by cell */
  .route-table :global(tr.selected td) {
    --frame: var(--accent-color, #4a9eff);
    box-shadow:
      inset 0 2px 0 var(--frame),
      inset 0 -2px 0 var(--frame);
  }
  .route-table :global(tr.selected td:first-child) {
    box-shadow:
      inset 2px 0 0 var(--frame),
      inset 0 2px 0 var(--frame),
      inset 0 -2px 0 var(--frame);
  }
  .route-table :global(tr.selected td:last-child) {
    box-shadow:
      inset -2px 0 0 var(--frame),
      inset 0 2px 0 var(--frame),
      inset 0 -2px 0 var(--frame);
  }
  .route-table :global(tr) {
    cursor: pointer;
  }
</style>
