<script lang="ts">
  import SettingsGroup from 'svelte-widgets/SettingsGroup.svelte'
  import FilePicker from '#lib/FilePicker.svelte'
  import { set_url_param, url_param, url_selection } from '#site/state.svelte.js'
  import { InterfaceBuilder } from '#lib/interface/index.js'
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

  const bulk_structures = {
    'Cu (fcc)': cu_fcc,
    'Pd (fcc)': pd_fcc,
    'Fe (bcc)': fe_bcc,
    'Cs (bcc)': cs_bcc,
    'Po (simple cubic)': po_cubic,
    'Ac (hexagonal)': ac_hexagonal,
  } as unknown as Record<string, Crystal>

  // each side's material (in ?substrate= / ?film=) and the slab SlabBuilder cuts from it
  const SIDES = [`substrate`, `film`] as const
  const slabs = $state<Record<string, Slab | null>>({ substrate: null, film: null })
  const bulk_names = Object.keys(bulk_structures)
  const bulks = {
    substrate: url_selection(`substrate`, bulk_names, `Cu (fcc)`),
    film: url_selection(`film`, bulk_names, `Pd (fcc)`),
  }
  let heterostructure = $state<Heterostructure | null>(null)
  // ?match=7 picks match #7, the number the plot, select and stats show; the pick writes back,
  // #1 leaving it off
  const url_match = Number(url_param(`match`))
  let match_idx = $state(Number.isInteger(url_match) && url_match >= 1 ? url_match - 1 : 0)
  $effect(() => set_url_param(`match`, match_idx > 0 ? String(match_idx + 1) : null))
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
      <SettingsGroup title={side === `substrate` ? `Substrate` : `Film`} collapsible={false}>
        <!-- a new material means a new match list, so #N would name another interface -->
        <FilePicker
          files={bulk_names.map((name) => ({ name, url: ``, type: `json` }))}
          active_files={[bulks[side].value]}
          on_click={({ name }) => ([bulks[side].value, match_idx] = [name, 0])}
          style="margin-bottom: 0.5em"
        />
        <SlabBuilder
          structure={bulk_structures[bulks[side].value]}
          bind:slab={slabs[side]}
          min_slab_thickness={6}
          show_info={false}
          show_cell_options={false}
        />
      </SettingsGroup>
    {/each}
  </section>

  {#if slabs.substrate && slabs.film}
    <InterfaceBuilder
      substrate={slabs.substrate}
      film={slabs.film}
      bind:match_idx
      bind:interface={heterostructure}
    />
  {/if}

  {#if heterostructure}
    <Structure structure={heterostructure} bind:atom_color_config>
      <p class="demo-overlay-label">
        {bulks.film.value} on {bulks.substrate.value}, {heterostructure.sites.length} atoms
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
