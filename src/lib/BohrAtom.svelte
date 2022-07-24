<script lang="ts">
  export let label = ``
  export let size = 270
  export let nucleus_x = size / 2
  export let nucleus_y = size / 2
  export let shells: number[]
  export let shell_width = 15
  export let base_fill = `white`
  // set properties like size, fill, stroke, stroke-width, for nucleus and electrons here
  export let nucleus_props: Record<string, string | number> = {}
  export let shell_props: Record<string, string | number> = {}
  export let electron_props: Record<string, string | number> = {}

  $: _nucleus_props = {
    r: 20,
    fill: `white`,
    'fill-opacity': `0.3`,
    ...nucleus_props,
  }
  $: _shell_props = {
    stroke: `white`,
    'stroke-width': 1,
    fill: `none`,
    ...shell_props,
  }
  $: _electron_props = {
    r: 3,
    stroke: `white`,
    'stroke-width': 1,
    fill: `blue`,
    ...electron_props,
  }
</script>

<svg width={size} height={size} fill={base_fill}>
  <!-- nucleus -->
  <circle cx={nucleus_x} cy={nucleus_y} {..._nucleus_props} />
  {#if label}
    <text x={nucleus_x} y={nucleus_y}>{label}</text>
  {/if}

  <!-- electron shells -->
  {#each shells as n_electrons, shell_idx}
    {@const shell_radius = _nucleus_props.r + (shell_idx + 1) * shell_width}
    <circle cx={nucleus_x} cy={nucleus_y} r={shell_radius} {..._shell_props} />

    <!-- electrons -->
    {#each [...Array(n_electrons).keys()] as elec_idx}
      {@const elec_x =
        nucleus_x + Math.cos((2 * Math.PI * elec_idx) / n_electrons) * shell_radius}
      {@const elec_y =
        nucleus_y + Math.sin((2 * Math.PI * elec_idx) / n_electrons) * shell_radius}
      <circle cx={elec_x} cy={elec_y} {..._electron_props}>
        <title>Electron {elec_idx + 1}</title>
      </circle>
    {/each}
  {/each}
</svg>

<style>
  text {
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
