<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { heatmap_labels } from '$lib/labels'
  import Select from 'svelte-multiselect'

  const options = Object.keys(heatmap_labels)
  interface Props {
    value?: keyof ChemicalElement | null
    empty?: boolean
    selected?: string[]
    minSelect?: number
    id?: string | null
    key?: string | null
  }
  let {
    value = $bindable(null),
    empty = false,
    selected = empty ? [] : [options[1]],
    minSelect = 0,
    id = null,
    key = $bindable(``),
  }: Props = $props()

  $effect.pre(() => {
    key = heatmap_labels[value ?? ``] ?? null
  })
</script>

<Select
  {id}
  {options}
  {selected}
  maxSelect={1}
  {minSelect}
  bind:value
  placeholder="Select a heat map"
  style="font-size: 1.2em;"
  inputStyle="padding: 3pt 6pt;"
/>
