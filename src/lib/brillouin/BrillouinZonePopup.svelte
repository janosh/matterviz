<script lang="ts">
  import type { BrillouinZoneOptions } from './index'
  // Small floating Brillouin zone that marks one or more symmetry points on the k-path; Bands
  // opens it when a symmetry-point tick label is clicked. Same FloatingPopup shell as the
  // convex hull's StructurePopup.
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { Matrix3x3 } from '#lib/math.js'
  import { FloatingPopup } from '#lib/overlays/index.js'
  import { KCoords } from '#lib/tooltip/index.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import BrillouinZone from './BrillouinZone.svelte'
  import { BZ_POPUP_DEFAULT_WIDTH } from './types'
  import type { BZPopupPoint, KPathData } from './types'

  let {
    k_lattice,
    points,
    k_path,
    width = BZ_POPUP_DEFAULT_WIDTH,
    height = 240,
    bz_props = {},
    ...rest
  }: Omit<ComponentProps<typeof FloatingPopup>, `children`> & {
    // Reciprocal lattice (rows b_i, 2π included) the zone is built from; the band data's own
    // (BaseBandStructure.recip_lattice) suffices, no crystal structure needed
    k_lattice: Matrix3x3
    points: BZPopupPoint[]
    // Full k-path (Cartesian) so the marked point is seen in context; see BrillouinZone
    k_path?: KPathData
    width?: number
    height?: number
    bz_props?: Omit<BrillouinZoneOptions, `show_controls` | `fullscreen_toggle`>
  } = $props()
</script>

{#snippet popup_body({ close_button }: { close_button: Snippet })}
  <div class="bz-popup-body">
    <!-- the first zone only, unless bz_props asks otherwise; a singular lattice (parsers
    only check the entries are finite) shows its error where the zone would be -->
    <BrillouinZone
      {...bz_props}
      {k_lattice}
      {k_path}
      highlighted_k_points={points.map(({ position }) => position)}
      show_controls={false}
      fullscreen_toggle={false}
      allow_file_drop={false}
      style="--bz-width: {width}px; --bz-height: {height}px; --bz-min-width: 0; {bz_props.style ??
        ``}"
    >
      <div class="bz-popup-close">{@render close_button()}</div>
    </BrillouinZone>
    <!-- below the canvas so the coordinates never cover the marked point; unkeyed since a
    discontinuity like K|U lists two points and callers may repeat labels -->
    <div class="bz-popup-stats" style:--pin-color={HIGHLIGHT.pin}>
      {#each points as { label, frac_coords, position }}
        <strong>{label}</strong>
        <div><KCoords cartesian={position} fractional={frac_coords} /></div>
      {/each}
    </div>
  </div>
{/snippet}

<FloatingPopup {...rest} class={[`bz-popup`, rest.class]} children={popup_body} />

<style>
  .bz-popup-body {
    display: flex;
    flex-direction: column;
  }
  .bz-popup-stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 8px;
    padding: 6px 10px;
    font-size: 0.85em;
    border-top: 1px solid var(--popup-border, var(--menu-border));
    strong {
      color: var(--pin-color);
    }
  }
  .bz-popup-close {
    position: absolute;
    top: 1ex;
    right: 1ex;
    z-index: 1;
  }
</style>
