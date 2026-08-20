# Fermi Surface Example Files

This directory contains example Fermi surface data files for testing and demonstrating the visualization capabilities.

## Files

| File                             | Format | Grid       | Bands | Source                                                                                           | Notes                                              |
| -------------------------------- | ------ | ---------- | ----- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `cu_fs.bxsf.gz`                  | BXSF   | 31³        | 2     | [pranabdas/espresso](https://github.com/pranabdas/espresso/blob/main/src/cu/cu_fs.bxsf)          | Large grid, classic Cu "belly + necks" FS          |
| `ni_fs.bxsf.gz`                  | BXSF   | 17³        | 4     | [QEF/q-e](https://github.com/QEF/q-e/blob/develop/PP/examples/example02/reference/ni_fs.bxsf)    | Multi-band, complex d-orbital topology             |
| `ni_fsup.bxsf.gz`                | BXSF   | 17³        | 4     | [QEF/q-e](https://github.com/QEF/q-e/blob/develop/PP/examples/example02/reference/ni_fsup.bxsf)  | Spin-polarized (majority spin)                     |
| `ni_fsdw.bxsf.gz`                | BXSF   | 17³        | 4     | [QEF/q-e](https://github.com/QEF/q-e/blob/develop/PP/examples/example02/reference/ni_fsdw.bxsf)  | Spin-polarized (minority spin)                     |
| `pb.bxsf.gz`                     | BXSF   | 17³        | 3     | [FermiSurfer](https://github.com/mitsuaki1987/fermisurfer/blob/master/examples/pb.bxsf)          | Simple sp-metal, small/fast baseline               |
| `pb_vf3D.frmsf.gz`               | FRMSF  | 16³        | 3     | [FermiSurfer](https://github.com/mitsuaki1987/fermisurfer/blob/master/examples/pb_vf3D.frmsf)    | 3D Fermi velocity coloring (vx, vy, vz)            |
| `mgb2_vfz.frmsf.gz`              | FRMSF  | 40×40×36   | 3     | [FermiSurfer](https://github.com/mitsuaki1987/fermisurfer/blob/master/examples/mgb2_vfz.frmsf)   | Non-cubic grid, large, MgB₂ two-gap superconductor |
| `mgb2_b2pz.frmsf.gz`             | FRMSF  | 16×16×12   | 3     | [QEF/q-e](https://github.com/QEF/q-e/blob/develop/PP/examples/fermisurf_example/reference/)      | B 2pz orbital projection coloring                  |
| `mgb2_vfermi.frmsf.gz`           | FRMSF  | 16×16×12   | 3     | [QEF/q-e](https://github.com/QEF/q-e/blob/develop/PP/examples/fermisurf_example/reference/)      | Fermi velocity magnitude coloring                  |
| `srvo3_orb.frmsf.gz`             | FRMSF  | 32³        | 3     | [FermiSurfer](https://github.com/mitsuaki1987/fermisurfer/blob/master/examples/srvo3_orb.frmsf)  | Orbital character coloring (t₂g)                   |
| `fs_BaFe2As2_reciprocal.json.gz` | IFermi | pre-meshed | 2     | [IFermi](https://github.com/fermisurfaces/IFermi/blob/main/tests/fs_BaFe2As2_reciprocal.json.gz) | 10 surfaces, parallelepiped cell, iron pnictide    |
| `fs_BaFe2As2_wigner.json.gz`     | IFermi | pre-meshed | 2     | [IFermi](https://github.com/fermisurfaces/IFermi/blob/main/tests/fs_BaFe2As2_wigner.json.gz)     | Same as above with Wigner-Seitz clipping           |

## Edge Cases

- **Large grids** (performance): `cu_fs` (31³), `mgb2_vfz` (57k points)
- **Non-cubic** (anisotropic handling): `mgb2_vfz` (40×40×36)
- **Multi-band** (band selector UI): `ni_fs` (4 bands)
- **Spin-polarized** (spin channels): `ni_fsup`/`ni_fsdw`
- **Color data** (property visualization): `pb_vf3D`, `mgb2_vfz`, `srvo3_orb`
- **Pre-meshed** (IFermi JSON): `fs_BaFe2As2_*`

## Adding Files

Files matching `*.bxsf(.gz)`, `*.frmsf(.gz)`, `*.json(.gz)` are auto-discovered via `import.meta.glob` in `index.ts`.

For FRMSF color data files, add the filename to `FRMSF_COLOR_DATA_FILES` in `index.ts`.
