<script lang="ts">
  import type { TdbParseResult } from './parse'

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
</script>

<div class="tdb-info-panel" {style}>
  <h3>TDB File Parsed</h3>

  {#if result.success && result.data}
    <div class="info-grid">
      <div class="info-item">
        <span class="label">System:</span>
        <span class="value">{
          system_name || result.binary_system?.join(`-`) || `Unknown`
        }</span>
      </div>

      <div class="info-item">
        <span class="label">Elements:</span>
        <span class="value">
          {result.data.elements.map((el) => el.symbol).join(`, `)}
        </span>
      </div>

      <div class="info-item">
        <span class="label">Phases:</span>
        <span class="value phases">
          {#each result.data.phases as phase (phase.name)}
            <span class="phase-tag">{phase.name}</span>
          {/each}
        </span>
      </div>

      <div class="info-item">
        <span class="label">Functions:</span>
        <span class="value">{result.data.functions.length}</span>
      </div>

      <div class="info-item">
        <span class="label">Parameters:</span>
        <span class="value">{result.data.parameters.length}</span>
      </div>

      {#if result.temperature_range}
        <div class="info-item">
          <span class="label">Temp Range:</span>
          <span class="value">
            {result.temperature_range[0]} - {result.temperature_range[1]} K
          </span>
        </div>
      {/if}
    </div>

    {#if has_precomputed}
      <div class="precomputed-notice success">
        <span class="icon">✓</span>
        {#if is_precomputed_loaded}
          <div class="message">
            <span>
              <strong>Phase diagram loaded from pre-computed data</strong>
              ({system_name}.json.gz)
            </span>
            <p class="help-text" style="margin-top: 0.5em; margin-bottom: 0">
              The TDB file above contains thermodynamic model parameters. The displayed
              phase boundaries were computed offline using
              <a href="https://pycalphad.org" target="_blank" rel="noopener noreferrer">
                pycalphad</a> and stored separately.
            </p>
          </div>
        {:else}
          <span>Pre-computed phase diagram available for this system!</span>
          {#if on_load_precomputed}
            <button class="load-btn" onclick={on_load_precomputed}>
              Load Phase Diagram
            </button>
          {/if}
        {/if}
      </div>
    {:else}
      {@const elements = result.data?.elements
      ?.map((el) => el.symbol)
      ?.filter((s) => s !== `VA` && s !== `/-`) ?? []}
      {@const el_a = elements[0] ?? `EL1`}
      {@const el_b = elements[1] ?? `EL2`}
      {@const tdb_filename = system_name || `your_system`}
      <div class="precomputed-notice warning">
        <span class="icon">ℹ</span>
        <div class="message">
          <p>
            No pre-computed phase diagram for this system. TDB files contain thermodynamic
            model parameters that require computation to generate phase boundaries.
          </p>
          <p class="help-text">
            To compute the phase diagram, use <a
              href="https://pycalphad.org"
              target="_blank"
              rel="noopener noreferrer"
            >pycalphad</a>:
          </p>
          <pre>
<code>from pycalphad import Database, binplot
import pycalphad.variables as v

db = Database('{tdb_filename}.tdb')
comps = ['{el_a}', '{el_b}', 'VA']
phases = list(db.phases.keys())

binplot(db, comps, phases, {`{`}
    v.X('{el_b}'): (0, 1, 0.01),
    v.T: (300, 2000, 10),
    v.P: 101325, v.N: 1
})</code></pre>
        </div>
      </div>
    {/if}
  {:else}
    <div class="error">
      <span class="icon">⚠</span>
      <span>Failed to parse TDB file: {result.error}</span>
    </div>
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
    padding: 1em;
  }
  h3 {
    margin: 0 0 0.75em 0;
    font-size: 1.1em;
    color: var(--text-color, #fff);
    border-bottom: 1px solid var(--border-color, #444);
    padding-bottom: 0.5em;
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.5em 1em;
    margin-bottom: 1em;
  }
  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }
  .label {
    font-size: 0.85em;
    color: var(--text-color-muted, #888);
    font-weight: 500;
  }
  .value {
    color: var(--text-color, #fff);
  }
  .value.phases {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25em;
  }
  .phase-tag {
    background: var(--accent-color, #6366f1);
    color: white;
    padding: 0.1em 0.5em;
    border-radius: 4px;
    font-size: 0.85em;
    font-family: monospace;
  }
  .precomputed-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.75em;
    padding: 0.75em;
    border-radius: 6px;
    margin-top: 0.5em;
  }
  .precomputed-notice.success {
    background: rgba(from var(--success-color) r g b / 0.15);
    border: 1px solid rgba(from var(--success-color) r g b / 0.3);
    align-items: center;
  }
  .precomputed-notice.success .icon {
    color: var(--success-color);
    font-size: 1.2em;
  }
  .precomputed-notice.warning {
    background: rgba(from var(--warning-color) r g b / 0.1);
    border: 1px solid rgba(from var(--warning-color) r g b / 0.3);
  }
  .precomputed-notice.warning .icon {
    color: var(--warning-color);
    font-size: 1.2em;
  }
  .message {
    flex: 1;
  }
  .message p {
    margin: 0 0 0.5em 0;
  }
  .help-text {
    font-size: 0.9em;
    color: var(--text-color-muted, #888);
  }
  pre {
    background: rgba(0, 0, 0, 0.3);
    padding: 0.5em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
    margin: 0.5em 0 0 0;
  }
  code {
    font-family: 'Fira Code', 'Monaco', monospace;
  }
  .load-btn {
    background: var(--success-color);
    color: white;
    border: none;
    padding: 0.5em 1em;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    margin-left: auto;
    white-space: nowrap;
  }
  .load-btn:hover {
    background: var(--success-hover);
  }
  .error {
    display: flex;
    align-items: center;
    gap: 0.5em;
    color: var(--error-color);
    background: rgba(from var(--error-color) r g b / 0.1);
    padding: 0.75em;
    border-radius: 6px;
  }
  a {
    color: var(--accent-color, #6366f1);
  }
</style>
