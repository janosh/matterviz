<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import { ELEM_HEATMAP_LABELS } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'

  const options = Object.keys(ELEM_HEATMAP_LABELS)
  let {
    value = $bindable(null),
    empty = false,
    selected = empty ? [] : [options[1]],
    minSelect = 0,
    key = $bindable(null),
    ...rest
  }: Omit<ComponentProps<typeof Select>, `options` | `key`> & {
    value?: keyof ChemicalElement | null
    empty?: boolean
    selected?: string[]
    minSelect?: number
    key?: string | null
  } = $props()

  $effect.pre(() => {
    key = ELEM_HEATMAP_LABELS[value ?? ``] ?? null
  })
</script>

<Select
  {options}
  {selected}
  maxSelect={1}
  {minSelect}
  bind:value
  placeholder="Select a heatmap"
  inputStyle="padding: 3pt 6pt;"
  {...rest}
/>
