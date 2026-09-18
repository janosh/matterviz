<script module lang="ts">
  import { interpolateInferno } from 'd3-scale-chromatic'

  const inferno_gradient = `linear-gradient(90deg, ${Array.from({ length: 256 }, (_, idx) => `${interpolateInferno(idx / 256)} ${(idx / 256) * 100}% ${((idx + 1) / 256) * 100}%`).join(`, `)})`
</script>

<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { HotspotCloudSettings, HotspotScale } from './hotspot-colors'

  let {
    scale,
    mean,
    show_atoms,
    cloud,
    locked = false,
  }: {
    scale: HotspotScale
    mean: number
    show_atoms: boolean
    cloud: HotspotCloudSettings
    locked?: boolean
  } = $props()
</script>

{#snippet ramp(label: string, lower: number, upper: number, background: string)}
  <span>{label}</span>
  <div class="ramp" style:background></div>
  <div class="endpoints">
    {#each [lower, upper] as value}<span
        >{format_num(value, `.3~g`)} <small>{scale.unit}</small></span
      >{/each}
  </div>
{/snippet}

<div class="thermal-legend" aria-label="Thermal color legend">
  <strong
    >Bin-average {scale.metric === `energy` ? `kinetic energy` : `kinetic temperature`}</strong
  >
  {#if locked}<small>Ranges locked</small>{/if}
  {#if show_atoms}
    {@render ramp(`Atoms · Inferno`, 0, scale.atom_max, inferno_gradient)}
  {/if}
  {#if cloud.visible}
    {@render ramp(
      `Cloud · base → hotspot`,
      scale.cloud_min,
      scale.cloud_max,
      `linear-gradient(90deg in srgb-linear, ${cloud.base_color}, ${cloud.hot_color})`,
    )}
  {/if}
  <div>
    {#if Number.isFinite(mean)}
      Mean {format_num(mean, `.3~g`)} <small>{scale.unit}</small> · Threshold {format_num(
        scale.threshold,
        `.3~g`,
      )} <small>{scale.unit}</small>
    {:else}
      Mean and threshold unavailable
    {/if}
  </div>
  <small>Colors clamp at endpoints. Unavailable bins keep element colors.</small>
</div>

<style>
  .thermal-legend {
    display: grid;
    gap: 0.25em;
    font-size: 0.8em;
    line-height: 1.3;
    .ramp {
      height: 0.7em;
      border-radius: 2px;
    }
    .endpoints {
      display: flex;
      justify-content: space-between;
      gap: 1em;
    }
  }
</style>
