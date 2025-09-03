<script lang="ts">
  import { format_num, InfoCard, superscript_digits } from '$lib'
  // import type { SummaryDoc } from '$types'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`section`]> {
    material: Record<string, unknown> // previously SummaryDoc
    after_symmetry?: Snippet
  }
  let { material, after_symmetry, ...rest }: Props = $props()

  let data = $derived([
    {
      title: `Band Gap`,
      value: material.band_gap,
      unit: `eV`,
      tooltip: material.vbm && material.cbm
        ? `VBM: ${material.vbm}, CBM: ${material.cbm}`
        : ``,
    },
    {
      title: `Space Group`,
      value: `${material.symmetry?.number}`,
      unit: `(${material.symmetry?.symbol})`,
      condition: material.symmetry?.number,
    },
    {
      title: `E<sub>above hull</sub>`,
      value: 1000 * (material?.energy_above_hull ?? 0),
      unit: `meV/atom`,
      condition: `energy_above_hull` in material,
    },
    {
      title: `Predicted stable`,
      value: (material?.energy_above_hull ?? 0 > 0) ? `❌ No` : `✅ Yes`,
      condition: `energy_above_hull` in material,
    },
    {
      title: `Formation Energy`,
      value: material.formation_energy_per_atom,
      unit: `eV/atom`,
    },
    {
      title: `Experimentally Observed`,
      value: material.theoretical ? `❌ No` : `✅ Yes`,
    },
    { title: `Total Energy`, value: material.energy_per_atom, unit: `eV/atom` },
    {
      title: `Uncorrected Energy`,
      value: material.uncorrected_energy_per_atom,
      unit: `eV/atom`,
      condition: material.uncorrected_energy_per_atom != material.energy_per_atom,
    },
    { title: `Last updated`, value: material.last_updated?.$date.split(`T`)[0] },
    {
      title: `Origins`,
      value: material.origins,
      condition: material.origins?.length,
    },
    { title: `Voigt bulk modulus`, value: material.k_voigt, unit: `GPa` },
    { title: `Voig shear modulus`, value: material.g_voigt, unit: `GPa` },
    { title: `Refractive index`, value: material.n },
    {
      title: `Is magnetic`,
      value: `${material.is_magnetic ? `yes` : `no`} ${
        material.is_magnetic
          ? `(${format_num(material.total_magnetization)} µB/f.u.)`
          : ``
      }`,
      tooltip: `µB: Bohr magneton, f.u.: formula unit`,
    },
    {
      title: `Ordering`,
      value: ({
        NM: `non-magnetic`,
        FM: `ferromagnetic`,
        FiM: `ferrimagnetic`,
        AFM: `antiferromagnetic`,
      } as Record<string, string>)[material.ordering] ?? `unknown`,
    },
    {
      title: `Possible oxidation states`,
      value: superscript_digits(material.possible_species?.join(` `) ?? ``),
      condition: material.possible_species?.length,
    },
  ])
</script>

<InfoCard {data} {...rest} title="Material" />

{@render after_symmetry?.()}

<details>
  <summary>Related material IDs</summary>
  {#if material.task_ids?.length}
    <p>
      Task IDs: {#each material.task_ids as id (id)}
        <a href="https://materialsproject.org/tasks/{id}">{id}</a>
      {/each}
    </p>
  {/if}
  {#if material.database_IDs?.icsd?.length}
    <p>
      ICSD IDs: {#each material.database_IDs.icsd as id (id)}
        {@const href =
        `https://ccdc.cam.ac.uk/structures/Search?Ccdcid=${id}&DatabaseToSearch=ICSD`}
        <a {href}>{id}</a>
      {/each}
    </p>
  {/if}
</details>

<p class="warning">
  {material.warnings}
</p>

<style>
  .warning {
    color: var(--warning-color, darkred);
  }
  p {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex 1em;
    font-size: smaller;
  }
  p a {
    background-color: rgba(255, 255, 255, 0.1);
    padding: 0 3pt;
    border-radius: 3pt;
  }
</style>
