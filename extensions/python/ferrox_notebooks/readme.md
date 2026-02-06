# Ferrox Marimo Example Notebooks

Interactive notebooks demonstrating ferrox's Rust-powered atomistic simulation capabilities with integrated pymatviz visualizations. Ferrox is a high-performance base layer for computational materials science.

## Running the Notebooks

Each notebook is a [marimo](https://marimo.io) app. Run with:

```bash
marimo edit 01_structure_matching.py --no-sandbox
```

Or run all notebooks in the browser:

```bash
marimo run 01_structure_matching.py
```

## Notebooks

| #  | Notebook                     | Topic                | Key Features                                              |
| -- | ---------------------------- | -------------------- | --------------------------------------------------------- |
| 01 | `01_structure_matching.py`   | Structure Matching   | Batch deduplication, parallel matching, tolerance testing |
| 02 | `02_ordering_disordered.py`  | Ordering Disordered  | HEA enumeration, Ewald ranking, derivative structures     |
| 03 | `03_surface_science.py`      | Surface Science      | Slab generation, adsorption sites, Wulff shapes           |
| 04 | `04_defect_engineering.py`   | Defect Engineering   | Vacancies, substitutions, interstitials, Voronoi sites    |
| 05 | `05_md_simulation.py`        | MD Simulation        | NVE/NVT dynamics, LJ/Morse potentials, FIRE optimization  |
| 06 | `06_phase_classification.py` | Phase Classification | Steinhardt Q, FCC/BCC/HCP detection, Voronoi coordination |
| 07 | `07_ionic_conductor.py`      | Ionic Conductors     | RDF, MSD, VACF, diffusion coefficients                    |
| 08 | `08_xrd_analysis.py`         | XRD Analysis         | Pattern calculation, peak indexing, wavelength comparison |
| 09 | `09_elastic_properties.py`   | Elastic Properties   | Strain matrices, elastic tensor, bulk/shear moduli        |
| 10 | `10_symmetry_analysis.py`    | Symmetry Analysis    | Space groups, Wyckoff positions, cell transformations     |

## Dependencies

Each notebook includes inline dependencies via PEP 723. Alternatively, install:

```bash
pip install pymatgen ferrox pymatviz numpy marimo
```

## Notebook Structure

Each notebook follows a consistent pattern:

1. **Introduction** - Overview of functionality
2. **Setup** - Imports and configuration
3. **Interactive demos** - StructureWidget/TrajectoryWidget visualizations
4. **Performance benchmarks** - Ferrox vs pymatgen timing comparisons
5. **Edge cases** - Stress tests and bug-revealing scenarios

## Benchmarking Pattern

```python
import time

# Ferrox benchmark
start = time.perf_counter()
ferrox_result = ferrox_function(...)
ferrox_time = time.perf_counter() - start

# Pymatgen benchmark
start = time.perf_counter()
pymatgen_result = pymatgen_function(...)
pymatgen_time = time.perf_counter() - start

speedup = pymatgen_time / ferrox_time
```

## Widget Integration

```python
import pymatviz as pmv
import marimo as mo

# Structure visualization
pmv.StructureWidget(structure=struct, style="height: 300px;")

# Trajectory with property plots
pmv.TrajectoryWidget(
    trajectory=frames,
    display_mode="structure+scatter",
    show_controls=True,
)

# Layout with marimo
mo.hstack([widget1, widget2], gap=2)
mo.vstack([mo.md("**Title**"), widget])
```
