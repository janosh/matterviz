<script lang="ts">
  import { DraggablePane, type InfoItem } from '$lib'
  import { format_num } from '$lib/labels'
  import type { Crystal } from '$lib/structure'
  import { analyze_structure_symmetry } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps } from 'svelte'
  import type { BrillouinZoneData } from './types'

  let {
    pane_open = $bindable(false),
    structure,
    bz_data,
    pane_props = {},
  }: {
    pane_open?: boolean
    structure?: Crystal
    bz_data?: BrillouinZoneData
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  } = $props()

  let sym_data = $state<MoyoDataset | null>(null)

  $effect(() => {
    sym_data = null
    if (!pane_open || !structure || !(`lattice` in structure)) return

    analyze_structure_symmetry(structure, {})
      .then((data) => (sym_data = data))
      .catch(console.error)
  })

  let pane_data = $derived.by(() => {
    if (!structure || !bz_data) return []
    const sections: { title: string; items: InfoItem[] }[] = []

    // Brillouin Zone section
    const bz_order_suffix = [`st`, `nd`, `rd`][bz_data.order - 1] ?? `th`
    sections.push({
      title: `Brillouin Zone`,
      items: [
        {
          label: `Order`,
          value: `${bz_data.order}${bz_order_suffix}`,
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
        {
          label: `Space Group`,
          value: `${sym_data?.number ?? ``} ${
            sym_data?.hm_symbol ? `(${sym_data.hm_symbol})` : ``
          }`.trim(),
          key: `space-group`,
        },
      ],
    })

    // Real Lattice section
    sections.push({
      title: `Real Lattice`,
      items: [
        {
          label: `a, b, c`,
          value: `${
            [structure.lattice.a, structure.lattice.b, structure.lattice.c]
              .map((val) => format_num(val, `.3~f`))
              .join(`, `)
          } Å`,
          key: `real-lattice-abc`,
        },
        {
          label: `α, β, γ`,
          value: `${
            [structure.lattice.alpha, structure.lattice.beta, structure.lattice.gamma]
              .map((val) => format_num(val, `.2~f`))
              .join(`, `)
          }°`,
          key: `real-lattice-angles`,
        },
      ],
    })

    // Reciprocal Lattice section
    const k_lattice_items: InfoItem[] = bz_data.k_lattice.map((vec, idx) => ({
      label: [`b₁`, `b₂`, `b₃`][idx],
      value: `(${vec.map((x) => format_num(x, `.3~f`)).join(`, `)})`,
      key: `reciprocal-${[`b1`, `b2`, `b3`][idx]}`,
    }))

    sections.push({ title: `Reciprocal Lattice (Å⁻¹)`, items: k_lattice_items })

    return sections
  })
</script>

{#if structure && bz_data}
  <DraggablePane
    bind:show={pane_open}
    closed_icon="Info"
    open_icon="Cross"
    toggle_props={{ class: `bz-info-toggle`, title: `Brillouin zone info` }}
    pane_props={{ ...pane_props, class: `bz-info-pane ${pane_props?.class ?? ``}` }}
  >
    {#each pane_data as section, sec_idx (section.title)}
      {#if sec_idx > 0}<hr />{/if}
      <section>
        <h4>{section.title}</h4>
        {#each section.items as item (item.key ?? item.label)}
          <div class="info-item">
            <span>{item.label}</span>
            <span>{@html item.value}</span>
          </div>
        {/each}
      </section>
    {/each}
  </DraggablePane>
{/if}

<style>
  section div.info-item {
    display: flex;
    justify-content: space-between;
    gap: 6pt;
    padding: 1pt;
    line-height: 1.5;
  }
  h4 {
    margin: 0.5em 0;
  }
  hr {
    border: none;
    border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.2));
    margin: 0.5em 0;
  }
</style>
