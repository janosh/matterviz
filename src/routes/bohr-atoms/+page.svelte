<script lang="ts">
  import BohrAtom from '$lib/BohrAtom.svelte'
  import Toggle from '$lib/Toggle.svelte'
  import elements from '../../periodic-table-data'

  let orbiting = true
</script>

<h1>Bohr Atoms</h1>
<p>
  Radius of electron orbitals increases with the square of the shell number (shown here as
  linear due to page width constraints). Meanwhile, 'kinetic energy' of the electrons
  decreases linearly with shell number.
</p>

<Toggle bind:checked={orbiting} style="margin: auto;">Orbiting electrons?&emsp;</Toggle>

<ol>
  {#each elements as { shells, symbol, number, name }}
    <li>
      <strong>
        <a href="/{name.toLowerCase()}">{number}</a>
      </strong>
      <BohrAtom {shells} {symbol} {name} {orbiting} />
    </li>
  {/each}
</ol>

<style>
  h1,
  p {
    text-align: center;
    max-width: 50em;
    margin: 2em auto;
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
