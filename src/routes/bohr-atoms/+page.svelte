<script lang="ts">
  import BohrAtom from '$lib/BohrAtom.svelte'
  import elements from '$lib/element-data.yml'

  let electron_speed = 1
</script>

<h1>Bohr Atoms</h1>
<p>
  This solar-system-like visualization of the elements is known as the Bohr model. It was
  proposed by Niels Bohr in 1913. It is very much just a pretty picture far removed from
  the more accurate picture of 3d wave functions painted by quantum mechanics.
</p>
<p>
  In fact this 2d visualization is a simplification even of the incorrect Bohr model in
  which electrons really orbit in 3d around the nucleus. Yet this animation gives an
  intuitive understanding of how electrons are placed into shells and how electron
  energies decrease with increasing shell number. To be precise, the radius of electron
  orbitals increases with the square of the shell number (shown here as linear due to page
  width constraints). Meanwhile, the 'kinetic energy' of the electrons decreases linearly
  with shell number.
</p>

<label>
  Electron Speed:
  <input type="number" bind:value={electron_speed} min={0} max={5} />
  <input type="range" bind:value={electron_speed} min={0} max={5} step={1} />
</label>

<ol>
  {#each elements as { shells, symbol, number, name }}
    <li>
      <strong>
        <a href={name.toLowerCase()}>{number}</a>
      </strong>
      <BohrAtom {shells} {symbol} {name} {electron_speed} />
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
  p {
    text-align: justify;
  }
  label {
    display: flex;
    place-content: center;
  }
  input[type='number'] {
    background: transparent;
    color: inherit;
    border: none;
    text-align: center;
    padding: 0 4pt;
    font-size: large;
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
