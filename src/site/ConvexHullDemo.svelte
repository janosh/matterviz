<script lang="ts">
  import type { ElementSymbol, FileInfo } from '$lib'
  import type { PhaseData } from '$lib/convex-hull'
  import { ConvexHull3D, ConvexHull4D } from '$lib/convex-hull'
  import FilePicker from '$lib/FilePicker.svelte'
  import { onMount } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()

  // vite-plugin-json-gz decompresses at build time, lazy chunks are code-split.
  const quaternary_files = import.meta.glob<{ default: PhaseData[] }>(
    `$site/convex-hull/quaternaries/*.json.gz`,
    { eager: false },
  )

  // Map each system (e.g. `Li-Co-Ni-O`) to its glob path + lazy loader
  const systems = Object.entries(quaternary_files)
    .map(([path, loader]) => ({
      name: path.split(`/`).pop()?.replace(`.json.gz`, ``) ?? path,
      path,
      loader,
    }))
    .sort((sys_a, sys_b) => sys_a.name.localeCompare(sys_b.name))

  const loaded_data = new SvelteMap<string, PhaseData[]>()
  let active_name = $state(systems[0]?.name ?? ``)

  const load_system = async (name: string) => {
    const system = systems.find((sys) => sys.name === name)
    if (!system || loaded_data.has(system.path)) return
    try {
      loaded_data.set(system.path, (await system.loader()).default)
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

  // Keep entries whose composition only spans the given elements
  const filter_by_elements = (entries: PhaseData[], elements: string[]) => {
    const element_set = new Set(elements)
    return entries.filter((entry) =>
      (Object.keys(entry.composition) as ElementSymbol[])
        .filter((el) => (entry.composition?.[el] ?? 0) > 0)
        .every((el) => element_set.has(el)),
    )
  }

  const active_path = $derived(systems.find((sys) => sys.name === active_name)?.path ?? ``)
  const quaternary_entries = $derived(loaded_data.get(active_path) ?? [])
  // Ternary subset of the same system: drop the 3rd element (e.g. Li-Co-Ni-O -> Li-Co-O)
  const system_elements = $derived(active_name.split(`-`))
  const ternary_elements = $derived(
    system_elements.length >= 4
      ? [system_elements[0], system_elements[1], system_elements[3]]
      : system_elements,
  )
  const ternary_entries = $derived(filter_by_elements(quaternary_entries, ternary_elements))

  const picker_files = systems.map(
    (sys): FileInfo => ({
      name: sys.name,
      url: ``,
      type: `json`,
    }),
  )
  let active_files = $derived(active_name ? [active_name] : [])
</script>

{#if systems.length}
  <FilePicker
    files={picker_files}
    {active_files}
    on_click={handle_click}
    style="margin-block: 1em"
  />
  <div {...rest} class={[`hull-grid`, rest.class]}>
    <ConvexHull3D
      entries={ternary_entries}
      controls={{ title: ternary_elements.join(`-`) }}
      style="height: 500px"
    />
    <ConvexHull4D
      entries={quaternary_entries}
      controls={{ title: active_name }}
      on_file_drop={(dropped) => loaded_data.set(active_path, dropped)}
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
