<script lang="ts">
  // https://svelte.dev/repl/17d71b590f554b5a9eba6e04023dd41c
  export let symbol: string = `` // usually H, He, etc. but can be anything
  export let name: string = `` // usually Hydrogen, Helium, etc. but can be anything
  export let shells: number[] // e.g. [2, 8, 6] for sulfur
  export let adapt_size = false
  export let shell_width = 15 // TODO SVG is fixed so increasing this will make large atoms overflow
  export let size = adapt_size ? (shells.length + 1) * 2 * shell_width + 50 : 270
  export let base_fill = `white`
  export let orbital_period = 3 // time for inner-most electron orbit in seconds, 0 for no motion
  // set properties like size, fill, stroke, stroke-width, for nucleus and electrons here
  export let nucleus_props: Record<string, string | number> = {}
  export let shell_props: Record<string, string | number> = {}
  export let electron_props: Record<string, string | number> = {}
  export let highlight_shell: number | null = null
  export let style = ``

  // Bohr atom electron orbital period is given by
  // T = (n^3 h^3) / (4pi^2 m K e^4 Z^2) = 1.52 * 10^-16 * n^3 / Z^2 s
  // with n the shell number, Z the atomic number, m the mass of the electron
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

<svg
  fill={base_fill}
  viewBox="-{size / 2}, -{size / 2}, {size}, {size}"
  on:click
  on:keyup
  role="presentation"
  {style}
>
  <!-- nucleus -->
  <circle class="nucleus" {..._nucleus_props}>
    {#if name}
      <title>{name}</title>
    {/if}
  </circle>
  {#if symbol}
    <text>{symbol}</text>
  {/if}

  <!-- electron orbitals -->
  {#each shells as electrons, shell_idx}
    {@const n = shell_idx + 1}
    {@const shell_radius = _nucleus_props.r + n * shell_width}
    {@const active = n === highlight_shell}
    <g class="shell" style:animation-duration="{orbital_period * n ** 1.5}s">
      <circle
        r={shell_radius}
        {..._shell_props}
        style:stroke-width={active ? 2 : 1}
        style:stroke={active ? `yellow` : `white`}
      />

      <!-- electrons -->
      {#each Array(electrons) as _, elec_idx}
        {@const elec_x = Math.cos((2 * Math.PI * elec_idx) / electrons) * shell_radius}
        {@const elec_y = Math.sin((2 * Math.PI * elec_idx) / electrons) * shell_radius}
        <circle class="electron" cx={elec_x} cy={elec_y} {..._electron_props}>
          <title>Electron {elec_idx + 1}</title>
        </circle>
      {/each}
    </g>
  {/each}
</svg>

<style>
  svg {
    overflow: visible;
    width: 100%;
  }
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
