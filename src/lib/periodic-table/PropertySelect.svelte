<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { heatmap_labels } from '$lib/labels'
  import Select from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'

  const options = Object.keys(heatmap_labels)
  interface Props extends HTMLAttributes<HTMLDivElement> {
    value?: keyof ChemicalElement | null
    empty?: boolean
    selected?: string[]
    minSelect?: number
    key?: string | null
  }
  let {
    value = $bindable(null),
    empty = false,
    selected = empty ? [] : [options[1]],
    minSelect = 0,
    key = $bindable(``),
    ...rest
  }: Props = $props()

  $effect.pre(() => {
    key = heatmap_labels[value ?? ``] ?? null
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
