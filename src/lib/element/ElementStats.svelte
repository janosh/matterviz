<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { ElementHeading, format_num, Icon } from '$lib'
  import type { HTMLAttributes } from 'svelte/elements'

  let { element, ...rest }: HTMLAttributes<HTMLDivElement> & {
    element: ChemicalElement | null
  } = $props()
</script>

{#if element}
  <div {...rest}>
    <ElementHeading
      {element}
      style="font-size: 6cqw; grid-column: 1/-1; margin: auto 0 0"
    />
    <section>
      <p>
        Atomic Mass
        <abbr title="Dalton aka atomic mass unit">(u)</abbr>
      </p>
      <strong>
        <Icon icon="Weight" /> {format_num(element.atomic_mass)}
      </strong>
    </section>
    <section>
      <p>
        Density
        <abbr title="grams per cubic centimeter">(g/cm³)</abbr>
      </p>
      <strong>
        <Icon icon="Scale" /> {format_num(element.density)}
      </strong>
    </section>
    <section>
      <p>Phase</p>
      <strong>
        <Icon icon={element.phase} /> {element.phase}</strong>
    </section>
    <section>
      <p>Year of Discovery</p>
      <strong>
        <Icon icon="CalendarBlank" /> {element.year}
      </strong>
    </section>
  </div>
{:else}
  <h3 style="text-align: center">Try hovering an element!</h3>
{/if}

<style>
  div {
    display: grid;
    grid-template: auto auto / repeat(4, 1fr);
    place-items: center;
    text-align: center;
    container-type: inline-size;
  }
  div > section > strong {
    display: block;
    margin-top: 1ex;
    font-size: 3.5cqw;
  }
  div > section > p {
    margin: 0;
    font-weight: lighter;
    font-size: 3cqw;
  }
  div > section > p > abbr {
    font-size: 2cqw;
    text-decoration: none;
  }
  h3 {
    font-size: clamp(9pt, 3vw, 20pt);
    white-space: nowrap;
    align-self: center;
  }
</style>
