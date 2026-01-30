"""Tests for ferrox Python API - composition and structure metadata functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox._ferrox import get_structure_metadata, parse_composition
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


# Fixtures


@pytest.fixture
def nacl_json() -> str:
    """NaCl rocksalt structure as JSON."""
    return json.dumps(
        {
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "lattice": {"matrix": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]]},
            "sites": [
                {"species": [{"element": "Na", "occu": 1}], "abc": [0, 0, 0]},
                {"species": [{"element": "Cl", "occu": 1}], "abc": [0.5, 0.5, 0.5]},
            ],
        }
    )


@pytest.fixture
def fe2o3_json() -> str:
    """Fe2O3 structure as JSON (simplified)."""
    return json.dumps(
        {
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "lattice": {"matrix": [[5.0, 0, 0], [0, 5.0, 0], [0, 0, 13.7]]},
            "sites": [
                {"species": [{"element": "Fe", "occu": 1}], "abc": [0, 0, 0.35]},
                {"species": [{"element": "Fe", "occu": 1}], "abc": [0, 0, 0.65]},
                {"species": [{"element": "O", "occu": 1}], "abc": [0.3, 0, 0.25]},
                {"species": [{"element": "O", "occu": 1}], "abc": [0.7, 0, 0.25]},
                {"species": [{"element": "O", "occu": 1}], "abc": [0, 0.3, 0.25]},
            ],
        }
    )


# parse_composition tests


class TestParseComposition:
    """Tests for parse_composition function."""

    def test_basic_properties(self) -> None:
        """Parse formula and verify all basic properties."""
        result = parse_composition("Fe2O3")
        assert result["formula"] == "Fe2 O3"
        assert result["reduced_formula"] == "Fe2O3"
        assert result["chemical_system"] == "Fe-O"
        assert result["num_atoms"] == 5.0
        assert result["num_elements"] == 2
        assert "Fe" in result["species"]
        assert "O" in result["species"]

    def test_anonymous_formula_reduction(self) -> None:
        """Anonymous formula reduces: Fe4O6 and Fe2O3 give same result."""
        large = parse_composition("Fe4O6")
        small = parse_composition("Fe2O3")
        assert large["anonymous_formula"] == small["anonymous_formula"] == "A2B3"
        assert large["reduced_formula"] == small["reduced_formula"]

    def test_hill_formula(self) -> None:
        """Hill formula: C first, H second, then alphabetical."""
        assert parse_composition("C6H12O6")["hill_formula"] == "C6 H12 O6"

    def test_weight(self) -> None:
        """Molecular weight: H2O ≈ 18.015 amu."""
        assert 17.9 < parse_composition("H2O")["weight"] < 18.1


# get_structure_metadata tests


class TestGetStructureMetadata:
    """Tests for get_structure_metadata function."""

    def test_all_metadata_fields(self, nacl_json: str) -> None:
        """Verify all metadata fields are correct."""
        result = get_structure_metadata(nacl_json)

        # Formula fields
        assert result["formula"] == "NaCl"
        assert result["formula_anonymous"] == "AB"  # Na (0.93) < Cl (3.16)
        assert result["formula_hill"] == "Cl Na"
        assert result["chemical_system"] == "Cl-Na"

        # Element/site counts
        assert sorted(result["elements"]) == ["Cl", "Na"]
        assert result["n_elements"] == 2
        assert result["n_sites"] == 2
        assert result["is_ordered"] is True

        # Physical properties
        assert abs(result["volume"] - 5.64**3) < 0.1
        assert result["density"] is not None and result["density"] > 0
        assert 58 < result["mass"] < 59  # Na (~23) + Cl (~35.5)

    def test_binary_structure(self, fe2o3_json: str) -> None:
        """Test Fe2O3 structure metadata."""
        result = get_structure_metadata(fe2o3_json)
        assert result["formula_anonymous"] == "A2B3"  # Fe (1.83) < O (3.44)
        assert result["n_sites"] == 5

    def test_spacegroup_optional(self, nacl_json: str) -> None:
        """Spacegroup computation is optional and expensive."""
        without_sg = get_structure_metadata(nacl_json, compute_spacegroup=False)
        assert "spacegroup_number" not in without_sg

        with_sg = get_structure_metadata(nacl_json, compute_spacegroup=True)
        assert with_sg["spacegroup_number"] == 221  # Pm-3m

    def test_consistency_with_parse_composition(self, nacl_json: str) -> None:
        """Metadata matches parse_composition for same formula."""
        metadata = get_structure_metadata(nacl_json)
        comp = parse_composition("NaCl")
        assert metadata["formula"] == comp["reduced_formula"]
        assert metadata["formula_anonymous"] == comp["anonymous_formula"]
        assert metadata["chemical_system"] == comp["chemical_system"]


# Parametrized anonymous formula tests


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        # Binary (sorted by electronegativity)
        ("Fe2O3", "A2B3"),
        ("NaCl", "AB"),
        ("H2O", "A2B"),
        ("MgO", "AB"),
        ("SiO2", "AB2"),
        ("Al2O3", "A2B3"),
        # Ternary/quaternary
        ("BaTiO3", "ABC3"),
        ("LiFePO4", "ABCD4"),
        ("CaCO3", "ABC3"),
        # Single element
        ("Cu", "A"),
        # Reduction (Fe4O6 → A2B3, not A4B6)
        ("Fe4O6", "A2B3"),
    ],
)
def test_anonymous_formula(formula: str, expected: str) -> None:
    """Anonymous formula: elements sorted by electronegativity, then A, B, C..."""
    assert parse_composition(formula)["anonymous_formula"] == expected
