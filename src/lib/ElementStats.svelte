<script lang="ts">
  import { last_element } from '../stores'

  export let padding = `1vw 3vw`
  export let precision = 2
  $: element = $last_element
</script>

{#if element}
  <div style:padding style="overflow: hidden;">
    <h2>
      {element.number} - {element.name} <small>{element.category}</small>
    </h2>
    <div style="display: flex;">
      <section>
        <p>
          Atomic Mass
          <abbr title="Dalton aka atomic mass unit">(u)</abbr>
        </p>
        <strong>{parseFloat(element.atomic_mass?.toFixed(precision))}</strong>
      </section>
      <section>
        <p>
          Density
          <abbr title="grams per cubic centimeter">(g/cm&sup3;)</abbr>
        </p>
        <strong>{parseFloat(element.density?.toFixed(precision))}</strong>
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
  </div>
{:else}
  <h3 style="text-align: center;">Try hovering an element!</h3>
{/if}

<style>
  div > section {
    width: 25%;
  }
  div strong {
    font-size: min(2vw, 2em);
    line-height: min(2vw, 2em);
  }
  p {
    margin: 0;
    font-weight: lighter;
    font-size: clamp(6pt, 1.2vw, 15pt);
  }
  h2 {
    font-size: clamp(9pt, 3vw, 25pt);
    white-space: nowrap;
  }
  h2 small {
    margin-left: 8pt;
    font-weight: 100;
    opacity: 0.7;
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
