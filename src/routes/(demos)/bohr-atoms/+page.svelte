<script lang="ts">
  import { BohrAtom, element_data } from '$lib'
  import { Slider } from 'svelte-zoo'
  import Description from './bohr-atoms.md'

  let orbital_period = $state(2)
</script>

<Description />

<Slider
  label="Electron Orbital Period"
  bind:value={orbital_period}
  min={0}
  max={5}
  step={0.1}
  style="place-content: center; margin: 1em"
/>

<ol>
  {#each element_data as { shells, symbol, number, name } (symbol + number + name)}
    <li>
      <strong>
        <a href={name.toLowerCase()}>{number}</a>
      </strong>
      <BohrAtom {shells} {symbol} {name} {orbital_period} />
    </li>
  {/each}
</ol>

<style>
  ol {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    padding: 0;
    margin: 0 calc((-95vw + 100cqw) / 2);
  }
  li {
    display: inline-block;
    background-color: rgba(255, 255, 255, 0.04);
    margin: 1ex;
    border-radius: 1ex;
  }
  strong {
    position: absolute;
    margin: 0;
    padding: 3pt 6pt;
    background-color: rgba(255, 255, 255, 0.06);
    border-bottom-right-radius: 1ex;
    border-top-left-radius: 1ex;
  }
  strong a:focus {
    color: orange;
    outline: none;
  }
</style>
