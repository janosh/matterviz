<script lang="ts">
  // Shared k-point coordinate rows for hover tooltips (Brillouin zone + Fermi surface)
  import { format_vec3 } from '$lib/labels'
  import type { Vec3 } from '$lib/math'

  let {
    cartesian,
    fractional = null,
  }: {
    cartesian: Vec3
    fractional?: Vec3 | null
  } = $props()
</script>

<div class="k-coord-row">
  <span class="k-coord-label"><span class="vec">k</span> (Å⁻¹):</span>
  <span>{format_vec3(cartesian)}</span>
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
  .vec {
    position: relative;
    font-style: italic;
  }
  .vec::after {
    content: '→';
    position: absolute;
    left: 50%;
    top: -0.85em;
    transform: translateX(-50%);
    font-size: 0.6em;
    font-style: normal;
  }
</style>
