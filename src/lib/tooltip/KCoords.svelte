<script lang="ts">
  // Shared k-point coordinate rows for hover tooltips (Brillouin zone + Fermi surface)
  import { format_vec3 } from '#lib/labels.js'
  import type { Vec3 } from '#lib/math.js'

  let {
    cartesian,
    fractional = null,
  }: {
    cartesian: Vec3
    fractional?: Vec3 | null
  } = $props()
</script>

<div class="k-coord-row">
  <span class="k-coord-label"><span class="vec">k</span>:</span>
  <span>{format_vec3(cartesian)} <small>Å<sup>−1</sup></small></span>
</div>
{#if fractional}
  <div class="k-coord-row">
    <span class="k-coord-label"><span class="vec">k</span> (frac):</span>
    <span>{format_vec3(fractional)}</span>
  </div>
{/if}

<style>
  .k-coord-row {
    display: flex;
    gap: 4px;
  }
  .k-coord-label {
    opacity: 0.8;
    min-width: 50px;
  }
  /* a <sup>, not the ⁻¹ glyphs: fonts place the superscript minus lower than the 1 */
  sup {
    line-height: 0;
  }
  .vec {
    position: relative;
    font-style: italic;
  }
  .vec::after {
    content: '→';
    position: absolute;
    left: 50%;
    top: -0.62em; /* in the arrow's 0.6em: just clear of the k's ascender */
    transform: translateX(-50%);
    font-size: 0.6em;
    font-style: normal;
  }
</style>
