"""Tests for ferrox Python API - composition, structure metadata, and symmetry functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox._ferrox import (
        get_crystal_system,
        get_equivalent_sites,
        get_hall_number,
        get_pearson_symbol,
        get_site_symmetry_symbols,
        get_spacegroup_number,
        get_spacegroup_symbol,
        get_structure_metadata,
        get_symmetry_dataset,
        get_symmetry_operations,
        get_wyckoff_letters,
        parse_composition,
    )
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


# Fixtures


@pytest.fixture
def nacl_json() -> str:
    """NaCl in CsCl-type structure (Pm-3m, #221) as JSON."""
    struct = {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]]},
        "sites": [
            {"species": [{"element": "Na", "occu": 1}], "abc": [0, 0, 0]},
            {"species": [{"element": "Cl", "occu": 1}], "abc": [0.5, 0.5, 0.5]},
        ],
    }
    return json.dumps(struct)


@pytest.fixture
def fe2o3_json() -> str:
    """Fe2O3 structure as JSON (simplified)."""
    struct = {
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
    return json.dumps(struct)


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

        # Formula fields (keys match parse_composition for consistency)
        assert result["formula"] == "NaCl"
        assert result["anonymous_formula"] == "AB"  # Na (0.93) < Cl (3.16)
        assert result["hill_formula"] == "Cl Na"
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
        assert result["anonymous_formula"] == "A2B3"  # Fe (1.83) < O (3.44)
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
        assert metadata["anonymous_formula"] == comp["anonymous_formula"]
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


# Symmetry fixtures


@pytest.fixture
def fcc_cu_json() -> str:
    """FCC Cu conventional cell (4 atoms, Fm-3m #225) as JSON."""
    # Lattice constant 3.6 Å
    struct = {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[3.6, 0, 0], [0, 3.6, 0], [0, 0, 3.6]]},
        "sites": [
            {"species": [{"element": "Cu", "occu": 1}], "abc": [0.0, 0.0, 0.0]},
            {"species": [{"element": "Cu", "occu": 1}], "abc": [0.5, 0.5, 0.0]},
            {"species": [{"element": "Cu", "occu": 1}], "abc": [0.5, 0.0, 0.5]},
            {"species": [{"element": "Cu", "occu": 1}], "abc": [0.0, 0.5, 0.5]},
        ],
    }
    return json.dumps(struct)


@pytest.fixture
def bcc_fe_json() -> str:
    """BCC Fe conventional cell (2 atoms, Im-3m #229) as JSON."""
    # Lattice constant 2.87 Å
    struct = {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]]},
        "sites": [
            {"species": [{"element": "Fe", "occu": 1}], "abc": [0.0, 0.0, 0.0]},
            {"species": [{"element": "Fe", "occu": 1}], "abc": [0.5, 0.5, 0.5]},
        ],
    }
    return json.dumps(struct)


# Symmetry tests


