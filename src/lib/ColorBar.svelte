<script lang="ts">
  import * as d3sc from 'd3-scale-chromatic'

  export let text: string = ``
  export let color_scale: ((x: number) => string) | null = null
  export let text_side: 'left' | 'right' | 'top' | 'bottom' = `left`
  export let style: string | null = null
  export let text_style: string | null = null
  export let wrapper_style: string | null = null

  $: if (color_scale === null) {
    color_scale = d3sc[`interpolate${text}`]
    if (color_scale === undefined) console.error(`Color scale not found: ${text}`)
  }

  $: ramped = [...Array(10).keys()].map((idx) => color_scale?.(idx / 10))
  $: flex_dir = {
    left: `row`,
    right: `row-reverse`,
    top: `column`,
    bottom: `column-reverse`,
  }[text_side]
</script>

<div style:flex-direction={flex_dir} style={wrapper_style}>
  {#if text}<span style={text_style}>{text}</span>{/if}
  <div style:background="linear-gradient(to right, {ramped})" {style} />
</div>

<style>
  div {
    display: flex;
    gap: 5pt;
    width: max-content;
  }
  div > div {
    border-radius: 2pt;
    height: 1em;
    width: 10em;
  }
</style>
