<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import { ELEM_HEATMAP_LABELS } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import { MultiSelect as Select } from 'svelte-widgets'

  const options = Object.keys(ELEM_HEATMAP_LABELS)
  let {
    value = $bindable(null),
    empty = false,
    selected = empty ? [] : [options[1]],
    min_select = 0,
    key = $bindable(null),
    ...rest
  }: Omit<ComponentProps<typeof Select<string>>, `options` | `key`> & {
    value?: keyof ChemicalElement | null
    empty?: boolean
    selected?: string[]
    min_select?: number
    key?: string | null
  } = $props()

  $effect.pre(() => {
    key = ELEM_HEATMAP_LABELS[value ?? ``] ?? null
  })
</script>

<Select
  {options}
  {selected}
  max_select={1}
  max_options={options.length}
  {min_select}
  bind:value
  placeholder="Select a heatmap"
  input_style="padding: 3pt 6pt;"
  {...rest}
/>
