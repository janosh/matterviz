<script lang="ts">
  import Dos from '$lib/bands/Dos.svelte'
  import type { PhononDos } from '$lib/bands/types'

  const mock_dos: PhononDos = {
    type: `phonon`,
    frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    densities: [0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.5, 0.2, 0.0],
  }

  const dos2: PhononDos = {
    type: `phonon`,
    frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    densities: [0.0, 0.5, 1.0, 1.5, 1.0, 0.5, 0.2, 0.1, 0.0],
  }
</script>

<h1>DOS Component Test Page</h1>

<h2 id="single-dos">Single DOS</h2>
<Dos doses={mock_dos} />

<h2 id="multiple-dos">Multiple DOS</h2>
<Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} />

<h2 id="max-normalization">Max Normalization</h2>
<Dos doses={mock_dos} normalize="max" />

<h2 id="sum-normalization">Sum Normalization</h2>
<Dos doses={mock_dos} normalize="sum" />

<h2 id="stacked-dos">Stacked DOS</h2>
<Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} stack />

<h2 id="gaussian-smearing">Gaussian Smearing (sigma=0.2)</h2>
<Dos doses={mock_dos} sigma={0.2} />

<h2 id="horizontal-dos">Horizontal Orientation</h2>
<Dos doses={mock_dos} orientation="horizontal" />

<h2 id="ev-units">eV Units</h2>
<Dos doses={mock_dos} units="eV" />

<h2 id="mev-units">meV Units</h2>
<Dos doses={mock_dos} units="meV" />

<h2 id="no-legend">No Legend (Multiple DOS)</h2>
<Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} show_legend={false} />

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
</style>
