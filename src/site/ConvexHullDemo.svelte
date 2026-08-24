<script lang="ts">
  import type { FileInfo } from '$lib'
  import type { PhaseData } from '$lib/convex-hull'
  import { ConvexHullCanvas } from '$lib/convex-hull'
  import FilePicker from '$lib/FilePicker.svelte'
  import { filter_by_elements, hull_system_name, quaternary_files } from '$site/convex-hull'
  import { onMount } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()

  // System name (e.g. `Li-Co-Ni-O`) -> lazy loader of its entries
  const systems = new SvelteMap(
    Object.entries(quaternary_files)
      .map(([path, loader]) => [hull_system_name(path), loader] as const)
      .toSorted(([name_a], [name_b]) => name_a.localeCompare(name_b)),
  )
  const loaded_data = new SvelteMap<string, PhaseData[]>()
  let active_name = $state([...systems.keys()][0] ?? ``)

  const load_system = async (name: string) => {
    const loader = systems.get(name)
    if (!loader || loaded_data.has(name)) return
    try {
      loaded_data.set(name, (await loader()).default)
    } catch (error) {
      console.error(`Failed to load convex hull data ${name}`, error)
    }
  }

  const handle_click = (file: FileInfo) => {
    active_name = file.name
    void load_system(file.name)
  }

  onMount(() => {
    if (active_name) void load_system(active_name)
  })

  const quaternary_entries = $derived(loaded_data.get(active_name) ?? [])
  // Ternary subset of the same system: drop the 3rd element (e.g. Li-Co-Ni-O -> Li-Co-O)
  const system_elements = $derived(active_name.split(`-`))
  const ternary_elements = $derived(
    system_elements.length >= 4
      ? [system_elements[0], system_elements[1], system_elements[3]]
      : system_elements,
  )
  const ternary_entries = $derived(filter_by_elements(quaternary_entries, ternary_elements))

  const picker_files = [...systems.keys()].map((name): FileInfo => ({
    name,
    url: ``,
    type: `json`,
  }))
</script>

{#if systems.size}
  <FilePicker
    files={picker_files}
    active_files={active_name ? [active_name] : []}
    on_click={handle_click}
    style="margin-block: 1em"
  />
  <div {...rest} class={[`hull-grid`, rest.class]}>
    <ConvexHullCanvas
      dim={3}
      entries={ternary_entries}
      controls={{ title: ternary_elements.join(`-`) }}
      style="height: 500px"
    />
    <ConvexHullCanvas
      dim={4}
      entries={quaternary_entries}
      controls={{ title: active_name }}
      on_file_drop={(dropped) => loaded_data.set(active_name, dropped)}
      style="height: 500px"
    />
  </div>
{/if}

<style>
  .hull-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
  @media (max-width: 900px) {
    .hull-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
