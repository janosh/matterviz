<script lang="ts">
  import type { ChemicalElement } from '#lib/element/index.js'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { CalendarBlank, Gas, Liquid, Scale, Solid, Weight } from 'svelte-widgets/icons'
  import type { IconData } from 'svelte-widgets/icons'
  import { format_num } from '#lib/labels.js'
  import ElementHeading from './ElementHeading.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  const PHASE_ICONS = { Gas, Liquid, Solid } as const

  let {
    element,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    element: ChemicalElement | null
  } = $props()

  // label, icon, value and optional unit abbreviation with its expansion
  type Stat = [string, IconData, string | number, string?, string?]
  const stats = (elem: ChemicalElement): Stat[] => [
    [
      `Atomic Mass`,
      Weight,
      format_num(elem.atomic_mass),
      `(u)`,
      `Dalton aka atomic mass unit`,
    ],
    [`Density`, Scale, format_num(elem.density), `(g/cm³)`, `grams per cubic centimeter`],
    [`Phase`, PHASE_ICONS[elem.phase], elem.phase],
    [`Year of Discovery`, CalendarBlank, elem.year],
  ]
</script>

{#if element}
  <div {...rest}>
    <ElementHeading {element} style="font-size: 6cqw; grid-column: 1/-1; margin: auto 0 0" />
    {#each stats(element) as [label, icon, value, unit, unit_title] (label)}
      <section>
        <p>
          {label}
          {#if unit}<abbr title={unit_title}>{unit}</abbr>{/if}
        </p>
        <strong><Icon {icon} /> {value}</strong>
      </section>
    {/each}
  </div>
{:else}
  <h3 style="text-align: center">Hover or tap an element!</h3>
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
