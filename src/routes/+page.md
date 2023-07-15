<script>
  import { Structure } from '$lib'
  import { structures } from '$site'
  import TableDemo from './(demos)/periodic-table/+page.svelte'

  let mp_id = `mp-756175`
  $: structure = structures.find((struct) => struct.id === mp_id)
</script>

# Elementari

`elementari` is a toolkit for building interactive web UIs for materials science: periodic tables, 3d crystal structures (molecules coming soon!), Bohr atoms, nuclei, heatmaps, scatter plots. It's under active development and not yet ready for production use but we appreciate any feedback from beta testers! 🙏

Check out some of the examples in the navigation bar above.

Care was taken to make this interactive periodic table responsive to different screen sizes, automatically adjusting font size and what data to show or hide based on available space.

## Periodic Table

<TableDemo />

## Structure Viewer

The 3d structure viewer is built on the declarative Svelte [THREE.js](https://threejs.org) wrapper [`threlte`](https://threlte.xyz). It gets Svelte-compiled for great performance (even on supercells with 100+ atoms), is split up into `Bond`, `Lattice`, `Scene` and `Site` components for easy extensibility. You can pass various click, drag and touch event handlers for rich interactivity as well as inject custom HTML into tooltips using child components. This one shows the [Materials Project](https://materialsproject.org) structure for [{mp_id}](https://materialsproject.org/materials/{mp_id}).

<Structure {structure} auto_rotate={0.5} />

<style>
  h1 {
    text-align: center;
    font-size: clamp(20pt, 5.5vw, 42pt);
  }
  h2 {
    text-align: center;
  }
  p {
    max-width: 40em;
    margin: 2em auto 3em;
    text-align: center;
  }
</style>
