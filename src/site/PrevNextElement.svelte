<script lang="ts">
  import Icon from '@iconify/svelte'
  import ElementPhoto from '../lib/ElementPhoto.svelte'
  import ElementTile from '../lib/ElementTile.svelte'
  import type { ChemicalElement } from '../lib/types'

  export let prev: ChemicalElement
  export let next: ChemicalElement
  const tile_style = `width: 70px; border-radius: 2pt; position: absolute; bottom: 0;border: none !important;`
  const photo_style = `width: 200px; border-radius: 4pt;`
</script>

<ul data-sveltekit-noscroll>
  <li>
    <a href={prev.name.toLowerCase()}>
      <h3>
        <Icon icon="carbon:previous-filled" inline />
        Previous
      </h3>
      <ElementTile element={prev} style={tile_style} show_name={false} />
      <ElementPhoto element_name={prev.name} style={photo_style} />
    </a>
  </li>
  <li style="text-align: right;">
    <a href={next.name.toLowerCase()}>
      <h3>
        Next
        <Icon icon="carbon:next-filled" inline />
      </h3>
      <ElementTile element={next} style={tile_style} show_name={false} />
      <ElementPhoto element_name={next.name} style={photo_style} />
    </a>
  </li>
</ul>

<style>
  ul {
    display: flex;
    list-style: none;
    padding: 0;
    place-content: space-between;
    gap: 2em;
    max-width: 1200px;
    margin: 5em auto 0;
  }
  ul li {
    display: flex;
    flex-direction: column;
    max-width: 250px;
    position: relative;
  }
  ul li a {
    display: grid;
  }
</style>
