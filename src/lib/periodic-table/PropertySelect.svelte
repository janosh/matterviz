<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import { ELEM_HEATMAP_LABELS } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import { MultiSelect as Select } from 'svelte-widgets'

  const options = Object.keys(ELEM_HEATMAP_LABELS) as (keyof ChemicalElement)[]
  let {
    empty = false,
    value = $bindable(empty ? null : options[1]),
    min_select = 0,
    key = $bindable(null),
    ...rest
  }: Omit<
    Extract<ComponentProps<typeof Select<keyof ChemicalElement>>, { mode: `single` }>,
    `options` | `key` | `mode`
  > & {
    empty?: boolean
    key?: string | null
  } = $props()

  $effect.pre(() => {
    key = ELEM_HEATMAP_LABELS[value ?? ``] ?? null
  })
</script>

<Select
  {options}
  mode="single"
  max_options={options.length}
  {min_select}
  bind:value
  placeholder="Select a heatmap"
  input_style="padding: 3pt 6pt;"
  {...rest}
/>
