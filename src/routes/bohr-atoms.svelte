<script lang="ts">
  import BohrAtom from '../lib/BohrAtom.svelte'
  import elements from '../periodic-table-data'
</script>

<h1>Bohr Atoms</h1>
<ol>
  {#each elements as { shells, symbol, number }}
    <li>
      <strong>{number}</strong>
      <BohrAtom {shells} label={symbol} />
    </li>
  {/each}
</ol>

<style>
  h1 {
    text-align: center;
  }
  strong {
    position: absolute;
    margin: 0;
    padding: 3pt 6pt;
    background-color: rgba(255, 255, 255, 0.06);
    border-bottom-right-radius: 1ex;
    border-top-left-radius: 1ex;
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
</style>
