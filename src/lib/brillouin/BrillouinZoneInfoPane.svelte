<script lang="ts">
  import type { InfoPaneCard, InfoPaneRow, PaneProps } from '$lib/overlays'
  import { info_pane_icon, ViewerPane } from '$lib/overlays'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_num } from '$lib/labels'
  import type { Crystal } from '$lib/structure'
  import { analyze_structure_symmetry } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { BrillouinZoneData } from './types'
  import { ordinal_label } from './types'

  let {
    pane_open = $bindable(false),
    structure,
    bz_data,
    pane_props = {},
  }: {
    pane_open?: boolean
    structure?: Crystal
    bz_data?: BrillouinZoneData
    pane_props?: PaneProps
  } = $props()

  let sym_data = $state<MoyoDataset | null>(null)

  $effect(() => {
    sym_data = null
    if (!pane_open || !structure || !(`lattice` in structure)) return

    analyze_structure_symmetry(structure, {})
      .then((data) => (sym_data = data))
      .catch(console.error)
  })

  // A zone without a structure (caller-supplied `bz_data` only) shows the zone and reciprocal
  // lattice rows; the space group and real lattice need the structure
  let pane_cards = $derived.by((): InfoPaneCard[] => {
    if (!bz_data) return []
    const zone_rows: InfoPaneRow[] = [
      { label: `Order`, value: ordinal_label(bz_data.order), key: `bz-order` },
      { label: `Volume`, value: `${format_num(bz_data.volume, `.3f`)} Å⁻³`, key: `bz-volume` },
      {
        label: `Vertices / Faces`,
        value: `${bz_data.vertices.length} / ${bz_data.faces.length}`,
        key: `bz-vertices`,
      },
    ]
    if (structure) {
      const symbol = sym_data?.hm_symbol ? `(${sym_data.hm_symbol})` : ``
      zone_rows.push({
        label: `Space Group`,
        value: `${sym_data?.number ?? ``} ${symbol}`.trim(),
        key: `space-group`,
      })
    }
    const cards: InfoPaneCard[] = [{ title: `Brillouin Zone`, rows: zone_rows }]
    if (structure?.lattice) {
      const { a, b, c, alpha, beta, gamma } = structure.lattice
      cards.push({
        title: `Real Lattice`,
        rows: [
          {
            label: `a, b, c`,
            value: `${[a, b, c].map((val) => format_num(val, `.3~f`)).join(`, `)} Å`,
            key: `real-lattice-abc`,
          },
          {
            label: `α, β, γ`,
            value: `${[alpha, beta, gamma].map((val) => format_num(val, `.2~f`)).join(`, `)}°`,
            key: `real-lattice-angles`,
          },
        ],
      })
    }
    cards.push({
      title: `Reciprocal Lattice (Å⁻¹)`,
      rows: bz_data.k_lattice.map((vec, idx) => ({
        label: [`b₁`, `b₂`, `b₃`][idx],
        value: `(${vec.map((coord) => format_num(coord, `.3~f`)).join(`, `)})`,
        key: `reciprocal-b${idx + 1}`,
      })),
    })
    return cards
  })
</script>

{#if bz_data}
  <ViewerPane
    bind:open={pane_open}
    pane_name="Brillouin zone info"
    class_prefix="bz-info"
    {pane_props}
    closed_icon={info_pane_icon}
  >
    <InfoPaneCards cards={pane_cards} empty_label="Brillouin zone info" />
  </ViewerPane>
{/if}
