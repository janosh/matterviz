<script lang="ts">
  import Dos from '#lib/spectral/Dos.svelte'
  import type { PhononDos } from '#lib/spectral/types.js'
  import { mock_dos } from '#site/spectral-mocks.js'
  import TestSection from '../TestSection.svelte'

  const dos2: PhononDos = {
    ...mock_dos,
    densities: [0.0, 0.5, 1.0, 1.5, 1.0, 0.5, 0.2, 0.1, 0.0],
  }
</script>

<h1>Dos test page</h1>

<TestSection title="Single DOS">
  <Dos doses={{ '': mock_dos }} data-testid="dos-single" />
</TestSection>

<TestSection title="Multiple DOS">
  <Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} data-testid="dos-multiple" />
</TestSection>

<TestSection title="Max normalization">
  <Dos doses={{ '': mock_dos }} normalize="max" data-testid="dos-max-norm" />
</TestSection>

<TestSection title="Stacked DOS">
  <Dos doses={{ DOS1: mock_dos, DOS2: dos2 }} stack data-testid="dos-stacked" />
</TestSection>

<TestSection title="Gaussian smearing (sigma=0.2)">
  <Dos doses={{ '': mock_dos }} sigma={0.2} data-testid="dos-smeared" />
</TestSection>

<TestSection title="Horizontal orientation">
  <Dos doses={{ '': mock_dos }} orientation="horizontal" data-testid="dos-horizontal" />
</TestSection>

<TestSection title="No legend (multiple DOS)">
  <Dos
    doses={{ DOS1: mock_dos, DOS2: dos2 }}
    show_legend={false}
    data-testid="dos-no-legend"
  />
</TestSection>
