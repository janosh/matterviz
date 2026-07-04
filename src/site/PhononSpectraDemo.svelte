<script lang="ts">
  import type { FileInfo } from '$lib'
  import BrillouinBandsDos from '$lib/spectral/BrillouinBandsDos.svelte'
  import FilePicker from '$lib/FilePicker.svelte'
  import type { Crystal } from '$lib/structure'
  import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
  import type { HTMLAttributes } from 'svelte/elements'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()

  const METHOD_SUFFIX = /-(?:pbe|m3gnet|chgnet-v[\d.]+|mace-[\w-]+)$/

  const method_label = (material: string, key: string) => {
    const method = key.slice(material.length + 1)
    if (method === `pbe`) return `DFT (PBE)`
    if (method === `m3gnet`) return `M3GNet`
    if (method.startsWith(`chgnet`)) return `CHGNet`
    if (method.startsWith(`mace`)) return `MACE`
    return method
  }

  // Group band-structure keys by material (everything before the method suffix)
  const groups = (() => {
    const by_material = new Map<string, string[]>()
    for (const key of Object.keys(phonon_bands)) {
      const material = key.replace(METHOD_SUFFIX, ``)
      by_material.set(material, [...(by_material.get(material) ?? []), key])
    }
    return [...by_material.entries()]
      .map(([material, keys]) => {
        const [, mp_id = ``, formula = material] =
          /^(?<mp_id>mp-\d+)-(?<formula>.+)$/.exec(material) ?? []
        return { material, keys, label: mp_id ? `${formula} (${mp_id})` : material }
      })
      .sort((grp_a, grp_b) => grp_a.label.localeCompare(grp_b.label))
  })()

  const default_group = groups.find((grp) => grp.material === `mp-2758-Sr4Se4`) ?? groups[0]
  let active_label = $state(default_group?.label ?? ``)

  const current = $derived(groups.find((grp) => grp.label === active_label) ?? default_group)
  // Map the current material's per-method keys to method-labeled entries (DFT (PBE), CHGNet, ...)
  const labeled = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      (current?.keys ?? [])
        .filter((key) => record[key])
        .map((key) => [method_label(current.material, key), record[key]]),
    )
  const band_structs = $derived(labeled(phonon_bands))
  const doses = $derived(labeled(phonon_dos))
  const structure = $derived(
    (phonon_data[`${current?.material}-pbe`]?.primitive ??
      phonon_data[current?.keys[0] ?? ``]?.primitive) as Crystal | undefined,
  )

  const picker_files = groups.map((grp): FileInfo => ({ name: grp.label, url: `` }))
  let active_files = $derived(active_label ? [active_label] : [])
</script>

{#if groups.length}
  <FilePicker
    files={picker_files}
    {active_files}
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
