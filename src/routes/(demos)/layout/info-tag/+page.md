# InfoTag

A compact, interactive tag for displaying labeled values. Click to copy, supports variants, sizes, icons, and removal.

## All Variants & Sizes

Five semantic variants (default, success, warning, error, info) × three sizes (sm, md, lg):

```svelte example
<script>
  import { Icon, InfoTag } from 'matterviz'

  const sizes = [`sm`, `md`, `lg`]
  const tags = [
    { label: `Band Gap:`, value: `1.12 eV`, variant: `default` },
    { label: ``, value: `Stable`, variant: `success`, icon: `CheckCircle` },
    { label: `⚠️`, value: `Metastable`, variant: `warning` },
    { label: ``, value: `Failed`, variant: `error`, icon: `XCircle` },
    { label: `ℹ️`, value: `MP`, variant: `info` },
  ]
</script>

<div style="display: grid; gap: 12pt">
  {#each sizes as size}
    <div style="display: flex; flex-wrap: wrap; gap: 8pt; align-items: center">
      <span
        style="width: 30px; font-size: 0.75em; opacity: 0.5; text-transform: uppercase"
      >{size}</span>
      {#each tags as tag}
        <InfoTag label={tag.label} value={tag.value} variant={tag.variant} {size}>
          {#if tag.icon}
            <Icon icon={tag.icon} style="width: 1em; height: 1em; margin-left: 2pt" />
          {/if}
        </InfoTag>
      {/each}
    </div>
  {/each}
</div>

<p style="margin-top: 1em; font-size: 0.8em; opacity: 0.6">
  Click any tag to copy its value. Icons via emoji (⚠️ ℹ️) or Icon component slot.
</p>
```

## Interactive Features

Removable tags, custom click handlers, and custom copy values:

```svelte example
<script>
  import { InfoTag } from 'matterviz'

  const init_filters = [
    { id: 1, label: `Element:`, value: `Li`, variant: `info` },
    { id: 2, label: `E<sub>g</sub> >`, value: `1 eV`, variant: `success` },
    { id: 3, label: `Stable:`, value: `Yes`, variant: `success` },
  ]
  let filters = $state([...init_filters])
  let clicked = $state(null)
  let disabled = $state(false)
</script>

<label style="display: flex; gap: 0.5em; margin-bottom: 1em; font-size: 0.9em">
  <input type="checkbox" bind:checked={disabled} /> Disabled
</label>

<div style="display: flex; flex-wrap: wrap; gap: 8pt; margin-bottom: 1em">
  <strong style="font-size: 0.85em; opacity: 0.7; align-self: center">Filters:</strong>
  {#each filters as filter (filter.id)}
    <InfoTag
      {...filter}
      removable
      onremove={() => (filters = filters.filter((x) => x.id !== filter.id))}
      {disabled}
    />
  {:else}
    <span style="opacity: 0.5; font-size: 0.9em">No filters</span>
  {/each}
  {#if filters.length < 3}
    <button
      onclick={() => (filters = [...init_filters])}
      style="font-size: 0.8em; padding: 4pt 8pt"
    >
      Reset
    </button>
  {/if}
</div>

<div
  style="display: flex; flex-wrap: wrap; gap: 8pt; padding-top: 1em; border-top: 1px solid rgba(128, 128, 128, 0.2)"
>
  <strong style="font-size: 0.85em; opacity: 0.7; align-self: center">Clickable:</strong>
  {#each [`LiFePO4`, `LiCoO2`, `Fe2O3`] as mat}
    <InfoTag
      label="Material:"
      value={mat}
      onclick={() => (clicked = mat)}
      variant={clicked === mat ? `success` : `default`}
    />
  {/each}
  {#if clicked}<span style="font-size: 0.85em; opacity: 0.7; align-self: center">→
      Selected: {clicked}</span>{/if}
</div>

<div
  style="display: flex; flex-wrap: wrap; gap: 8pt; padding-top: 1em; border-top: 1px solid rgba(128, 128, 128, 0.2); margin-top: 1em"
>
  <strong style="font-size: 0.85em; opacity: 0.7; align-self: center"
  >Custom copy:</strong>
  <InfoTag
    label="ID:"
    value="mp-12345"
    copy_value="https://materialsproject.org/materials/mp-12345"
    title="Click to copy full URL"
    variant="info"
  />
  <InfoTag
    label="DOI:"
    value="10.1038/..."
    copy_value="https://doi.org/10.1038/s41586-024-07123-0"
    title="Click to copy DOI URL"
  />
</div>
```

## Subscripts & Superscripts

Both `label` and `value` support HTML via `{@html}`:

```svelte example
<script>
  import { InfoTag } from 'matterviz'
</script>

<div style="display: flex; flex-wrap: wrap; gap: 8pt">
  <InfoTag label="E<sub>g</sub>:" value="1.12 eV" />
  <InfoTag label="E<sub>hull</sub>:" value="0.02 eV" variant="warning" />
  <InfoTag label="Fe<sup>2+</sup>:" value="0.65 Å" variant="success" />
  <InfoTag label="Area:" value="42 m<sup>2</sup>" variant="info" />
  <InfoTag label="C<sub>p</sub>:" value="25 J·mol<sup>−1</sup>K<sup>−1</sup>" />
</div>
```

## Material Card Example

Combine tags with icons to display material properties with dynamic styling:

```svelte example
<script>
  import { Icon, InfoTag } from 'matterviz'

  const materials = [
    {
      formula: `LiFePO4`,
      bandgap: 3.8,
      ehull: 0,
      spacegroup: `Pnma`,
      mp_id: `mp-19017`,
    },
    {
      formula: `TiO2`,
      bandgap: 3.2,
      ehull: 0.023,
      spacegroup: `P42/mnm`,
      mp_id: `mp-2657`,
    },
    {
      formula: `Li3MnO4`,
      bandgap: 2.1,
      ehull: 0.15,
      spacegroup: `P4332`,
      mp_id: `mp-18929`,
    },
  ]

  function stability_variant(ehull) {
    return ehull <= 0 ? `success` : ehull <= 0.05 ? `warning` : `error`
  }

  function stability_icon(ehull) {
    return ehull <= 0 ? `CheckCircle` : ehull <= 0.05 ? `Alert` : `XCircle`
  }
</script>

<div
  style="display: grid; gap: 1em; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))"
>
  {#each materials as mat}
    <div
      style="padding: 12pt; border: 1px solid rgba(128, 128, 128, 0.15); border-radius: 10px; background: rgba(255, 255, 255, 0.02)"
    >
      <h3 style="margin: 0 0 10pt; font-size: 1.15em; font-weight: 600">{mat.formula}</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 6pt">
        <InfoTag label="E<sub>g</sub>:" value="{mat.bandgap} eV" size="sm" />
        <InfoTag label="SG:" value={mat.spacegroup} size="sm" variant="info" />
        <InfoTag
          label="E<sub>hull</sub>:"
          value="{mat.ehull.toFixed(3)} eV"
          size="sm"
          variant={stability_variant(mat.ehull)}
        >
          <Icon
            icon={stability_icon(mat.ehull)}
            style="width: 1em; height: 1em; margin-left: 2pt"
          />
        </InfoTag>
        <InfoTag
          label="ID:"
          value={mat.mp_id}
          size="sm"
          copy_value="https://materialsproject.org/materials/{mat.mp_id}"
        />
      </div>
    </div>
  {/each}
</div>
```