class TestSymmetryFunctions:
    """Tests for symmetry analysis functions."""

    def test_get_spacegroup_number(self, fcc_cu_json: str, bcc_fe_json: str) -> None:
        """Test spacegroup number detection."""
        assert get_spacegroup_number(fcc_cu_json) == 225  # Fm-3m
        assert get_spacegroup_number(bcc_fe_json) == 229  # Im-3m

    def test_get_spacegroup_symbol(self, fcc_cu_json: str, bcc_fe_json: str) -> None:
        """Test spacegroup symbol detection (moyo uses spaces)."""
        assert get_spacegroup_symbol(fcc_cu_json) == "F m -3 m"
        assert get_spacegroup_symbol(bcc_fe_json) == "I m -3 m"

    def test_get_hall_number(self, fcc_cu_json: str) -> None:
        """Test Hall number is in valid range."""
        hall = get_hall_number(fcc_cu_json)
        assert 1 <= hall <= 530

    def test_get_pearson_symbol(self, fcc_cu_json: str, bcc_fe_json: str) -> None:
        """Test Pearson symbol detection."""
        assert get_pearson_symbol(fcc_cu_json) == "cF4"  # cubic, F-centered, 4 atoms
        assert get_pearson_symbol(bcc_fe_json) == "cI2"  # cubic, I-centered, 2 atoms

    def test_get_wyckoff_letters(self, fcc_cu_json: str) -> None:
        """Test Wyckoff letter assignment."""
        wyckoffs = get_wyckoff_letters(fcc_cu_json)
        assert len(wyckoffs) == 4
        # All Cu atoms in FCC should have same Wyckoff position
        assert len(set(wyckoffs)) == 1

    def test_get_site_symmetry_symbols(self, fcc_cu_json: str) -> None:
        """Test site symmetry symbol assignment."""
        symbols = get_site_symmetry_symbols(fcc_cu_json)
        assert len(symbols) == 4
        # All Cu atoms in FCC should have same site symmetry
        assert len(set(symbols)) == 1

    def test_get_symmetry_operations(self, fcc_cu_json: str) -> None:
        """Test symmetry operations retrieval."""
        ops = get_symmetry_operations(fcc_cu_json)
        assert len(ops) > 0
        # Each operation is (rotation, translation) tuple
        for rot, trans in ops:
            assert len(rot) == 3  # 3x3 matrix
            assert len(rot[0]) == 3
            assert len(trans) == 3  # 3-vector

    def test_get_equivalent_sites(self, fcc_cu_json: str, nacl_json: str) -> None:
        """Test equivalent site detection."""
        # FCC Cu: all 4 atoms equivalent
        orbits_cu = get_equivalent_sites(fcc_cu_json)
        assert len(orbits_cu) == 4
        assert len(set(orbits_cu)) == 1  # All map to same representative

        # NaCl: 2 inequivalent sites (Na and Cl)
        orbits_nacl = get_equivalent_sites(nacl_json)
        assert len(orbits_nacl) == 2
        assert len(set(orbits_nacl)) == 2  # Different representatives

    def test_get_crystal_system(self, fcc_cu_json: str, bcc_fe_json: str) -> None:
        """Test crystal system detection."""
        assert get_crystal_system(fcc_cu_json) == "cubic"
        assert get_crystal_system(bcc_fe_json) == "cubic"


class TestGetSymmetryDataset:
    """Tests for get_symmetry_dataset function (returns all symmetry info)."""

    def test_all_fields_present(self, fcc_cu_json: str) -> None:
        """Verify all expected fields in symmetry dataset."""
        dataset = get_symmetry_dataset(fcc_cu_json)

        # Check all expected keys are present
        expected_keys = {
            "spacegroup_number",
            "spacegroup_symbol",
            "hall_number",
            "pearson_symbol",
            "crystal_system",
            "wyckoff_letters",
            "site_symmetry_symbols",
            "equivalent_sites",
            "symmetry_operations",
            "num_operations",
        }
        assert expected_keys.issubset(dataset.keys())

    def test_dataset_values(self, fcc_cu_json: str) -> None:
        """Verify symmetry dataset values for FCC Cu."""
        dataset = get_symmetry_dataset(fcc_cu_json)

        assert dataset["spacegroup_number"] == 225
        assert dataset["spacegroup_symbol"] == "F m -3 m"
        assert dataset["pearson_symbol"] == "cF4"
        assert dataset["crystal_system"] == "cubic"
        assert len(dataset["wyckoff_letters"]) == 4
        assert len(dataset["equivalent_sites"]) == 4
        assert dataset["num_operations"] == len(dataset["symmetry_operations"])

    def test_dataset_matches_individual_calls(self, nacl_json: str) -> None:
        """Dataset contains same info as individual calls."""
        dataset = get_symmetry_dataset(nacl_json)

        assert dataset["spacegroup_number"] == get_spacegroup_number(nacl_json)
        assert dataset["spacegroup_symbol"] == get_spacegroup_symbol(nacl_json)
        assert dataset["pearson_symbol"] == get_pearson_symbol(nacl_json)
        assert dataset["crystal_system"] == get_crystal_system(nacl_json)
        assert dataset["wyckoff_letters"] == get_wyckoff_letters(nacl_json)
        assert dataset["equivalent_sites"] == get_equivalent_sites(nacl_json)
