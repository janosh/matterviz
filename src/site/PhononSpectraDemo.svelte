<script lang="ts">
  import type { FileInfo } from '#lib'
  import BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
  import type { PhononBandStructure, PhononDos } from '#lib/spectral/index.js'
  import FilePicker from '#lib/FilePicker.svelte'
  import type { Crystal } from '#lib/structure/index.js'
  import {
    load_phonon_fixtures,
    phonon_fixture_groups,
    phonon_method_label,
  } from '#site/phonons/fixtures.js'
  import { latest_load } from '#site/state.svelte.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()

  const default_group =
    phonon_fixture_groups.find((group) => group.material === `mp-2758-Sr4Se4`) ??
    phonon_fixture_groups[0]
  let active_label = $state(default_group?.label ?? ``)

  const current = $derived(
    phonon_fixture_groups.find((group) => group.label === active_label) ?? default_group,
  )

  // Fetch only the picked material's fixtures (one per method). The last loaded material
  // stays on screen until the next one arrives, and nothing renders before the first, so the
  // LazyDemo wrapper keeps its height while this demo's data loads.
  type Shown = {
    band_structs: Record<string, PhononBandStructure>
    doses: Record<string, PhononDos>
    structure?: Crystal
  }
  let shown = $state.raw<Shown>()
  let error_msg = $state<string>()
  const loads = latest_load()
  $effect(() => {
    const { material, keys } = current
    const is_current = loads.start()
    load_phonon_fixtures(keys)
      .then((fixtures) => {
        if (!is_current()) return
        const labeled = <T>(pick: (idx: number) => T | undefined) =>
          Object.fromEntries(
            keys.flatMap((key, idx) => {
              const value = pick(idx)
              return value ? [[phonon_method_label(material, key), value]] : []
            }),
          )
        const pbe_idx = keys.indexOf(`${material}-pbe`)
        shown = {
          band_structs: labeled((idx) => fixtures[idx].bands),
          doses: labeled((idx) => fixtures[idx].dos),
          structure: fixtures[pbe_idx]?.data.primitive ?? fixtures[0]?.data.primitive,
        }
        error_msg = undefined
      })
      .catch((error: unknown) => {
        if (is_current()) error_msg = `Failed to load ${material} phonons: ${String(error)}`
      })
  })

  const picker_files = phonon_fixture_groups.map((group): FileInfo => ({
    name: group.label,
    url: ``,
  }))
</script>

{#if error_msg}
  <p role="alert">{error_msg}</p>
{/if}
{#if shown}
  <FilePicker
    files={picker_files}
    active_files={active_label ? [active_label] : []}
    on_click={(file) => (active_label = file.name)}
    style="margin-block: 1em"
  />
  {#if shown.structure}
    <BandsAndDos
      structure={shown.structure}
      band_structs={shown.band_structs}
      doses={shown.doses}
      dos_props={{ normalize: `max`, sigma: 0.15 }}
      {...rest}
    />
  {/if}
{/if}
