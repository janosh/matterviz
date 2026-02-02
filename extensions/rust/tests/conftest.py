"""Shared test fixtures and helpers for ferrox tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal, overload

import numpy as np
import pytest

if TYPE_CHECKING:
    from collections.abc import Sequence


# === Structure Builders ===


def make_site(
    element: str,
    abc: Sequence[float],
    occu: float = 1.0,
    oxidation_state: int | None = None,
) -> dict:
    """Create a site dict for structure building, optionally with oxidation state."""
    species_entry: dict = {"element": element, "occu": occu}
    if oxidation_state is not None:
        species_entry["oxidation_state"] = oxidation_state
    return {"species": [species_entry], "abc": list(abc)}


def make_cubic_lattice(lattice_param: float) -> dict:
    """Create a cubic lattice matrix dict."""
    return {
        "matrix": [
            [lattice_param, 0, 0],
            [0, lattice_param, 0],
            [0, 0, lattice_param],
        ]
    }


def make_orthorhombic_lattice(len_a: float, len_b: float, len_c: float) -> dict:
    """Create an orthorhombic lattice matrix dict."""
    return {"matrix": [[len_a, 0, 0], [0, len_b, 0], [0, 0, len_c]]}


@overload
def make_structure(
    lattice: dict, sites: list[dict], as_json: Literal[False] = ...
) -> dict: ...
@overload
def make_structure(lattice: dict, sites: list[dict], as_json: Literal[True]) -> str: ...
def make_structure(
    lattice: dict,
    sites: list[dict],
    as_json: bool = False,
) -> dict | str:
    """Create a structure dict or JSON string."""
    struct = {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": lattice,
        "sites": sites,
    }
    return json.dumps(struct) if as_json else struct


@overload
def make_cubic_structure(
    lattice_param: float, sites: list[dict], as_json: Literal[False] = ...
) -> dict: ...
@overload
def make_cubic_structure(
    lattice_param: float, sites: list[dict], as_json: Literal[True]
) -> str: ...
def make_cubic_structure(
    lattice_param: float,
    sites: list[dict],
    as_json: bool = False,
) -> dict | str:
    """Create a structure with cubic lattice."""
    return make_structure(make_cubic_lattice(lattice_param), sites, as_json)


# === Coordinate Helpers ===


def get_cart_coords(structure: dict) -> np.ndarray:
    """Extract Cartesian coordinates from structure dict."""
    matrix = np.array(structure["lattice"]["matrix"])
    sites = structure["sites"]
    frac_coords = np.array([site["abc"] for site in sites])
    return frac_coords @ matrix


def minimum_image_distance(
    pos_a: np.ndarray, pos_b: np.ndarray, matrix: np.ndarray
) -> float:
    """Calculate minimum image distance between two Cartesian points."""
    inv_matrix = np.linalg.inv(matrix)
    diff_cart = pos_b - pos_a
    diff_frac = diff_cart @ inv_matrix
    # Wrap to [-0.5, 0.5)
    diff_frac = diff_frac - np.round(diff_frac)
    diff_cart_pbc = diff_frac @ matrix
    return float(np.linalg.norm(diff_cart_pbc))


def structure_to_json(structure: dict) -> str:
    """Convert structure dict to JSON string."""
    return json.dumps(structure)


# === Common Structure Fixtures ===


@pytest.fixture
def nacl_structure() -> dict:
    """NaCl primitive cell (2 atoms, cubic a=5.64 Å)."""
    return make_cubic_structure(
        5.64,
        [
            make_site("Na", [0, 0, 0]),
            make_site("Cl", [0.5, 0.5, 0.5]),
        ],
    )


@pytest.fixture
def nacl_json(nacl_structure: dict) -> str:
    """NaCl primitive cell as JSON string."""
    return json.dumps(nacl_structure)


@pytest.fixture
def fcc_cu_structure() -> dict:
    """FCC Cu conventional cell (4 atoms, cubic a=3.6 Å)."""
    return make_cubic_structure(
        3.6,
        [
            make_site("Cu", [0, 0, 0]),
            make_site("Cu", [0.5, 0.5, 0]),
            make_site("Cu", [0.5, 0, 0.5]),
            make_site("Cu", [0, 0.5, 0.5]),
        ],
    )


@pytest.fixture
def fcc_cu_json(fcc_cu_structure: dict) -> str:
    """FCC Cu conventional cell as JSON string."""
    return json.dumps(fcc_cu_structure)


@pytest.fixture
def orthorhombic_structure() -> dict:
    """Orthorhombic FeO cell (a=3, b=4, c=5 Å)."""
    return make_structure(
        make_orthorhombic_lattice(3.0, 4.0, 5.0),
        [make_site("Fe", [0, 0, 0]), make_site("O", [0.5, 0.5, 0.5])],
    )


@pytest.fixture
def triclinic_structure() -> dict:
    """Triclinic SiO2 cell with non-orthogonal axes."""
    return make_structure(
        {"matrix": [[4.0, 0.5, 0.2], [0.3, 5.0, 0.4], [0.1, 0.2, 6.0]]},
        [make_site("Si", [0, 0, 0]), make_site("O", [0.25, 0.25, 0.25])],
    )


@pytest.fixture
def simple_cubic_structure() -> dict:
    """Simple cubic Cu cell (1 atom, a=4.0 Å)."""
    return make_cubic_structure(4.0, [make_site("Cu", [0, 0, 0])])


# === Additional Fixtures Used by Other Tests ===


def lattice_from_matrix(matrix: list[list[float]]) -> dict:
    """Create a structure dict from a lattice matrix (for testing lattice operations)."""
    return make_structure({"matrix": matrix}, [make_site("H", [0, 0, 0])])


@pytest.fixture
def rocksalt_nacl_structure() -> dict:
    """NaCl conventional cell (8 atoms, rocksalt structure, CN=6)."""
    return make_cubic_structure(
        5.64,
        [
            make_site("Na", [0, 0, 0]),
            make_site("Na", [0.5, 0.5, 0]),
            make_site("Na", [0.5, 0, 0.5]),
            make_site("Na", [0, 0.5, 0.5]),
            make_site("Cl", [0.5, 0, 0]),
            make_site("Cl", [0, 0.5, 0]),
            make_site("Cl", [0, 0, 0.5]),
            make_site("Cl", [0.5, 0.5, 0.5]),
        ],
    )


@pytest.fixture
def rocksalt_nacl_json(rocksalt_nacl_structure: dict) -> str:
    """NaCl conventional cell as JSON string."""
    return json.dumps(rocksalt_nacl_structure)


@pytest.fixture
def nacl_with_oxi_json() -> str:
    """NaCl primitive cell with oxidation states (Na+, Cl-)."""
    return json.dumps(
        make_cubic_structure(
            5.64,
            [
                make_site("Na", [0, 0, 0], oxidation_state=1),
                make_site("Cl", [0.5, 0.5, 0.5], oxidation_state=-1),
            ],
        )
    )


@pytest.fixture
def bcc_fe_json() -> str:
    """BCC Fe (Im-3m #229), 2 sites, CN=8."""
    return json.dumps(
        make_cubic_structure(
            2.87,
            [
                make_site("Fe", [0, 0, 0]),
                make_site("Fe", [0.5, 0.5, 0.5]),
            ],
        )
    )


@pytest.fixture
def single_fe_json() -> str:
    """Single Fe atom in BCC lattice."""
    return json.dumps(make_cubic_structure(2.87, [make_site("Fe", [0, 0, 0])]))


@pytest.fixture
def fe2o3_json() -> str:
    """Fe2O3, 5 sites, non-cubic."""
    return json.dumps(
        make_structure(
            {"matrix": [[5, 0, 0], [0, 5, 0], [0, 0, 13.7]]},
            [
                make_site("Fe", [0, 0, 0.35]),
                make_site("Fe", [0, 0, 0.65]),
                make_site("O", [0.3, 0, 0.25]),
                make_site("O", [0.7, 0, 0.25]),
                make_site("O", [0, 0.3, 0.25]),
            ],
        )
    )


@pytest.fixture
def disordered_json() -> str:
    """Disordered Fe0.5Co0.5 alloy."""
    return json.dumps(
        make_structure(
            {"matrix": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]]},
            [
                {
                    "species": [
                        {"element": "Fe", "oxidation_state": 2, "occu": 0.5},
                        {"element": "Co", "oxidation_state": 2, "occu": 0.5},
                    ],
                    "abc": [0, 0, 0],
                }
            ],
        )
    )


@pytest.fixture
def lifepo4_json() -> str:
    """Simplified LiFePO4, 8 sites."""
    return json.dumps(
        make_structure(
            {"matrix": [[10.3, 0, 0], [0, 6, 0], [0, 0, 4.7]]},
            [
                make_site("Li", [0, 0, 0]),
                make_site("Li", [0.5, 0, 0.5]),
                make_site("Fe", [0.25, 0.25, 0]),
                make_site("Fe", [0.75, 0.75, 0]),
                make_site("P", [0.1, 0.25, 0.25]),
                make_site("P", [0.9, 0.75, 0.75]),
                make_site("O", [0.1, 0.25, 0.75]),
                make_site("O", [0.2, 0.5, 0.25]),
            ],
        )
    )
