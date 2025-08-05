<script lang="ts">
  import { CompositionDemo } from '$site'
</script>

<h1>Chemical Composition</h1>
<p>Interactive visualizations for chemical compositions using SVG charts.</p>

<CompositionDemo show_grid />

<h2>Dynamic User Input</h2>
<CompositionDemo show_interactive />

<style>
  h2:not(:first-of-type) {
    margin: 2em 0 1ex;
  }
  p {
    color: var(--text-color-muted);
    text-align: center;
  }
</style>
