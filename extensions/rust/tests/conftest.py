"""Shared fixtures for ferrox tests."""

from __future__ import annotations

import json
import pytest


def _cubic(a: float, sites: list[dict]) -> str:
    """Create structure JSON with cubic lattice."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[a, 0, 0], [0, a, 0], [0, 0, a]]},
        "sites": sites,
    })


def _s(el: str, abc: list[float], oxi: int | None = None) -> dict:
    """Create site dict with optional oxidation state."""
    species = {"element": el, "occu": 1}
    if oxi is not None:
        species["oxidation_state"] = oxi
    return {"species": [species], "abc": abc}


# === Fixtures ===

@pytest.fixture
def nacl_json() -> str:
    """NaCl primitive (Pm-3m #221), 2 sites."""
    return _cubic(5.64, [_s("Na", [0, 0, 0]), _s("Cl", [0.5, 0.5, 0.5])])


@pytest.fixture
def nacl_with_oxi_json() -> str:
    """NaCl with oxidation states (Na+, Cl-)."""
    return _cubic(5.64, [_s("Na", [0, 0, 0], 1), _s("Cl", [0.5, 0.5, 0.5], -1)])


@pytest.fixture
def rocksalt_nacl_json() -> str:
    """NaCl conventional cell, 8 sites, CN=6."""
    return _cubic(5.64, [
        _s("Na", [0, 0, 0]), _s("Na", [0.5, 0.5, 0]), _s("Na", [0.5, 0, 0.5]), _s("Na", [0, 0.5, 0.5]),
        _s("Cl", [0.5, 0, 0]), _s("Cl", [0, 0.5, 0]), _s("Cl", [0, 0, 0.5]), _s("Cl", [0.5, 0.5, 0.5]),
    ])


@pytest.fixture
def fcc_cu_json() -> str:
    """FCC Cu (Fm-3m #225), 4 sites, CN=12."""
    return _cubic(3.6, [
        _s("Cu", [0, 0, 0]), _s("Cu", [0.5, 0.5, 0]), _s("Cu", [0.5, 0, 0.5]), _s("Cu", [0, 0.5, 0.5]),
    ])


@pytest.fixture
def bcc_fe_json() -> str:
    """BCC Fe (Im-3m #229), 2 sites, CN=8."""
    return _cubic(2.87, [_s("Fe", [0, 0, 0]), _s("Fe", [0.5, 0.5, 0.5])])


@pytest.fixture
def single_fe_json() -> str:
    """Single Fe atom in BCC lattice."""
    return _cubic(2.87, [_s("Fe", [0, 0, 0])])


@pytest.fixture
def fe2o3_json() -> str:
    """Fe2O3, 5 sites, non-cubic."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[5, 0, 0], [0, 5, 0], [0, 0, 13.7]]},
        "sites": [
            _s("Fe", [0, 0, 0.35]), _s("Fe", [0, 0, 0.65]),
            _s("O", [0.3, 0, 0.25]), _s("O", [0.7, 0, 0.25]), _s("O", [0, 0.3, 0.25]),
        ],
    })


@pytest.fixture
def disordered_json() -> str:
    """Disordered Fe0.5Co0.5 alloy."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]]},
        "sites": [{"species": [
            {"element": "Fe", "oxidation_state": 2, "occu": 0.5},
            {"element": "Co", "oxidation_state": 2, "occu": 0.5},
        ], "abc": [0, 0, 0]}],
    })


@pytest.fixture
def lifepo4_json() -> str:
    """Simplified LiFePO4, 8 sites."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[10.3, 0, 0], [0, 6, 0], [0, 0, 4.7]]},
        "sites": [
            _s("Li", [0, 0, 0]), _s("Li", [0.5, 0, 0.5]),
            _s("Fe", [0.25, 0.25, 0]), _s("Fe", [0.75, 0.75, 0]),
            _s("P", [0.1, 0.25, 0.25]), _s("P", [0.9, 0.75, 0.75]),
            _s("O", [0.1, 0.25, 0.75]), _s("O", [0.2, 0.5, 0.25]),
        ],
    })
