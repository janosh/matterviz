<script lang="ts">
  // One <pattern> per distinct hatch/texture fill among a chart's marks, for its <defs>.
  // Takes the raw per-mark list (holes allowed) and dedupes by id, so marks sharing a
  // pattern+color share one tile. Marks reference tiles via ResolvedPattern.url; see
  // $lib/plot/core/patterns for how tiles are derived.
  import type { ResolvedPattern } from '$lib/plot/core/patterns'
  import { unique_patterns } from '$lib/plot/core/patterns'

  let { patterns }: { patterns: Iterable<ResolvedPattern | null | undefined> } = $props()

  let defs = $derived(unique_patterns(patterns))
</script>

{#each defs as pat (pat.id)}
  <pattern
    id={pat.id}
    patternUnits="userSpaceOnUse"
    width={pat.width}
    height={pat.height}
    patternTransform={pat.transform}
  >
    {#if pat.bg}
      <rect width={pat.width} height={pat.height} fill={pat.bg} />
    {/if}
    <path
      d={pat.d}
      fill={pat.stroked ? `none` : pat.fg}
      stroke={pat.stroked ? pat.fg : `none`}
      stroke-width={pat.stroked ? pat.line_width : undefined}
      stroke-dasharray={pat.dasharray}
      stroke-linecap={pat.linecap}
      opacity={pat.fg_opacity}
    />
  </pattern>
{/each}
