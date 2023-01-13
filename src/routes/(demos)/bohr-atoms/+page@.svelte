<script lang="ts">
  import { BohrAtom, element_data } from '$lib'
  import Desc from './desc.md'

  let orbital_period = 2
</script>

<Desc />

<label>
  Electron Orbital Period:
  <input type="range" bind:value={orbital_period} min={0} max={5} step={0.01} />
  <input type="number" bind:value={orbital_period} min={0} max={5} />
</label>

<ol>
  {#each element_data as { shells, symbol, number, name }}
    <li>
      <strong>
        <a href={name.toLowerCase()}>{number}</a>
      </strong>
      <BohrAtom {shells} {symbol} {name} {orbital_period} />
    </li>
  {/each}
</ol>

<style>
  label {
    display: flex;
    place-content: center;
    position: fixed;
    bottom: 3pt;
    left: 3pt;
  }
  input[type='number'] {
    background: transparent;
    color: inherit;
    border: none;
    /* text-align: center; */
    padding: 0 4pt;
    font-size: large;
    box-sizing: border-box;
    width: 2em;
  }
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    appearance: none;
  }
  ol {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    padding: 0;
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
