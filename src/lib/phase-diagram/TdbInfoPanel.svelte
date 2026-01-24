<script lang="ts">
  import type { TdbParseResult } from './parse'
  import { extract_tdb_reference, summarize_models } from './utils'

  interface Props {
    result: TdbParseResult
    system_name?: string
    has_precomputed?: boolean
    is_precomputed_loaded?: boolean
    on_load_precomputed?: () => void
    style?: string
  }

  let {
    result,
    system_name = ``,
    has_precomputed = false,
    is_precomputed_loaded = false,
    on_load_precomputed,
    style = ``,
  }: Props = $props()

  const reference = $derived(
    result.data ? extract_tdb_reference(result.data.comments) : null,
  )
  const model_summary = $derived(
    result.data ? summarize_models(result.data.phases) : null,
  )
</script>

<div class="tdb-info-panel" {style}>
  <h3>TDB File Parsed</h3>

  {#if result.success && result.data}
    {@const { phases, functions, parameters } = result.data}
    {@const sys = system_name || result.binary_system?.join(`-`) || `Unknown`}
    <dl class="info-grid">
      <dt>System</dt>
      <dd>{sys}</dd>
      <dt>Phases</dt>
      <dd class="phases">{#each phases as { name } (name)}<span>{name}</span>{/each}</dd>
      {#if model_summary}<dt>Models</dt><dd>{model_summary}</dd>{/if}
      <dt>Funcs / Params</dt>
      <dd>{functions.length} / {parameters.length}</dd>
      {#if result.temperature_range}
        {@const [t_min, t_max] = result.temperature_range}
        <dt>T Range</dt><dd>{t_min} – {t_max} K</dd>
      {/if}
      {#if reference}<dt>Ref</dt><dd class="ref" title={reference}>{reference}</dd>{/if}
    </dl>

    {#if has_precomputed}
      <p class="notice success">
        ✓ {#if is_precomputed_loaded}
          <strong>Phase diagram loaded</strong> ({sys}.json)
          <small>TDB contains model parameters. Boundaries computed offline via
            <a href="https://pycalphad.org" target="_blank">pycalphad</a>.</small>
        {:else}
          Pre-computed diagram available!
          {#if on_load_precomputed}
            <button class="load-btn" onclick={on_load_precomputed}>Load</button>
          {/if}
        {/if}
      </p>
    {:else}
      {@const elems = result.data.elements.map((e) => e.symbol).filter((s) =>
      s !== `VA` && s !== `/-`
    )}
      {@const [el_a, el_b] = [elems[0] ?? `EL1`, elems[1] ?? `EL2`]}
      {@const tdb = system_name || `your_system`}
      <div class="notice warning">
        <p>
          ℹ No pre-computed diagram. Use <a href="https://pycalphad.org" target="_blank"
          >pycalphad</a>:
        </p>
        <pre>
<code>from pycalphad import Database, binplot
import pycalphad.variables as v

db = Database('{tdb}.tdb')
binplot(db, ['{el_a}', '{el_b}', 'VA'], list(db.phases.keys()), {`{`}
    v.X('{el_b}'): (0, 1, 0.01), v.T: (300, 2000, 10), v.P: 101325, v.N: 1
})</code></pre>
      </div>
    {/if}
  {:else}
    <p class="error">⚠ Failed to parse TDB file: {result.error}</p>
  {/if}
</div>

<style>
  .tdb-info-panel {
    --success-color: var(--tdb-success-color, #22c55e);
    --success-hover: var(--tdb-success-hover, #16a34a);
    --warning-color: var(--tdb-warning-color, #eab308);
    --error-color: var(--tdb-error-color, #ef4444);
    background: var(--surface-bg, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--border-color, #444);
    border-radius: var(--border-radius, 8px);
    padding: 8pt 9pt;
    font-size: 10pt;
  }
  h3 {
    margin: 0 0 5pt 0;
    font-size: 11pt;
    color: var(--text-color, #fff);
    border-bottom: 1px solid var(--border-color, #444);
    padding-bottom: 4pt;
  }
  .info-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4pt 12pt;
    margin: 0 0 6pt;
    align-items: center;
  }
  dt {
    color: var(--text-color-muted, #888);
    font-weight: 500;
    &::after {
      content: ':';
    }
  }
  dd {
    margin: 0 12pt 0 4pt;
    color: var(--text-color, #fff);

    &.ref {
      max-width: 200pt;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  dd.phases {
    display: flex;
    flex-wrap: wrap;
    gap: 2pt;

    & > span {
      background: var(--accent-color, #6366f1);
      color: white;
      padding: 0 5pt;
      border-radius: 3px;
      font-family: monospace;
    }
  }
  .notice {
    padding: 6pt;
    border-radius: 6px;
    margin: 12pt 0 0;

    &.success {
      background: rgba(from var(--success-color) r g b / 0.15);
      border: 1px solid rgba(from var(--success-color) r g b / 0.3);
    }
    &.warning {
      background: rgba(from var(--warning-color) r g b / 0.1);
      border: 1px solid rgba(from var(--warning-color) r g b / 0.3);
    }
  }
  .notice small {
    display: block;
    margin-top: 4pt;
    font-size: 10pt;
    color: var(--text-color-muted, #888);
  }
  .notice p {
    margin: 0 0 6pt;
  }
  pre {
    background: rgba(0, 0, 0, 0.3);
    padding: 6pt;
    border-radius: 4px;
    overflow-x: auto;
    margin: 6pt 0 0;
  }
  code {
    font-family: 'Fira Code', 'Monaco', monospace;
  }
  .load-btn {
    background: var(--success-color);
    color: white;
    border: none;
    padding: 4pt 10pt;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    margin-left: 8pt;
  }
  .load-btn:hover {
    background: var(--success-hover);
  }
  .error {
    color: var(--error-color);
    background: rgba(from var(--error-color) r g b / 0.1);
    padding: 9pt;
    border-radius: 6px;
    margin: 0;
  }
  a {
    color: var(--accent-color, #6366f1);
  }
</style>
