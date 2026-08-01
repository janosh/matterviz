"""Generate OVITO reference output for the MatterViz structure-id cross-check.

Builds a handful of crystal fixtures, runs OVITO's own Common Neighbor Analysis (adaptive and
fixed-cutoff) and centrosymmetry modifiers on them, and writes positions plus per-atom results
to JSON so the TypeScript implementation can be compared against identical coordinates.
"""

from __future__ import annotations

import gzip
import json
import os

import numpy as np
from ovito.data import DataCollection
from ovito.modifiers import CentroSymmetryModifier, CommonNeighborAnalysisModifier
from ovito.pipeline import Pipeline, StaticSource

FCC_LATTICE_CONST = 3.615
BCC_LATTICE_CONST = 2.8665
HCP_LATTICE_CONST = 3.209
IDEAL_HCP_AXIAL_RATIO = np.sqrt(8 / 3)


def build_supercell(
    unit_matrix: np.ndarray, basis: np.ndarray, reps: tuple[int, int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """Return (cell_matrix, cartesian_positions) for a supercell of the given unit cell.

    `unit_matrix` rows are the unit-cell lattice vectors, `basis` holds fractional coordinates.
    """
    matrix = unit_matrix * np.array(reps)[:, None]
    frac = []
    for rep_a in range(reps[0]):
        for rep_b in range(reps[1]):
            for rep_c in range(reps[2]):
                for basis_vec in basis:
                    frac.append(
                        (np.array([rep_a, rep_b, rep_c]) + basis_vec) / np.array(reps)
                    )
    return matrix, np.array(frac) @ matrix


def cubic(lattice_const: float) -> np.ndarray:
    """Cubic lattice matrix with the given lattice constant."""
    return np.eye(3) * lattice_const


FCC_BASIS = np.array([[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]])
BCC_BASIS = np.array([[0, 0, 0], [0.5, 0.5, 0.5]])
HCP_BASIS = np.array([[0, 0, 0], [1 / 3, 2 / 3, 0.5]])


def hexagonal(lattice_const: float, axial_ratio: float) -> np.ndarray:
    """Hexagonal lattice matrix for the given a and c/a."""
    return np.array(
        [
            [lattice_const, 0, 0],
            [-lattice_const / 2, lattice_const * np.sqrt(3) / 2, 0],
            [0, 0, lattice_const * axial_ratio],
        ]
    )


def run_ovito(
    matrix: np.ndarray, positions: np.ndarray, fixed_cutoff: float | None, n_csp: int
) -> dict[str, list[float]]:
    """Run OVITO's adaptive CNA, optional fixed-cutoff CNA and CSP on one structure."""
    data = DataCollection()
    # OVITO's cell is 3x4: columns are the three cell vectors, the last column the origin
    data.create_cell(np.column_stack([matrix.T, np.zeros(3)]), (True, True, True))
    particles = data.create_particles(count=len(positions))
    particles.create_property("Position", data=positions)

    out: dict[str, list[float]] = {}
    pipeline = Pipeline(source=StaticSource(data=data))
    pipeline.modifiers.append(
        CommonNeighborAnalysisModifier(
            mode=CommonNeighborAnalysisModifier.Mode.AdaptiveCutoff
        )
    )
    out["cna_adaptive"] = pipeline.compute().particles["Structure Type"][...].tolist()
    pipeline.modifiers.clear()

    if fixed_cutoff is not None:
        pipeline.modifiers.append(
            CommonNeighborAnalysisModifier(
                mode=CommonNeighborAnalysisModifier.Mode.FixedCutoff,
                cutoff=fixed_cutoff,
            )
        )
        out["cna_fixed"] = pipeline.compute().particles["Structure Type"][...].tolist()
        pipeline.modifiers.clear()

    pipeline.modifiers.append(CentroSymmetryModifier(num_neighbors=n_csp))
    out["csp"] = pipeline.compute().particles["Centrosymmetry"][...].tolist()
    return out


def main() -> None:
    """Write the reference JSON consumed by tests/vitest/structure-id."""
    rng = np.random.default_rng(seed=0)
    cases: list[dict[str, object]] = []

    fcc_matrix, fcc_pos = build_supercell(
        cubic(FCC_LATTICE_CONST), FCC_BASIS, (3, 3, 3)
    )
    bcc_matrix, bcc_pos = build_supercell(
        cubic(BCC_LATTICE_CONST), BCC_BASIS, (3, 3, 3)
    )
    hcp_matrix, hcp_pos = build_supercell(
        hexagonal(HCP_LATTICE_CONST, IDEAL_HCP_AXIAL_RATIO), HCP_BASIS, (3, 3, 3)
    )

    # A vacancy: drop one atom well away from the cell corner
    vacancy_pos = np.delete(fcc_pos, 50, axis=0)
    # Thermal-like noise big enough to break some but not all signatures
    displaced_pos = fcc_pos + rng.uniform(-0.18, 0.18, size=fcc_pos.shape)
    # Enough noise to destroy the crystal entirely
    molten_pos = fcc_pos + rng.uniform(-0.6, 0.6, size=fcc_pos.shape)

    specs = [
        ("fcc", fcc_matrix, fcc_pos, 0.854 * FCC_LATTICE_CONST, 12),
        ("bcc", bcc_matrix, bcc_pos, 1.207 * BCC_LATTICE_CONST, 8),
        ("hcp", hcp_matrix, hcp_pos, 0.854 * HCP_LATTICE_CONST, 12),
        ("fcc_vacancy", fcc_matrix, vacancy_pos, 0.854 * FCC_LATTICE_CONST, 12),
        ("fcc_displaced", fcc_matrix, displaced_pos, 0.854 * FCC_LATTICE_CONST, 12),
        ("fcc_molten", fcc_matrix, molten_pos, None, 12),
    ]

    for label, matrix, positions, fixed_cutoff, n_csp in specs:
        # Round BEFORE handing the coordinates to OVITO, so OVITO and the TypeScript side see
        # byte-identical inputs and the comparison measures the algorithms, not the JSON round trip
        matrix = np.round(matrix, 10)
        positions = np.round(positions, 10)
        results = run_ovito(matrix, positions, fixed_cutoff, n_csp)
        cases.append(
            {
                "label": label,
                "matrix": matrix.tolist(),
                "positions": positions.tolist(),
                "fixed_cutoff": fixed_cutoff,
                "n_csp_neighbors": n_csp,
                **results,
            }
        )
        counts = np.bincount(results["cna_adaptive"], minlength=5).tolist()
        print(
            f"{label}: n={len(positions)} adaptive CNA counts (other/fcc/hcp/bcc/ico)={counts}"
        )

    out_path = f"{os.path.dirname(os.path.abspath(__file__))}/ovito_reference.json.gz"
    with gzip.open(out_path, "wt") as file:
        json.dump({"ovito_version": "3.15.5", "cases": cases}, file)
    print(f"wrote {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)")


main()
