<script lang="ts">
  // Small floating Brillouin zone that marks one or more symmetry points on the k-path; Bands
  // opens it when a symmetry-point tick label is clicked. Same FloatingPopup shell as the
  // convex hull's StructurePopup.
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import { FloatingPopup } from '$lib/overlays'
  import { KCoords } from '$lib/tooltip'
  import { to_error } from '$lib/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import BrillouinZone from './BrillouinZone.svelte'
  import { compute_brillouin_zone } from './compute'
  import { BZ_POPUP_DEFAULT_WIDTH } from './types'
  import type { BZPopupPoint } from './types'

  let {
    k_lattice,
    points,
    k_path_points = [],
    k_path_labels = [],
    width = BZ_POPUP_DEFAULT_WIDTH,
    height = 240,
    bz_props = {},
    popup_div = $bindable(),
    ...rest
  }: Omit<ComponentProps<typeof FloatingPopup>, `children`> & {
    // Reciprocal lattice (rows b_i, 2π included) the zone is built from; the band data's own
    // (BaseBandStructure.recip_lattice) suffices, no crystal structure needed
    k_lattice: Matrix3x3
    points: BZPopupPoint[]
    // Full k-path (Cartesian) so the marked point is seen in context; see BrillouinZone
    k_path_points?: Vec3[]
    k_path_labels?: { position: Vec3; label: string | null }[]
    width?: number
    height?: number
    bz_props?: Partial<ComponentProps<typeof BrillouinZone>>
  } = $props()

  // First zone only: the popup marks a point, it is not the full BrillouinZone viewer. A
  // singular reciprocal lattice (parsers only check the entries are finite) has no zone; the
  // popup then shows the error where the zone would be instead of taking the plot down
  let bz_data = $derived.by(() => {
    try {
      return compute_brillouin_zone(k_lattice)
    } catch (error) {
      return to_error(error)
    }
  })
</script>

{#snippet popup_body({ close_button }: { close_button: Snippet })}
  <div class="bz-popup-body">
    {#if bz_data instanceof Error}
      <p class="bz-popup-error" style="width: {width}px">
        {bz_data.message}
        <span class="bz-popup-close">{@render close_button()}</span>
      </p>
    {:else}
      <BrillouinZone
        {bz_data}
        {k_path_points}
        {k_path_labels}
        highlighted_k_points={points.map(({ position }) => position)}
        show_controls={false}
        fullscreen_toggle={false}
        allow_file_drop={false}
        style="--bz-width: {width}px; --bz-height: {height}px; --bz-min-width: 0"
        {...bz_props}
      >
        <div class="bz-popup-close">{@render close_button()}</div>
      </BrillouinZone>
    {/if}
    <!-- below the canvas so the coordinates never cover the marked point; unkeyed since a
    discontinuity like K|U lists two points and callers may repeat labels -->
    <div class="bz-popup-stats">
      {#each points as { label, frac_coords, position }}
        <strong>{label}</strong>
        <div><KCoords cartesian={position} fractional={frac_coords} /></div>
      {/each}
    </div>
  </div>
{/snippet}

<FloatingPopup
  {...rest}
  class={[`bz-popup`, rest.class]}
  bind:popup_div
  children={popup_body}
/>

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
      color: #ff2020;
    }
  }
  .bz-popup-error {
    position: relative;
    margin: 0;
    padding: 1.5em 2.5em 1em 1em;
    color: var(--error-color, #d33);
    font-size: 0.85em;
  }
  .bz-popup-close {
    position: absolute;
    top: 1ex;
    right: 1ex;
    z-index: 1;
  }
</style>
