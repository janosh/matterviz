<script lang="ts">
  import { element_data } from '$lib'
  import BohrAtom from '$lib/BohrAtom.svelte'

  let orbital_period = 2
</script>

<h1>Bohr Atoms</h1>
<p>
  This solar-system-like visualization of the elements is known as the Bohr model. It was
  proposed by Niels Bohr in 1913. It should not be viewed as an accurate picture of
  reality. Quantum mechanics has shown that electrons are really unlocalized wave
  functions still centered around the nucleus but with much more complicated shapes
  determined by their quantum numbers n, l, m and s. n is the shell number, l is the
  orbital angular, m is the magnetic moment and s is the spin.
</p>
<p>
  In fact this 2d visualization is a simplification even of the incorrect Bohr model in
  which electrons really orbit in 3d around the nucleus. Yet this animation gives an
  intuitive understanding of how electrons are placed into shells and how electron
  energies decrease with increasing shell number. To be precise, the radius of electron
  orbitals increases with the square of the shell number (shown here as linear due to page
  width constraints). Meanwhile, the 'kinetic energy' of the electrons decreases linearly
  with shell number. The orbital period T is proportional Z^2 / n^3, where Z is the atomic
  number. Shown here is sqrt(T) / Z (the the root of the period scaled by atomic number)
  as else inner-shell electrons of large atoms would be invisibly fast.
</p>

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
