<script lang="ts">
  import type { FileInfo } from '$lib'
  import BrillouinBandsDos from '$lib/spectral/BrillouinBandsDos.svelte'
  import FilePicker from '$lib/FilePicker.svelte'
  import {
    phonon_bands,
    phonon_data,
    phonon_dos,
    phonon_fixture_groups,
    phonon_method_label,
  } from '$site/phonons'
  import type { HTMLAttributes } from 'svelte/elements'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()

  const default_group =
    phonon_fixture_groups.find((group) => group.material === `mp-2758-Sr4Se4`) ??
    phonon_fixture_groups[0]
  let active_label = $state(default_group?.label ?? ``)

  const current = $derived(
    phonon_fixture_groups.find((group) => group.label === active_label) ?? default_group,
  )
  // Map the current material's per-method keys to method-labeled entries (DFT (PBE), CHGNet, ...)
  const labeled = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      (current?.keys ?? [])
        .filter((key) => record[key])
        .map((key) => [phonon_method_label(current.material, key), record[key]]),
    )
  const band_structs = $derived(labeled(phonon_bands))
  const doses = $derived(labeled(phonon_dos))
  const structure = $derived(
    phonon_data[`${current?.material}-pbe`]?.primitive ??
      phonon_data[current?.keys[0] ?? ``]?.primitive,
  )

  const picker_files = phonon_fixture_groups.map((group): FileInfo => ({
    name: group.label,
    url: ``,
  }))
</script>

{#if phonon_fixture_groups.length}
  <FilePicker
    files={picker_files}
    active_files={active_label ? [active_label] : []}
    on_click={(file) => (active_label = file.name)}
    style="margin-block: 1em"
  />
  {#if structure}
    <BrillouinBandsDos
      {structure}
      {band_structs}
      {doses}
      dos_props={{ normalize: `max`, sigma: 0.15 }}
      {...rest}
    />
  {/if}
{/if}
