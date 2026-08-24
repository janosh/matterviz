<script lang="ts">
  import { BohrAtom, element_data } from 'matterviz/element'

  let orbital_period = $state(2)
</script>

<h1>Bohr Atoms</h1>

<p>
  This solar-system-like visualization of the elements is known as the Bohr model. It was
  proposed by Niels Bohr in 1913. It should not be viewed as an accurate picture of reality.
  Quantum mechanics has shown that electrons are really unlocalized wave functions still
  centered around the nucleus but with much more complicated shapes determined by their quantum
  numbers n, l, m and s.
</p>

<ul>
  <li>n is the shell number</li>
  <li>l is the orbital angular number</li>
  <li>m is the magnetic moment number</li>
  <li>s is the spin</li>
</ul>

<p>
  In fact this 2d visualization is a simplification even of the incorrect Bohr model in which
  electrons really orbit in 3d around the nucleus. Yet this animation gives an intuitive
  understanding of how electrons are placed into shells and how electron energies decrease with
  increasing shell number. To be precise, the radius of electron orbitals increases with the
  square of the shell number (shown here as linear due to page width constraints). Meanwhile,
  the 'kinetic energy' of the electrons decreases linearly with shell number. The orbital
  period T is proportional Z^2 / n^3, where Z is the atomic number. Shown here is sqrt(T) / Z
  (the root of the period scaled by atomic number) as else inner-shell electrons of large atoms
  would be invisibly fast.
</p>

<label
  style="display: flex; align-items: center; gap: 1ex; margin: 1em auto; place-content: center"
>
  Electron Orbital Period
  <input type="number" bind:value={orbital_period} min={0} max={5} step={0.1} />
  <input type="range" bind:value={orbital_period} min={0} max={5} step={0.1} />
</label>

<ol>
  {#each element_data as { shells, symbol, number, name } (symbol + number + name)}
    <li>
      <strong>
        <a href={name.toLowerCase()}>{number}</a>
      </strong>
      <BohrAtom {shells} {symbol} {name} {orbital_period} --border-radius="1ex" />
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
  /* phones: the largest atoms are ~300px wide, so a single one per row makes a very long
     page; the SVG scales to its <li>, so cap that at two per row */
  @container (max-width: 600px) {
    li {
      width: calc(50% - 2ex);
    }
  }
  strong {
    position: absolute;
    margin: 0;
    background-color: rgba(255, 255, 255, 0.06);
    border-bottom-right-radius: 1ex;
    border-top-left-radius: 1ex;
  }
  /* the atomic number is the only link to the element page; a 2-digit label alone is a
     ~10px target, so the link box is padded out to a finger-sized square */
  strong a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    min-height: 2rem;
    padding: 0 4pt;
  }
  strong a:focus {
    color: orange;
    outline: none;
  }
</style>
