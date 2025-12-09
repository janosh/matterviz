<script lang="ts">
  import Dos from '$lib/spectral/Dos.svelte'
  import type { PhononDos } from '$lib/spectral/types'

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
<div data-testid="dos-single"><Dos doses={mock_dos} /></div>

<h2 id="multiple-dos">Multiple DOS</h2>
<div data-testid="dos-multiple"><Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} /></div>

<h2 id="max-normalization">Max Normalization</h2>
<div data-testid="dos-max-norm"><Dos doses={mock_dos} normalize="max" /></div>

<h2 id="sum-normalization">Sum Normalization</h2>
<div data-testid="dos-sum-norm"><Dos doses={mock_dos} normalize="sum" /></div>

<h2 id="stacked-dos">Stacked DOS</h2>
<div data-testid="dos-stacked"><Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} stack /></div>

<h2 id="gaussian-smearing">Gaussian Smearing (sigma=0.2)</h2>
<div data-testid="dos-smeared"><Dos doses={mock_dos} sigma={0.2} /></div>

<h2 id="horizontal-dos">Horizontal Orientation</h2>
<div data-testid="dos-horizontal"><Dos doses={mock_dos} orientation="horizontal" /></div>

<h2 id="ev-units">eV Units</h2>
<div data-testid="dos-ev"><Dos doses={mock_dos} units="eV" /></div>

<h2 id="mev-units">meV Units</h2>
<div data-testid="dos-mev"><Dos doses={mock_dos} units="meV" /></div>

<h2 id="no-legend">No Legend (Multiple DOS)</h2>
<div data-testid="dos-no-legend">
  <Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} show_legend={false} />
</div>

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
</style>
