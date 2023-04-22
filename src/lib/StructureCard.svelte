<script lang="ts">
  import { pretty_num } from './labels'
  import { alphabetical_formula, density, type Structure } from './structure'

  export let structure: Structure
  export let title: string = ''

  $: ({ volume, a, b, c, alpha, beta, gamma } = structure?.lattice ?? {})
</script>

<div class="structure-card">
  {#if title || $$slots.title}
    <h2>
      <slot name="title">
        {title}
      </slot>
    </h2>
  {/if}
  <strong>
    formula:
    <span class="value">{alphabetical_formula(structure)}</span>
  </strong>
  <strong>
    Number of atoms:
    <span class="value">{structure?.sites.length}</span>
  </strong>
  <strong>
    Volume:
    <span class="value">
      {pretty_num(volume, '.1f')} Å³
      <small>
        &nbsp; ({pretty_num(volume / structure?.sites.length, '.1f')} Å³/atom)
      </small></span
    >
  </strong>
  <strong>
    Density:
    <span class="value">{density(structure)} g/cm³</span>
  </strong>
  <strong>
    Lattice lengths (a, b, c):
    <span class="value">{pretty_num(a)} Å, {pretty_num(b)} Å, {pretty_num(c)} Å</span>
  </strong>
  <strong>
    Lattice angles (α, β, γ):
    <span class="value">
      {pretty_num(alpha)}°, {pretty_num(beta)}°, {pretty_num(gamma)}°
    </span>
  </strong>
</div>

<style>
  .structure-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    border-radius: var(--sc-radius, 3pt);
    padding: var(--sc-padding, 1ex 1em);
    gap: var(--sc-gap, 1ex 1em);
    background-color: var(--sc-bg, rgba(255, 255, 255, 0.1));
    font-size: var(--sc-font-size);
  }
  h2 {
    grid-column: 1 / -1;
    margin: 1ex 0;
    text-align: center;
  }
  strong {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .value {
    margin-left: var(--sc-value-margin, 1ex);
    background-color: var(--sc-value-bg, rgba(255, 255, 255, 0.2));
    padding: var(--sc-value-padding, 0 4pt);
    border-radius: var(--sc-value-radius, 3pt);
  }
</style>
