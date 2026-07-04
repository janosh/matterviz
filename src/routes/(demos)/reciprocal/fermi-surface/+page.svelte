<script lang="ts">
  import { FermiSurfaceDemo } from '$site'
</script>

<svelte:head>
  <title>Fermi Surface | Matterviz</title>
</svelte:head>

<h1>Fermi Surface</h1>

<p class="intro">
  Interactive 3D visualization of Fermi surfaces extracted from electronic band structure data.
  Supports <code>BXSF</code>
  (<a href="http://www.xcrysden.org/" target="_blank" rel="noopener">XCrySDen</a>/<a
    href="https://www.quantum-espresso.org/"
    target="_blank"
    rel="noopener">Quantum ESPRESSO</a
  >), <code>FRMSF</code>
  (<a href="https://mitsuaki1987.github.io/fermisurfer/" target="_blank" rel="noopener"
    >FermiSurfer</a
  >), and <a href="https://github.com/fermisurfaces/IFermi">IFermi</a>'s JSON format. Drag and
  drop files onto the viewer to load them.
</p>

<FermiSurfaceDemo show_slice sync_url />

<section style="padding: 1em">
  <h2 style="margin: 0 0 0.5rem; font-size: 1.1rem">Features</h2>
  <ul
    style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.4rem 1.5rem; margin: 0; padding: 0; list-style: none; font-size: 0.9rem"
  >
    <li>
      <strong>🔷 BXSF</strong> &ndash; <a href="http://www.xcrysden.org/">XCrySDen</a>/<a
        href="https://www.quantum-espresso.org/">Quantum ESPRESSO</a
      > files
    </li>
    <li>
      <strong>🔶 FRMSF</strong> &ndash;
      <a href="https://mitsuaki1987.github.io/fermisurfer/">FermiSurfer</a> format
    </li>
    <li><strong>🎨 Property Coloring</strong> &ndash; band, velocity, or spin</li>
    <li><strong>✂️ Slicing</strong> &ndash; 2D cross-sections along any plane</li>
    <li><strong>🔬 Brillouin Zone</strong> &ndash; 1st BZ overlay with axes</li>
    <li><strong>📊 Real-time</strong> &ndash; adjust μ and see changes instantly</li>
    <li>
      <strong>💬 Hover Tooltips</strong> &ndash; k-coordinates in Cartesian &amp; fractional
    </li>
  </ul>
</section>

<style>
  section {
    background: var(--surface-bg);
    border-radius: 6px;
    position: relative;
    margin-block: 1.5rem;
  }
</style>
