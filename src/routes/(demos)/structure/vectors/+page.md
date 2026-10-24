# Site Vectors (Force, Magmom, Spin)

Structures can carry per-site vector data in their `properties` dict. Recognized keys include `force`, `magmom`, `spin` and prefixed variants like `force_DFT` or `magmom_MLFF`. When multiple vector keys are present, each gets its own color, toggle, and per-key scale slider. Only one layer draws by default, picked in the order magmoms, spins, forces; the others stay one toggle away under Visibility.

## Color Modes

`auto` maps `force*` to element colors and `magmom`/`spin` to signed-z colors. Other modes are `element`, `spin direction`, `magnitude` (`vector_color_scale`), and `uniform` (`vector_color`); multi-key data gets a distinct, editable color per key.

```svelte example
<script lang="ts">
  import { calc_lattice_params, Structure } from 'matterviz'
  import type { ElementSymbol, Matrix3x3, Vec3 } from 'matterviz'

  // periodic lattice from its matrix, with lengths, angles and volume derived
  // site of one fully occupied element, labeled by it
  const site = (
    element: ElementSymbol,
    abc: Vec3,
    xyz: Vec3,
    properties: Record<string, unknown>,
  ) => ({
    species: [{ element, occu: 1 }],
    abc,
    xyz,
    label: element,
    properties,
  })
  const lattice = (matrix: Matrix3x3) => ({
    matrix,
    pbc: [true, true, true],
    ...calc_lattice_params(matrix),
  })
  const fe_bcc = lattice([
    [-1.435, 1.435, 1.435],
    [1.435, -1.435, 1.435],
    [1.435, 1.435, -1.435],
  ])
  const nacl = lattice([
    [5.64, 0, 0],
    [0, 5.64, 0],
    [0, 0, 5.64],
  ])
  const tio2 = lattice([
    [4.594, 0, 0],
    [0, 4.594, 0],
    [0, 0, 2.959],
  ])

  const examples = [
    {
      title: `Fe BCC — single force`,
      desc: `Single force key, element-colored arrows`,
      structure: {
        lattice: fe_bcc,
        sites: [
          site(`Fe`, [0, 0, 0], [0, 0, 0], { force: [0.8, -0.5, 1.2] }),
          site(`Fe`, [0.5, 0.5, 0.5], [0.718, 0.718, 0.718], { force: [-0.8, 0.5, -1.2] }),
        ],
      },
    },
    {
      title: `Fe BCC — antiferromagnetic magmoms`,
      desc: `Scalar magmom ±2.2 μB along z, spin-direction coloring (red=up, blue=down)`,
      structure: {
        lattice: fe_bcc,
        sites: [
          site(`Fe`, [0, 0, 0], [0, 0, 0], { magmom: [0, 0, 2.2] }),
          site(`Fe`, [0.5, 0.5, 0.5], [0.718, 0.718, 0.718], { magmom: [0, 0, -2.2] }),
        ],
      },
    },
    {
      title: `Fe BCC — canted spins`,
      desc: `Non-collinear spin vectors tilted off-axis`,
      structure: {
        lattice: fe_bcc,
        sites: [
          site(`Fe`, [0, 0, 0], [0, 0, 0], { spin: [1.5, 0.8, 1.8] }),
          site(`Fe`, [0.5, 0.5, 0.5], [0.718, 0.718, 0.718], { spin: [-1.2, 1.0, -1.6] }),
        ],
      },
    },
    {
      title: `NaCl — ionic forces`,
      desc: `Forces on a rock-salt structure with different element colors per sublattice`,
      structure: {
        lattice: nacl,
        sites: [
          site(`Na`, [0, 0, 0], [0, 0, 0], { force: [0.3, 0.1, -0.5] }),
          site(`Cl`, [0.5, 0.5, 0], [2.82, 2.82, 0], { force: [-0.2, 0.4, 0.3] }),
          site(`Na`, [0.5, 0, 0.5], [2.82, 0, 2.82], { force: [0.1, -0.6, 0.2] }),
          site(`Cl`, [0, 0.5, 0.5], [0, 2.82, 2.82], { force: [-0.3, 0.2, -0.4] }),
        ],
      },
    },
    {
      title: `TiO₂ rutile — force comparison`,
      desc: `force_DFT vs force_MLFF on a multi-element oxide, both drawn via vector_configs. Use Origin Gap to separate overlapping arrows`,
      vector_configs: {
        force_DFT: { visible: true, color: `#e74c3c` },
        force_MLFF: { visible: true, color: `#3498db` },
      },
      structure: {
        lattice: tio2,
        sites: [
          {
            species: [{ element: `Ti`, occu: 1 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `Ti`,
            properties: {
              force_DFT: [0.1, -0.2, 0.8],
              force_MLFF: [0.12, -0.18, 0.75],
            },
          },
          {
            species: [{ element: `Ti`, occu: 1 }],
            abc: [0.5, 0.5, 0.5],
            xyz: [2.297, 2.297, 1.48],
            label: `Ti`,
            properties: {
              force_DFT: [-0.1, 0.2, -0.8],
              force_MLFF: [-0.15, 0.25, -0.82],
            },
          },
          {
            species: [{ element: `O`, occu: 1 }],
            abc: [0.305, 0.305, 0],
            xyz: [1.401, 1.401, 0],
            label: `O`,
            properties: {
              force_DFT: [0.4, 0.4, -0.1],
              force_MLFF: [0.38, 0.42, -0.08],
            },
          },
          {
            species: [{ element: `O`, occu: 1 }],
            abc: [0.695, 0.695, 0],
            xyz: [3.193, 3.193, 0],
            label: `O`,
            properties: {
              force_DFT: [-0.4, -0.4, 0.1],
              force_MLFF: [-0.35, -0.45, 0.15],
            },
          },
        ],
      },
    },
    {
      title: `Fe BCC — forces + magmoms`,
      desc: `Three vector layers: force_DFT, force_MLFF, and magmom. Only magmom draws by default (magmoms, then spins, then forces); toggle the forces under Visibility`,
      structure: {
        lattice: fe_bcc,
        sites: [
          {
            species: [{ element: `Fe`, occu: 1 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `Fe`,
            properties: {
              force_DFT: [0.6, -0.3, 0.2],
              force_MLFF: [0.55, -0.28, 0.18],
              magmom: [0, 0, 2.2],
            },
          },
          {
            species: [{ element: `Fe`, occu: 1 }],
            abc: [0.5, 0.5, 0.5],
            xyz: [0.718, 0.718, 0.718],
            label: `Fe`,
            properties: {
              force_DFT: [-0.6, 0.3, -0.2],
              force_MLFF: [-0.65, 0.35, -0.25],
              magmom: [0, 0, -2.2],
            },
          },
        ],
      },
    },
    {
      title: `BaTiO₃ 3×3×3 supercell — 135 atoms`,
      desc: `Large perovskite supercell with randomized force vectors on every atom`,
      structure: (() => {
        // BaTiO3 perovskite: 5 atoms/cell × 3×3×3 = 135 atoms
        const lat_a = 4.01
        const basis = [
          { elem: `Ba`, frac: [0, 0, 0] },
          { elem: `Ti`, frac: [0.5, 0.5, 0.5] },
          { elem: `O`, frac: [0.5, 0.5, 0] },
          { elem: `O`, frac: [0.5, 0, 0.5] },
          { elem: `O`, frac: [0, 0.5, 0.5] },
        ]
        const n_rep = 3
        const super_a = lat_a * n_rep
        const sites = []
        // seeded pseudo-random in [-0.5, 0.5) for reproducible vectors
        let seed = 42
        const rand = () => {
          seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
          return seed / 0x80000000 - 0.5
        }
        for (let idx_x = 0; idx_x < n_rep; idx_x++) {
          for (let idx_y = 0; idx_y < n_rep; idx_y++) {
            for (let idx_z = 0; idx_z < n_rep; idx_z++) {
              for (const { elem, frac } of basis) {
                const abc = [
                  (frac[0] + idx_x) / n_rep,
                  (frac[1] + idx_y) / n_rep,
                  (frac[2] + idx_z) / n_rep,
                ]
                const xyz = [abc[0] * super_a, abc[1] * super_a, abc[2] * super_a]
                sites.push({
                  species: [{ element: elem, occu: 1 }],
                  abc,
                  xyz,
                  label: elem,
                  properties: { force: [rand() * 0.8, rand() * 0.8, rand() * 0.8] },
                })
              }
            }
          }
        }
        return {
          lattice: lattice([
            [super_a, 0, 0],
            [0, super_a, 0],
            [0, 0, super_a],
          ]),
          sites,
        }
      })(),
    },
    {
      title: `TiO₂ rutile — spins + forces`,
      desc: `Combining spin vectors on Ti atoms with force vectors on all atoms`,
      structure: {
        lattice: tio2,
        sites: [
          site(`Ti`, [0, 0, 0], [0, 0, 0], {
            force: [0.1, -0.15, 0.3],
            spin: [0.5, 0.5, 0.8],
          }),
          site(`Ti`, [0.5, 0.5, 0.5], [2.297, 2.297, 1.48], {
            force: [-0.1, 0.15, -0.3],
            spin: [-0.5, -0.5, 0.8],
          }),
          site(`O`, [0.305, 0.305, 0], [1.401, 1.401, 0], { force: [0.3, 0.3, -0.05] }),
          site(`O`, [0.695, 0.695, 0], [3.193, 3.193, 0], { force: [-0.3, -0.3, 0.05] }),
        ],
      },
    },
  ]
</script>

<ul class="vector-grid">
  {#each examples as { title, desc, structure, vector_configs } (title)}
    <li>
      <h3>{title}</h3>
      <p>{desc}</p>
      <Structure {structure} scene_props={{ show_bonds: `never`, vector_configs }} />
    </li>
  {/each}
</ul>

<style>
  ul.vector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(500px, 100%), 1fr));
    gap: 1.5em;
    list-style: none;
    padding: 0;
    width: 95vw;
    margin: 2em calc(50cqw - 47.5vw);
  }
  ul.vector-grid h3 {
    margin: 0.3em 0;
    font-size: 1.1em;
  }
  ul.vector-grid p {
    margin: 0 0 0.5em;
    font-size: 0.85em;
    opacity: 0.7;
  }
</style>
```
