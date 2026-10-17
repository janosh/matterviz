<script lang="ts">
  import { browser } from '$app/env'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { InterfaceBuilder } from '#lib/interface/index.js'
  import { ControlGroup } from '#lib/layout/index.js'
  import type { Heterostructure } from '#lib/interface/index.js'
  import { SlabBuilder } from '#lib/slab/index.js'
  import type { Slab } from '#lib/slab/index.js'
  import type { AtomColorConfig, Crystal } from '#lib/structure/index.js'
  import { DEFAULT_ATOM_COLOR_CONFIG, Structure } from '#lib/structure/index.js'
  import cu_fcc from '#site/structures/Cu-FCC.json'
  import fe_bcc from '#site/structures/Fe-BCC.json'
  import cs_bcc from '#site/structures/mp-1.json'
  import pd_fcc from '#site/structures/mp-2.json'
  import ac_hexagonal from '#site/structures/mp-862690-Ac4-hexagonal.json'
  import po_cubic from '#site/structures/Po-simple-cubic.json'
  import { untrack } from 'svelte'
  import { sync_url_params } from 'svelte-widgets/url-params'

  const bulk_structures = {
    'Cu (fcc)': cu_fcc,
    'Pd (fcc)': pd_fcc,
    'Fe (bcc)': fe_bcc,
    'Cs (bcc)': cs_bcc,
    'Po (simple cubic)': po_cubic,
    'Ac (hexagonal)': ac_hexagonal,
  } as unknown as Record<string, Crystal>

  // the substrate/film pickers and the slabs SlabBuilder cuts from them
  const SIDES = [`substrate`, `film`] as const
  const sides = $state({
    substrate: { bulk: `Cu (fcc)`, slab: null as Slab | null },
    film: { bulk: `Pd (fcc)`, slab: null as Slab | null },
  })
  let heterostructure = $state<Heterostructure | null>(null)
  // ?match=7 picks match #7, the number the plot, select and stats show; the pick writes back,
  // #1 leaving it off. Read in the browser only: prerender forbids url.searchParams, and the
  // builder (slabs come from effects) never renders server-side anyway.
  const url_match = browser ? Number(page.url.searchParams.get(`match`)) : 0
  let match_idx = $state(Number.isInteger(url_match) && url_match >= 1 ? url_match - 1 : 0)
  $effect(() => {
    sync_url_params(
      [[`match`, String(match_idx + 1), `1`]],
      globalThis.location,
      (url) =>
        void goto(url, { shallow: true, replace: true, state: untrack(() => page.state) }),
    )
  })
  let atom_color_config = $state<AtomColorConfig>({
    ...DEFAULT_ATOM_COLOR_CONFIG,
    mode: `custom`,
    scale_type: `categorical`,
    color_fn: (site) => String(site.properties.interface_role ?? `unknown`),
  })
</script>

<h1 id="heterointerfaces">Heterointerfaces</h1>

<p class="demo-intro">
  Stack a film slab on a substrate slab. Both surfaces are searched for coincidence-lattice
  supercells (Zur–McGill): pairs of super-lattices whose vectors agree within a length and
  angle tolerance. Each match is plotted by interface cell area and the von Mises strain the
  film takes on to fit the substrate; click a point or pick from the list to stack it. Atoms
  are colored by whether they belong to the substrate or the film.
</p>

<div class="bleed-1400">
  <section class="demo-2col">
    {#each SIDES as side (side)}
      <ControlGroup legend={side === `substrate` ? `Substrate` : `Film`}>
        <SlabBuilder
          structure={bulk_structures[sides[side].bulk]}
          bind:slab={sides[side].slab}
          min_slab_thickness={6}
          show_info={false}
          show_cell_options={false}
        >
          <label>
            Material
            <!-- a new material means a new match list, so #N would name another interface -->
            <select bind:value={sides[side].bulk} onchange={() => (match_idx = 0)}>
              {#each Object.keys(bulk_structures) as key (key)}
                <option value={key}>{key}</option>
              {/each}
            </select>
          </label>
        </SlabBuilder>
      </ControlGroup>
    {/each}
  </section>

  {#if sides.substrate.slab && sides.film.slab}
    <InterfaceBuilder
      substrate={sides.substrate.slab}
      film={sides.film.slab}
      bind:match_idx
      bind:interface={heterostructure}
    />
  {/if}

  {#if heterostructure}
    <Structure structure={heterostructure} bind:atom_color_config>
      <p class="demo-overlay-label">
        {sides.film.bulk} on {sides.substrate.bulk}, {heterostructure.sites.length} atoms
      </p>
    </Structure>
  {/if}
</div>

<style>
  .bleed-1400 {
    --struct-height: 650px;
  }
  .demo-2col {
    gap: 1em;
  }
</style>
