# Equation of State

`fit_eos(volumes, energies, kind)` fits the four parameters E<sub>0</sub>, V<sub>0</sub>, B<sub>0</sub>, B<sub>0</sub>' of a Birch–Murnaghan, Murnaghan or Vinet equation of state to an energy–volume scan (Levenberg–Marquardt, seeded from a parabola through the data). `EosPlot` does the fit and draws the data points, the fitted curve(s) and the parameters in one go. The forms and their parameterization are identical to `pymatgen.analysis.eos`, so fits agree with pymatgen to better than 1e-7 (relative) in E<sub>0</sub>/V<sub>0</sub> and 1e-5 in B<sub>0</sub>/B<sub>0</sub>'.

## Fitting a Scan

A simulated 9-point scan of fcc Cu (±12 % around equilibrium, ~1 meV noise). Toggle the forms with the buttons: near V<sub>0</sub> all three agree to second order, so the fitted parameters barely move, while the curves separate visibly once extrapolated:

```svelte example
<script lang="ts">
  import { EOS_KIND_LABELS, EOS_KINDS, EosPlot, format_num } from 'matterviz'
  import type { EosFit, EosKind } from 'matterviz'

  const volumes = [10.384, 10.738, 11.092, 11.446, 11.8, 12.154, 12.508, 12.862, 13.216]
  const energies = [
    -3.60480992, -3.65001692, -3.67844077, -3.69497369, -3.70053567, -3.69525616, -3.68211321,
    -3.66370053, -3.64106684,
  ]

  let kinds = $state<EosKind[]>([`birch_murnaghan`])
  let fits = $state<EosFit[]>([])
  const toggle = (kind: EosKind) => {
    kinds = kinds.includes(kind) ? kinds.filter((val) => val !== kind) : [...kinds, kind]
  }
</script>

<div style="display: flex; gap: 1ex; margin-bottom: 1ex">
  {#each EOS_KINDS as kind (kind)}
    <button class:active={kinds.includes(kind)} onclick={() => toggle(kind)}>
      {EOS_KIND_LABELS[kind]}
    </button>
  {/each}
</div>

<EosPlot {volumes} {energies} {kinds} bind:fits />

{#if fits.length > 0}
  <p style="text-align: center">
    {fits
      .map((fit) => `${EOS_KIND_LABELS[fit.kind]}: V₀ = ${format_num(fit.v0, `.3f`)} Å³`)
      .join(` · `)}
  </p>
{/if}

<style>
  button.active {
    background: var(--accent-color, #4e79a7);
    color: white;
  }
</style>
```

## Sparse or Noisy Data

`fit_eos` needs at least four volumes that bracket the energy minimum (a scan entirely on one side of V<sub>0</sub> is refused, as in pymatgen); the ASE equation-of-state tutorial's five-point fcc Ag scan is enough. Its two central points share the lowest energy (to the 10 meV the tutorial quotes), so the minimum is located only by the curvature of their neighbours. Beyond the fit itself, `eos_pressure(kind, fit, volume)` gives P(V) = −dE/dV in eV/Å³ (× `EV_PER_A3_TO_GPA` for GPa):

```svelte example
<script lang="ts">
  import { EosPlot, EV_PER_A3_TO_GPA, eos_pressure, format_num } from 'matterviz'
  import type { EosFit } from 'matterviz'

  const volumes = [13.72, 14.83, 16.0, 17.23, 18.52]
  const energies = [-56.29, -56.41, -56.46, -56.46, -56.42]
  let fits = $state<EosFit[]>([])
  const pressures = $derived(
    fits.length > 0
      ? volumes.map((vol) => eos_pressure(fits[0].kind, fits[0], vol) * EV_PER_A3_TO_GPA)
      : [],
  )
</script>

<EosPlot {volumes} {energies} bind:fits data_label="fcc Ag (ASE tutorial)" />

{#if pressures.length > 0}
  <table style="margin: 1em auto">
    <thead><tr><th>V (Å³)</th><th>E (eV)</th><th>P (GPa)</th></tr></thead>
    <tbody>
      {#each volumes as vol, idx (vol)}
        <tr>
          <td>{format_num(vol, `.2f`)}</td>
          <td>{format_num(energies[idx], `.2f`)}</td>
          <td>{format_num(pressures[idx], `.1f`)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
```
