```svelte
<script>
  import { Icon } from 'svelte-widgets'
  import { GitHub, Settings } from 'svelte-widgets/icons'
</script>

<!-- Pass the glyph binding, not its name -->
<Icon icon={GitHub} />

<!-- With custom size -->
<Icon icon={Settings} style="font-size: 2em" />
<Icon icon={Settings} style="--icon-size: 32px" />
```
