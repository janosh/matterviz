<script>
  import img_sources from '$static/img-sources.json';
  import { dev } from '$app/environment'
  import { homepage } from '$root/package.json'
</script>

<main>

# 🙏 &thinsp; Acknowledgements

- Element properties in `src/lib/element-data.ts` were combined from [`Bowserinator/Periodic-Table-JSON`](https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json) under Creative Commons license and [`robertwb/Periodic Table of Elements.csv`](https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952) (unlicensed).
- Thanks to [Images of Elements](https://images-of-elements.com) for providing photos of elemental crystals and glowing excited gases.
- Thanks to [@kadinzhang](https://github.com/kadinzhang) and their [Periodicity project](https://ptable.netlify.app) [[code](https://github.com/kadinzhang/Periodicity)] for the idea to display animated Bohr model atoms and inset a scatter plot into the periodic table to visualize the periodic nature of elemental properties.
- Thanks to [@ixxie](https://github.com/ixxie) ([shenhav.fyi](https://shenhav.fyi)) for a lot of great suggestions, UX ideas, helping me learn [`threlte`](https://threlte.xyz) and contributing the [`Bond.svelte`](https://github.com/janosh/elementari/blob/-/src/lib/structure/Bond.svelte) component.

This project would not have been possible as a one-person side project without many fine open-source projects. 🙏 To name just a few:

|           3D graphics           |               2D graphics                |                     Docs                     |               Bundler               |               Testing                |
| :-----------------------------: | :--------------------------------------: | :------------------------------------------: | :---------------------------------: | :----------------------------------: |
| [three.js](https://threejs.org) |          [d3](https://d3js.org)          |         [mdsvex](https://mdsvex.com)         |     [vite](https://vitejs.dev)      | [playwright](https://playwright.dev) |
| [threlte](https://threlte.xyz)  | [sharp](https://sharp.pixelplumbing.com) | [rehype](https://github.com/rehypejs/rehype) | [sveltekit](https://kit.svelte.dev) |     [vitest](https://vitest.dev)     |

Note that the last two cells are empty because there were only 8 items in the list. In markdown tables, if you have less items in a row than there are columns, the remaining cells will just be empty.

## Element Images

Big thanks to the element image providers listed below. Each image caption links back to the source website. See [`fetch-elem-images.ts`](https://github.com/janosh/elementari/blob/-/src/fetch-elem-images.ts) for details.

  <ul class="elem-img">
    {#each Object.entries(img_sources) as [key, href]}
      {@const [number, name] = key.split(`-`)}
      <li>
        <a href="/{name}">
          <img src="{dev ? '' : homepage}/elements/{key}.avif" alt={name} /></a>
        <a {href}>{number} {name}</a>
      </li>
    {/each}
  </ul>
</main>

<style>
  h1 {
    text-align: center;
    margin: 2em;
  }
  ul:first-of-type > li {
    margin: 1em 0;
  }
  ul.elem-img {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9em, 1fr));
    gap: 1em;
    list-style: none;
    padding: 0;
  }
  ul.elem-img > li {
    text-transform: capitalize;
    text-align: center;
  }
  ul.elem-img > li > a > img {
    width: 100%;
    border-radius: 3pt;
  }
</style>
