<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { ElementHeading, Icon, pretty_num } from '$lib'

  interface Props {
    element: ChemicalElement | null
    style?: string
  }
  let { element, style = `` }: Props = $props()

  const icon_phase_map = {
    Solid: `mdi:cube-outline`,
    Liquid: `mdi:water-outline`,
    Gas: `mdi:gas-cylinder`,
  }
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
      <strong>
        <Icon icon="mdi:weight" />
        {pretty_num(element.atomic_mass)}
      </strong>
    </section>
    <section>
      <p>
        Density
        <abbr title="grams per cubic centimeter">(g/cm³)</abbr>
      </p>
      <strong>
        <Icon icon="ion:scale-outline" />
        {pretty_num(element.density)}
      </strong>
    </section>
    <section>
      <p>Phase</p>
      <strong>
        <Icon icon={icon_phase_map[element.phase]} />
        {element.phase}</strong
      >
    </section>
    <section>
      <p>Year of Discovery</p>
      <strong>
        <Icon icon="material-symbols:event-available" />
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
