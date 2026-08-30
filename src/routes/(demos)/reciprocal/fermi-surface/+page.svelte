<script lang="ts">
  import { FermiSurfaceDemo } from '$site'
</script>

<svelte:head>
  <title>Fermi Surface | Matterviz</title>
</svelte:head>

<h1>Fermi Surface</h1>

<p class="demo-intro">
  Load <code>BXSF</code>
  (<a href="http://www.xcrysden.org/" target="_blank" rel="noopener">XCrySDen</a>/<a
    href="https://www.quantum-espresso.org/"
    target="_blank"
    rel="noopener">Quantum ESPRESSO</a
  >), <code>FRMSF</code> from
  <a href="https://mitsuaki1987.github.io/fermisurfer/" target="_blank" rel="noopener"
    >FermiSurfer</a
  >, or
  <a href="https://github.com/fermisurfaces/IFermi">IFermi</a> JSON by dropping it onto the viewer.
</p>

<div class="bleed-1400">
  <FermiSurfaceDemo show_slice sync_url />
</div>
