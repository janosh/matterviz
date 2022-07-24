<script lang="ts">
  export let label = ``
  export let name = ``
  export let size = 270
  export let shells: number[]
  export let shell_width = 15
  export let base_fill = `white`
  export let orbiting = true
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

<svg width={size} fill={base_fill} viewBox="-{size / 2}, -{size / 2}, {size}, {size}">
  <!-- nucleus -->
  <circle class="nucleus" {..._nucleus_props}>
    {#if name}
      <title>{name}</title>
    {/if}
  </circle>
  {#if label}
    <text>{label}</text>
  {/if}

  <!-- electron orbitals -->
  {#each shells as n_electrons, shell_idx}
    {@const shell_radius = _nucleus_props.r + (shell_idx + 1) * shell_width}
    <g class="shell" style:animation-duration="{orbiting ? 5 * (shell_idx + 1) : 0}s">
      <circle r={shell_radius} {..._shell_props} />

      <!-- electrons -->
      {#each Array(n_electrons) as _, elec_idx}
        {@const elec_x = Math.cos((2 * Math.PI * elec_idx) / n_electrons) * shell_radius}
        {@const elec_y = Math.sin((2 * Math.PI * elec_idx) / n_electrons) * shell_radius}
        <circle class="electron" cx={elec_x} cy={elec_y} {..._electron_props}>
          <title>Electron {elec_idx + 1}</title>
        </circle>
      {/each}
    </g>
  {/each}
</svg>

<style>
  g.shell {
    animation: spin-right linear infinite;
  }
  text {
    text-anchor: middle;
    dominant-baseline: central;
  }
  @keyframes spin-right {
    100% {
      transform: rotate(360deg);
    }
  }
</style>
