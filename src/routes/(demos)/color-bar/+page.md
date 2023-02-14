`ColorBar.svelte`

ColorBar supports <code>text_side = ['top', 'bottom', 'left', 'right']</code>

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'
  import * as d3sc from 'd3-scale-chromatic'

  const names = Object.keys(d3sc).filter((key) => key.startsWith(`interpolate`))
</script>

<section>
  {#each [`top`, `bottom`, `left`, `right`] as text_side, idx}
    <ul>
      <code>{text_side}</code>
      {#each names.slice(idx * 5, 5 * idx + 5) as name}
        <li>
          <ColorBar
            text={name.replace(`interpolate`, ``)}
            {text_side}
            text_style="min-width: 5em;"
          />
        </li>
      {/each}
    </ul>
  {/each}
</section>

<style>
  section {
    display: flex;
    overflow: scroll;
    gap: 2em;
  }
  section > ul {
    list-style: none;
    padding: 0;
  }
  section > ul > li {
    padding: 1ex;
  }
  section > ul > code {
    font-size: 16pt;
  }
</style>
```

You can also fat and skinny bars:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  const wrapper_style = 'place-items: center;'
</script>

<ColorBar text="Viridis" {wrapper_style} style="width: 10em; height: 1ex;" />
<br />
<ColorBar text="Viridis" {wrapper_style} style="width: 3em; height: 2em;" />
```
