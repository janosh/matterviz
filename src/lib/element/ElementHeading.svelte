<script lang="ts">
  import type { ChemicalElement } from '$lib'

  interface Props {
    element: ChemicalElement
    style?: string
  }
  let { element, style = `` }: Props = $props()
</script>

<h2 {style}>
  {element.number} - {element.name} <small>{element.category}</small>
</h2>

<style>
  h2 {
    font-size: min(7vw, 3em);
    white-space: nowrap;
    text-align: center;
    margin: 0 0 1em;
  }
  h2 > small {
    margin-left: min(1vw, 10pt);
    font-weight: 100;
    opacity: 0.7;
  }
</style>
