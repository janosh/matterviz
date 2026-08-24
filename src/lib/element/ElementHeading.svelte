<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    element,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & {
    element: ChemicalElement
  } = $props()
</script>

<h2 {...rest}>
  {element.number} - {element.name} <small>{element.category}</small>
</h2>

<style>
  h2 {
    font-size: min(7vw, 3em);
    white-space: nowrap;
    text-align: center;
    margin: 0 0 1em;
  }
  /* long names ("Rutherfordium transition metal") overflow a phone on one line */
  @container (max-width: 500px) {
    h2 {
      white-space: normal;
      text-wrap: balance;
    }
  }
  h2 > small {
    margin-left: min(1vw, 10pt);
    font-weight: 100;
    opacity: 0.7;
  }
</style>
