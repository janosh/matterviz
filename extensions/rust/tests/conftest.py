"""Shared fixtures for ferrox tests."""

from __future__ import annotations

import json

import pytest


def make_structure(lattice_a: float, sites: list[dict]) -> str:
    """Create structure JSON with cubic lattice."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[lattice_a, 0, 0], [0, lattice_a, 0], [0, 0, lattice_a]]},
        "sites": sites,
    })


def site(element: str, abc: list[float], oxi: int | None = None) -> dict:
    """Create a site dict."""
    species = {"element": element, "occu": 1}
    if oxi is not None:
        species["oxidation_state"] = oxi
    return {"species": [species], "abc": abc}


# Common structure fixtures
@pytest.fixture
def nacl_json() -> str:
    """NaCl rocksalt (Pm-3m #221), 2 sites."""
    return make_structure(5.64, [site("Na", [0, 0, 0]), site("Cl", [0.5, 0.5, 0.5])])


@pytest.fixture
def nacl_with_oxi_json() -> str:
    """NaCl with oxidation states (Na+, Cl-)."""
    return make_structure(5.64, [site("Na", [0, 0, 0], oxi=1), site("Cl", [0.5, 0.5, 0.5], oxi=-1)])


@pytest.fixture
def fcc_cu_json() -> str:
    """FCC Cu conventional cell (Fm-3m #225), 4 sites, CN=12."""
    return make_structure(3.6, [
        site("Cu", [0, 0, 0]), site("Cu", [0.5, 0.5, 0]),
        site("Cu", [0.5, 0, 0.5]), site("Cu", [0, 0.5, 0.5]),
    ])


@pytest.fixture
def bcc_fe_json() -> str:
    """BCC Fe conventional cell (Im-3m #229), 2 sites, CN=8."""
    return make_structure(2.87, [site("Fe", [0, 0, 0]), site("Fe", [0.5, 0.5, 0.5])])


@pytest.fixture
def fe2o3_json() -> str:
    """Fe2O3 structure, 5 sites."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[5.0, 0, 0], [0, 5.0, 0], [0, 0, 13.7]]},
        "sites": [
            site("Fe", [0, 0, 0.35]), site("Fe", [0, 0, 0.65]),
            site("O", [0.3, 0, 0.25]), site("O", [0.7, 0, 0.25]), site("O", [0, 0.3, 0.25]),
        ],
    })


@pytest.fixture
def single_fe_json() -> str:
    """Single Fe atom in BCC lattice."""
    return make_structure(2.87, [site("Fe", [0, 0, 0])])


@pytest.fixture
def disordered_json() -> str:
    """Disordered Fe0.5Co0.5 alloy."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]]},
        "sites": [{
            "species": [
                {"element": "Fe", "oxidation_state": 2, "occu": 0.5},
                {"element": "Co", "oxidation_state": 2, "occu": 0.5},
            ],
            "abc": [0, 0, 0],
        }],
    })


@pytest.fixture
def lifepo4_json() -> str:
    """Simplified LiFePO4, 8 sites."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[10.3, 0, 0], [0, 6.0, 0], [0, 0, 4.7]]},
        "sites": [
            site("Li", [0.0, 0.0, 0.0]), site("Li", [0.5, 0.0, 0.5]),
            site("Fe", [0.25, 0.25, 0.0]), site("Fe", [0.75, 0.75, 0.0]),
            site("P", [0.1, 0.25, 0.25]), site("P", [0.9, 0.75, 0.75]),
            site("O", [0.1, 0.25, 0.75]), site("O", [0.2, 0.5, 0.25]),
        ],
    })


@pytest.fixture
def rocksalt_nacl_json() -> str:
    """NaCl rocksalt conventional cell, 8 sites, CN=6."""
    return make_structure(5.64, [
        site("Na", [0, 0, 0]), site("Na", [0.5, 0.5, 0]),
        site("Na", [0.5, 0, 0.5]), site("Na", [0, 0.5, 0.5]),
        site("Cl", [0.5, 0, 0]), site("Cl", [0, 0.5, 0]),
        site("Cl", [0, 0, 0.5]), site("Cl", [0.5, 0.5, 0.5]),
    ])
