<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { heatmap_labels } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'

  const options = Object.keys(heatmap_labels)
  let {
    value = $bindable(null),
    empty = false,
    selected = empty ? [] : [options[1]],
    minSelect = 0,
    key = $bindable(null),
    ...rest
  }: Omit<ComponentProps<typeof Select>, `options`> & {
    value?: keyof ChemicalElement | null
    empty?: boolean
    selected?: string[]
    minSelect?: number
    key?: string | null
  } = $props()

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
