<script lang="ts">
  import { info_pane_icon, type InfoPaneRow, type PaneProps, ViewerPane } from '$lib/overlays'
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
  let pane_data = $derived.by(() => {
    if (!bz_data) return []
    const sections: { title: string; items: InfoPaneRow[] }[] = []

    // Brillouin Zone section
    sections.push({
      title: `Brillouin Zone`,
      items: [
        {
          label: `Order`,
          value: ordinal_label(bz_data.order),
          key: `bz-order`,
        },
        {
          label: `Volume`,
          value: `${format_num(bz_data.volume, `.3f`)} Å⁻³`,
          key: `bz-volume`,
        },
        {
          label: `Vertices / Faces`,
          value: `${bz_data.vertices.length} / ${bz_data.faces.length}`,
          key: `bz-vertices`,
        },
        ...(structure
          ? [
              {
                label: `Space Group`,
                value: `${sym_data?.number ?? ``} ${
                  sym_data?.hm_symbol ? `(${sym_data.hm_symbol})` : ``
                }`.trim(),
                key: `space-group`,
              },
            ]
          : []),
      ],
    })
    if (structure?.lattice) {
      const { a, b, c, alpha, beta, gamma } = structure.lattice
      sections.push({
        title: `Real Lattice`,
        items: [
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

    // Reciprocal Lattice section
    const k_lattice_items: InfoPaneRow[] = bz_data.k_lattice.map((vec, idx) => ({
      label: [`b₁`, `b₂`, `b₃`][idx],
      value: `(${vec.map((coord) => format_num(coord, `.3~f`)).join(`, `)})`,
      key: `reciprocal-${[`b1`, `b2`, `b3`][idx]}`,
    }))

    sections.push({ title: `Reciprocal Lattice (Å⁻¹)`, items: k_lattice_items })

    return sections
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
    <InfoPaneCards
      cards={pane_data.map(({ title, items }) => ({ title, rows: items }))}
      empty_label="Brillouin zone info"
    />
  </ViewerPane>
{/if}
