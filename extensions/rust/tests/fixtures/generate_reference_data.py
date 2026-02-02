"""
Generate reference values from pymatgen for Rust unit tests.

This script generates expected values for various computational chemistry algorithms
and stores them in JSON format with version metadata for traceability.

Usage:
    python generate_reference_data.py

Requirements:
    pip install pymatgen numpy

The generated JSON file includes:
- Package versions used to generate the data
- Reference values for: Ewald summation, elastic tensors, Steinhardt order params,
  XRD patterns, structure matching, and more
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

import numpy as np

# === Type Definitions ===


class EwaldRef(TypedDict, total=False):
    """Reference data for Ewald summation test."""

    description: str
    total_energy_eV: float
    site_energy_fe_0_eV: float
    real_space_energy_eV: float
    reciprocal_energy_eV: float
    point_energy_eV: float
    n_atoms: int


class ElasticRef(TypedDict, total=False):
    """Reference data for elastic tensor test."""

    description: str
    voigt_matrix: list[list[float]]
    c11: float
    c12: float
    c44: float
    k_voigt: float
    k_reuss: float
    k_vrh: float
    g_voigt: float
    g_reuss: float
    g_vrh: float
    youngs_modulus: float
    poisson_ratio: float
    is_stable: bool
    zener_ratio: float


class SteinhardtRef(TypedDict):
    """Reference data for Steinhardt order parameters test."""

    description: str
    q4: float | None
    q6: float | None
    coordination: int
    cutoff: float


class XrdRef(TypedDict):
    """Reference data for XRD pattern test."""

    description: str
    two_theta: list[float]
    intensities: list[float]
    d_spacings: list[float]
    n_peaks: int


def get_package_versions() -> dict[str, str]:
    """Get versions of packages used to generate reference data."""
    from importlib.metadata import PackageNotFoundError, version

    versions = {"python": sys.version.split()[0]}
    for pkg in ["pymatgen", "numpy"]:
        try:
            versions[pkg] = version(pkg)
        except PackageNotFoundError:
            versions[pkg] = "not installed"
    return versions


# === Ewald Summation Reference Data ===


def generate_ewald_references() -> dict[str, EwaldRef]:
    """Generate Ewald summation reference values from pymatgen."""
    from pymatgen.analysis.ewald import EwaldSummation
    from pymatgen.core import Lattice, Structure

    results = {}

    # LiFePO4 (olivine) - standard test case from pymatgen
    # Lattice parameters from POSCAR_LiFePO4
    matrix = np.array(
        [
            [10.410154, 0.000076, -0.000406],
            [0.000130, 6.063274, 0.000317],
            [-0.000889, 0.000405, 4.754894],
        ]
    )
    lattice = Lattice(matrix)

    # Species with oxidation states
    species = ["Fe2+"] * 4 + ["Li+"] * 4 + ["O2-"] * 16 + ["P5+"] * 4

    frac_coords = [
        # Fe sites
        [0.218694, 0.749999, 0.475018],
        [0.281333, 0.250019, 0.975150],
        [0.718667, 0.749981, 0.024850],
        [0.781306, 0.250001, 0.524982],
        # Li sites
        [0.000000, 0.000000, 0.000000],
        [0.000000, 0.500000, 0.000000],
        [0.500000, 0.000000, 0.500000],
        [0.500000, 0.500000, 0.500000],
        # O sites
        [0.043339, 0.750012, 0.707396],
        [0.096672, 0.249992, 0.741528],
        [0.165629, 0.046219, 0.285196],
        [0.165617, 0.453735, 0.285259],
        [0.334380, 0.546244, 0.785237],
        [0.334384, 0.953680, 0.785213],
        [0.403353, 0.749992, 0.241483],
        [0.456612, 0.250025, 0.207341],
        [0.543388, 0.749975, 0.792659],
        [0.596647, 0.250008, 0.758517],
        [0.665616, 0.046320, 0.214787],
        [0.665620, 0.453756, 0.214763],
        [0.834383, 0.546265, 0.714741],
        [0.834371, 0.953781, 0.714804],
        [0.903328, 0.750008, 0.258472],
        [0.956661, 0.249988, 0.292604],
        # P sites
        [0.094714, 0.250071, 0.418190],
        [0.405225, 0.750080, 0.918200],
        [0.594775, 0.249920, 0.081800],
        [0.905286, 0.749929, 0.581810],
    ]

    structure = Structure(lattice, species, frac_coords)
    ewald = EwaldSummation(structure)

    # get_site_energy returns a single float for site 0
    site_energy_0 = ewald.get_site_energy(0)
    results["lifepo4"] = {
        "description": "LiFePO4 olivine with Fe2+/Li+/O2-/P5+",
        "total_energy_eV": float(ewald.total_energy),
        "site_energy_fe_0_eV": float(site_energy_0),
        "real_space_energy_eV": float(ewald.real_space_energy),
        "reciprocal_energy_eV": float(ewald.reciprocal_space_energy),
        "point_energy_eV": float(ewald.point_energy),
        "n_atoms": len(structure),
    }

    # NaCl - simple cubic test
    nacl = Structure(
        Lattice.cubic(5.64),
        ["Na+", "Cl-"],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    ewald_nacl = EwaldSummation(nacl)
    results["nacl"] = {
        "description": "NaCl rock salt",
        "total_energy_eV": float(ewald_nacl.total_energy),
        "n_atoms": 2,
    }

    return results


# === Elastic Tensor Reference Data ===


def generate_elastic_references() -> dict[str, ElasticRef]:
    """Generate elastic tensor reference values from pymatgen."""
    from pymatgen.analysis.elasticity import ElasticTensor

    results = {}

    # Sn-like material from pymatgen test_elastic.py
    c_matrix = np.array(
        [
            [59.33, 28.08, 28.08, 0, 0, 0],
            [28.08, 59.31, 28.07, 0, 0, 0],
            [28.08, 28.07, 59.32, 0, 0, 0],
            [0, 0, 0, 26.35, 0, 0],
            [0, 0, 0, 0, 26.35, 0],
            [0, 0, 0, 0, 0, 26.35],
        ]
    )

    elastic = ElasticTensor.from_voigt(c_matrix)
    results["sn_like"] = {
        "description": "Sn-like isotropic material from pymatgen tests",
        "voigt_matrix": c_matrix.tolist(),
        "k_voigt": float(elastic.k_voigt),
        "k_reuss": float(elastic.k_reuss),
        "k_vrh": float(elastic.k_vrh),
        "g_voigt": float(elastic.g_voigt),
        "g_reuss": float(elastic.g_reuss),
        "g_vrh": float(elastic.g_vrh),
        "youngs_modulus": float(elastic.y_mod),
        "poisson_ratio": float(elastic.homogeneous_poisson),
        "is_stable": elastic.property_dict.get("stable", True),
    }

    # Copper (cubic) - from materials databases
    c11, c12, c44 = 171.22, 130.50, 70.80
    cu_matrix = np.array(
        [
            [c11, c12, c12, 0, 0, 0],
            [c12, c11, c12, 0, 0, 0],
            [c12, c12, c11, 0, 0, 0],
            [0, 0, 0, c44, 0, 0],
            [0, 0, 0, 0, c44, 0],
            [0, 0, 0, 0, 0, c44],
        ]
    )

    elastic_cu = ElasticTensor.from_voigt(cu_matrix)
    results["copper"] = {
        "description": "Copper (FCC cubic)",
        "c11": c11,
        "c12": c12,
        "c44": c44,
        "k_vrh": float(elastic_cu.k_vrh),
        "g_vrh": float(elastic_cu.g_vrh),
        "zener_ratio": 2 * c44 / (c11 - c12),
    }

    return results


# === Steinhardt Order Parameters Reference Data ===


def generate_steinhardt_references() -> dict[str, SteinhardtRef]:
    """Generate Steinhardt order parameter reference values from pymatgen."""
    from pymatgen.analysis.local_env import LocalStructOrderParams
    from pymatgen.core import Lattice, Structure

    results = {}

    # FCC Cu: a=3.61 Å
    # 1st shell: a/sqrt(2) ≈ 2.55 Å (12 neighbors)
    # 2nd shell: a = 3.61 Å (6 neighbors)
    # Cutoff: midpoint between shells
    a_fcc = 3.61
    fcc_nn_dist = a_fcc / np.sqrt(2)
    fcc_second_shell = a_fcc
    fcc_cutoff = 0.5 * (fcc_nn_dist + fcc_second_shell)
    fcc = Structure(
        Lattice.cubic(a_fcc),
        ["Cu"] * 4,
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    ops_fcc = LocalStructOrderParams(["q4", "q6"], cutoff=fcc_cutoff)
    fcc_params = ops_fcc.get_order_parameters(fcc, 0)
    results["fcc_cu"] = {
        "description": f"FCC Copper (a={a_fcc} Å)",
        "q4": float(fcc_params[0]) if fcc_params[0] is not None else None,
        "q6": float(fcc_params[1]) if fcc_params[1] is not None else None,
        "coordination": 12,
        "cutoff": float(fcc_cutoff),
    }

    # BCC Fe: a=2.87 Å
    # Literature values (Lechner & Dellago) require BOTH coordination shells:
    # 1st shell: a*sqrt(3)/2 ≈ 2.48 Å (8 neighbors)
    # 2nd shell: a = 2.87 Å (6 neighbors)
    # Cutoff must be above second shell to include all 14 neighbors
    a_bcc = 2.87
    bcc_cutoff = a_bcc * 1.1  # ~3.16 Å, captures 14 neighbors
    bcc = Structure(
        Lattice.cubic(a_bcc),
        ["Fe"] * 2,
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    ops_bcc = LocalStructOrderParams(["q4", "q6"], cutoff=bcc_cutoff)
    bcc_params = ops_bcc.get_order_parameters(bcc, 0)
    results["bcc_fe"] = {
        "description": f"BCC Iron (a={a_bcc} Å)",
        "q4": float(bcc_params[0]) if bcc_params[0] is not None else None,
        "q6": float(bcc_params[1]) if bcc_params[1] is not None else None,
        "coordination": 14,  # First shell (8) + second shell (6)
        "cutoff": float(bcc_cutoff),
    }

    # HCP Mg: a=3.21 Å, c=5.21 Å
    # 1st shell: ~a = 3.21 Å (12 neighbors in ideal HCP)
    # Use cutoff slightly above a to capture all 12
    a_hcp, c_hcp = 3.21, 5.21
    hcp_cutoff = a_hcp * 1.1  # 10% above nearest neighbor
    hcp = Structure(
        Lattice.hexagonal(a_hcp, c_hcp),
        ["Mg"] * 2,
        [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]],
    )
    ops_hcp = LocalStructOrderParams(["q4", "q6"], cutoff=hcp_cutoff)
    hcp_params = ops_hcp.get_order_parameters(hcp, 0)
    results["hcp_mg"] = {
        "description": f"HCP Magnesium (a={a_hcp} Å, c={c_hcp} Å)",
        "q4": float(hcp_params[0]) if hcp_params[0] is not None else None,
        "q6": float(hcp_params[1]) if hcp_params[1] is not None else None,
        "coordination": 12,
        "cutoff": float(hcp_cutoff),
    }

    return results


# === XRD Reference Data ===


def generate_xrd_references() -> dict[str, XrdRef]:
    """Generate XRD pattern reference values from pymatgen."""
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    from pymatgen.core import Lattice, Structure

    results = {}
    xrd_calc = XRDCalculator()

    # Graphite (hexagonal)
    graphite = Structure(
        Lattice.hexagonal(2.464, 6.711),
        ["C"] * 4,
        [
            [0, 0, 0],
            [0, 0, 0.5],
            [1 / 3, 2 / 3, 0],
            [2 / 3, 1 / 3, 0.5],
        ],
    )
    pattern = xrd_calc.get_pattern(graphite)
    results["graphite"] = {
        "description": "Graphite (P6_3/mmc)",
        "two_theta": pattern.x.tolist()[:10],
        "intensities": pattern.y.tolist()[:10],
        "d_spacings": pattern.d_hkls[:10],
        "n_peaks": len(pattern.x),
    }

    # CsCl (cubic Pm-3m)
    cscl = Structure(
        Lattice.cubic(4.209),
        ["Cs", "Cl"],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    pattern = xrd_calc.get_pattern(cscl)
    results["cscl"] = {
        "description": "CsCl (Pm-3m)",
        "two_theta": pattern.x.tolist()[:10],
        "intensities": pattern.y.tolist()[:10],
        "d_spacings": pattern.d_hkls[:10],
        "n_peaks": len(pattern.x),
    }

    return results


# === Main ===


def main() -> None:
    """Generate all reference data and save to JSON."""
    print("Generating reference data for Rust unit tests...")
    print("=" * 70)

    versions = get_package_versions()
    print(f"Package versions: {versions}")

    reference_data = {
        "_metadata": {
            "generated_at": datetime.now(UTC).isoformat(),
            "package_versions": versions,
            "description": "Reference values for ferrox Rust unit tests",
        },
    }

    # Generate each category of reference data
    generators = [
        ("ewald", generate_ewald_references),
        ("elastic", generate_elastic_references),
        ("steinhardt", generate_steinhardt_references),
        ("xrd", generate_xrd_references),
    ]

    for name, generator in generators:
        print(f"\nGenerating {name} references...")
        try:
            reference_data[name] = generator()
            print(f"  ✓ {name}: {len(reference_data[name])} entries")
        except Exception as exc:
            print(f"  ✗ {name}: {exc}")
            raise

    # Save to JSON
    output_dir = Path(__file__).parent
    output_file = output_dir / "pymatgen_reference_data.json"

    with open(output_file, "w") as file_handle:
        json.dump(reference_data, file_handle, indent=2)

    print("\n" + "=" * 70)
    print(f"Reference data saved to: {output_file}")


if __name__ == "__main__":
    main()
