<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'

  const subpages: {
    href: string
    title: string
    description: string
    icon: IconName
  }[] = [
    {
      href: `/reciprocal/brillouin-zone`,
      title: `Brillouin Zone`,
      description:
        `Interactive 3D first Brillouin zone with high-symmetry points, k-path labels, and slice planes.`,
      icon: `BrillouinZone`,
    },
    {
      href: `/reciprocal/bands`,
      title: `Band Structure`,
      description:
        `Electronic band structure plot with branch handling, Fermi level, and high-symmetry k-point labels.`,
      icon: `BandStructure`,
    },
    {
      href: `/reciprocal/dos`,
      title: `Density of States`,
      description:
        `DOS plot with orbital projections, element-resolved coloring, and Fermi level indicator.`,
      icon: `DensityOfStates`,
    },
    {
      href: `/reciprocal/bands-and-dos`,
      title: `Bands + DOS`,
      description:
        `Side-by-side band structure and density of states with synchronized energy axis.`,
      icon: `BandsDOS`,
    },
    {
      href: `/reciprocal/brillouin-bands-dos`,
      title: `Brillouin + Bands + DOS`,
      description:
        `Combined 3D Brillouin zone, band structure, and DOS in a synchronized three-panel layout.`,
      icon: `ThreePanels`,
    },
    {
      href: `/reciprocal/fermi-surface`,
      title: `Fermi Surface`,
      description:
        `3D Fermi surface visualization with isosurface extraction, Brillouin zone overlay, and spin channels.`,
      icon: `FermiSurface`,
    },
  ]
</script>

<h1>Reciprocal Space</h1>
<p class="subtitle">
  Brillouin zones, electronic band structures, density of states, and Fermi surfaces.
</p>

<nav class="grid">
  {#each subpages as { href, title, description, icon } (href)}
    <a {href} class="card">
      <Icon {icon} class="icon" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </a>
  {/each}
</nav>

<style>
  h1 {
    text-align: center;
    margin-bottom: 0.3em;
  }
  .subtitle {
    text-align: center;
    color: var(--text-color-muted);
    margin: 0 auto 2em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.2em;
    max-width: 1100px;
    margin: 0 auto;
    padding: 0;
  }
  .card {
    display: flex;
    gap: 1em;
    align-items: flex-start;
    padding: 1.2em 1.4em;
    border-radius: var(--border-radius, 5pt);
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
    &:hover {
      border-color: color-mix(in srgb, currentColor 35%, transparent);
      box-shadow: 0 2px 12px color-mix(in srgb, currentColor 8%, transparent);
    }
    &:hover :global(.icon) {
      opacity: 1;
    }
    h2 {
      margin: 0 0 0.4em;
      font-size: 1.1em;
    }
    p {
      margin: 0;
      font-size: 0.88em;
      color: var(--text-color-muted);
      line-height: 1.5;
    }
  }
  .card :global(.icon) {
    width: 2em;
    height: 2em;
    flex-shrink: 0;
    margin-top: 0.1em;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
</style>
