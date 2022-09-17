<script lang="ts">
  import ElementHeading from './ElementHeading.svelte'
  import { pretty_num } from './labels'
  import { last_element } from './stores'

  export let style = ``

  $: element = $last_element // used to decide whether to show user tip to hover an element tile
</script>

{#if element}
  <div {style}>
    <ElementHeading
      {element}
      style="font-size: min(3vw, 3em); grid-column: 1/-1; margin: auto 0 0;"
    />
    <section>
      <p>
        Atomic Mass
        <abbr title="Dalton aka atomic mass unit">(u)</abbr>
      </p>
      <strong>{pretty_num(element.atomic_mass)}</strong>
    </section>
    <section>
      <p>
        Density
        <abbr title="grams per cubic centimeter">(g/cm³)</abbr>
      </p>
      <strong>{pretty_num(element.density)}</strong>
    </section>
    <section>
      <p>Phase</p>
      <strong>{element.phase}</strong>
    </section>
    <section>
      <p>Year of Discovery</p>
      <strong>
        {element.year}
      </strong>
    </section>
  </div>
{:else}
  <h3 style="text-align: center;">Try hovering an element!</h3>
{/if}

<style>
  div {
    display: grid;
    grid-template: auto auto / repeat(4, 1fr);
    place-items: center;
  }
  div > section {
    display: grid;
    gap: 0.5vw;
  }
  div > section > strong {
    font-size: 1.6vw;
  }
  div > section > p {
    margin: 0;
    font-weight: lighter;
    font-size: 1.2vw;
  }
  abbr {
    font-size: 0.9vw;
    text-decoration: none;
  }
  h3 {
    font-size: clamp(9pt, 3vw, 20pt);
    white-space: nowrap;
    align-self: center;
  }
</style>
