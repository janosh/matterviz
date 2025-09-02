<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<SVGSVGElement> {
    // https://svelte.dev/repl/17d71b590f554b5a9eba6e04023dd41c
    symbol?: string // usually H, He, etc. but can be anything
    name?: string // usually Hydrogen, Helium, etc. but can be anything
    shells: number[]
    adapt_size?: boolean
    shell_width?: number // TODO SVG is fixed so increasing this will make large atoms overflow
    size?: number
    base_fill?: string
    orbital_period?: number // time for inner-most electron orbit in seconds, 0 for no motion
    // set properties like size, fill, stroke, stroke-width, for nucleus and electrons here
    nucleus_props?: Record<string, string | number>
    shell_props?: Record<string, string | number>
    electron_props?: Record<string, string | number>
    highlight_shell?: number | null
    // if function, it'll be called with electron index and should return a string
    number_electrons?:
      | boolean
      | `hierarchical`
      | `sequential`
      | ((idx: number) => string)
    electron_label_props?: Record<string, string | number>
  }
  let {
    symbol = ``,
    name = ``,
    shells,
    adapt_size = false,
    shell_width = 20,
    size = adapt_size ? (shells.length + 1) * 2 * shell_width + 50 : 270,
    base_fill = `var(--text-color)`,
    orbital_period = 3,
    nucleus_props = {},
    shell_props = {},
    electron_props = {},
    highlight_shell = null,
    number_electrons = false,
    electron_label_props = {},
    ...rest
  }: Props = $props()

  // Bohr atom electron orbital period is given by
  // T = (n^3 h^3) / (4pi^2 m K e^4 Z^2) = 1.52 * 10^-16 * n^3 / Z^2 s
  // with n the shell number, Z the atomic number, m the mass of the electron
  let _nucleus_props = $derived({
    r: 20,
    fill: base_fill,
    'fill-opacity': `0.3`,
    ...nucleus_props,
  })
  let _shell_props = $derived({
    stroke: base_fill,
    'stroke-width': 1,
    fill: `none`,
    ...shell_props,
  })
  let _electron_props = $derived({
    r: 3,
    stroke: base_fill,
    'stroke-width': 1,
    fill: `blue`,
    ...electron_props,
  })
  let viewBox = $derived(`-${size / 2}, -${size / 2}, ${size}, ${size}`)
</script>

<svg fill={base_fill} {viewBox} role="presentation" {...rest}>
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
  {#each shells as electrons, shell_idx ([electrons, shell_idx])}
    {@const n = shell_idx + 1}
    {@const shell_radius = _nucleus_props.r + n * shell_width}
    {@const active = n === highlight_shell}
    <g class="shell" style:animation-duration="{orbital_period * n ** 1.5}s">
      <circle
        r={shell_radius}
        {..._shell_props}
        style:stroke-width={active ? 2 : 1}
        style:stroke={active ? `yellow` : base_fill}
      />

      <!-- electrons -->
      {#each Array(electrons) as _, elec_idx (elec_idx)}
        {@const elec_x = Math.cos((2 * Math.PI * elec_idx) / electrons) * shell_radius}
        {@const elec_y = Math.sin((2 * Math.PI * elec_idx) / electrons) * shell_radius}
        <circle class="electron" cx={elec_x} cy={elec_y} {..._electron_props}>
          <title>Electron {elec_idx + 1}</title>
        </circle>
        {#if number_electrons}
          <text
            x={elec_x}
            y={elec_y}
            {...electron_label_props}
            transform="rotate({(elec_idx * 360) / electrons} {elec_x} {elec_y})"
          >
            {#if typeof number_electrons === `function`}
              {number_electrons(elec_idx)}
            {:else if number_electrons === `hierarchical`}
              {shell_idx + 1}.{elec_idx + 1}
              <!-- {:else if [`sequential`, true].includes(number_electrons)} -->
            {:else}
              {@const nth_electron = shells.slice(0, shell_idx).reduce((a, b) => a + b, 0) +
          elec_idx + 1}
              {nth_electron}
            {/if}
          </text>
        {/if}
      {/each}
    </g>
  {/each}
</svg>

<style>
  svg {
    overflow: visible;
    width: 100%;
    border-radius: var(--border-radius);
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
