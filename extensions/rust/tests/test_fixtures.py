"""Tests to validate fixture correctness and structure parsing."""

from __future__ import annotations

import json

import ferrox
import pytest
from conftest import (
    lattice_from_matrix,
    make_cubic_structure,
    make_site,
    make_structure,
)


class TestFixtureValidity:
    """Verify fixtures produce valid pymatgen-compatible structure JSON."""

    @pytest.mark.parametrize("fixture_name", [
        "nacl_json",
        "fcc_cu_json",
        "rocksalt_nacl_json",
        "nacl_with_oxi_json",
        "bcc_fe_json",
        "single_fe_json",
        "fe2o3_json",
        "disordered_json",
        "lifepo4_json",
    ])
    def test_json_fixtures_parseable(self, fixture_name: str, request: pytest.FixtureRequest) -> None:
        """All JSON fixtures should be parseable by ferrox."""
        json_str = request.getfixturevalue(fixture_name)
        # Should not raise - ferrox can parse the structure
        metadata = ferrox.get_structure_metadata(json_str)
        assert "n_sites" in metadata
        assert metadata["n_sites"] > 0 or fixture_name == "disordered_json"

    @pytest.mark.parametrize("fixture_name,expected_sites", [
        ("nacl_json", 2),
        ("fcc_cu_json", 4),
        ("rocksalt_nacl_json", 8),
        ("nacl_with_oxi_json", 2),
        ("bcc_fe_json", 2),
        ("single_fe_json", 1),
        ("fe2o3_json", 5),
        ("lifepo4_json", 8),
    ])
    def test_fixture_site_counts(
        self, fixture_name: str, expected_sites: int, request: pytest.FixtureRequest
    ) -> None:
        """Fixtures have correct number of sites."""
        json_str = request.getfixturevalue(fixture_name)
        metadata = ferrox.get_structure_metadata(json_str)
        assert metadata["n_sites"] == expected_sites

    @pytest.mark.parametrize("fixture_name,expected_elements", [
        ("nacl_json", {"Na", "Cl"}),
        ("fcc_cu_json", {"Cu"}),
        ("rocksalt_nacl_json", {"Na", "Cl"}),
        ("bcc_fe_json", {"Fe"}),
        ("fe2o3_json", {"Fe", "O"}),
        ("lifepo4_json", {"Li", "Fe", "P", "O"}),
    ])
    def test_fixture_elements(
        self, fixture_name: str, expected_elements: set, request: pytest.FixtureRequest
    ) -> None:
        """Fixtures contain expected elements."""
        json_str = request.getfixturevalue(fixture_name)
        metadata = ferrox.get_structure_metadata(json_str)
        actual_elements = set(metadata["elements"])
        assert actual_elements == expected_elements


class TestHelperFunctions:
    """Verify helper functions produce valid structures."""

    def test_make_site_basic(self) -> None:
        """make_site creates valid site dict."""
        site = make_site("Fe", [0.5, 0.5, 0.5])
        assert site["species"][0]["element"] == "Fe"
        assert site["species"][0]["occu"] == 1.0
        assert site["abc"] == [0.5, 0.5, 0.5]
        assert "oxidation_state" not in site["species"][0]

    def test_make_site_with_oxidation(self) -> None:
        """make_site with oxidation_state includes it."""
        site = make_site("Fe", [0, 0, 0], oxidation_state=3)
        assert site["species"][0]["oxidation_state"] == 3

    def test_make_site_with_occupancy(self) -> None:
        """make_site with custom occupancy."""
        site = make_site("Fe", [0, 0, 0], occu=0.5)
        assert site["species"][0]["occu"] == 0.5

    def test_make_structure_dict(self) -> None:
        """make_structure returns dict by default."""
        struct = make_structure(
            {"matrix": [[5, 0, 0], [0, 5, 0], [0, 0, 5]]},
            [make_site("Fe", [0, 0, 0])],
        )
        assert isinstance(struct, dict)
        assert struct["@class"] == "Structure"
        assert len(struct["sites"]) == 1

    def test_make_structure_json(self) -> None:
        """make_structure with as_json=True returns string."""
        struct = make_structure(
            {"matrix": [[5, 0, 0], [0, 5, 0], [0, 0, 5]]},
            [make_site("Fe", [0, 0, 0])],
            as_json=True,
        )
        assert isinstance(struct, str)
        parsed = json.loads(struct)
        assert parsed["@class"] == "Structure"

    def test_make_cubic_structure(self) -> None:
        """make_cubic_structure creates cubic lattice."""
        struct = make_cubic_structure(4.0, [make_site("Cu", [0, 0, 0])])
        matrix = struct["lattice"]["matrix"]
        # Diagonal elements should be 4.0
        assert matrix[0][0] == matrix[1][1] == matrix[2][2] == 4.0
        # Off-diagonal should be 0
        assert matrix[0][1] == matrix[0][2] == 0
        assert matrix[1][0] == matrix[1][2] == 0
        assert matrix[2][0] == matrix[2][1] == 0

    def test_lattice_from_matrix(self) -> None:
        """lattice_from_matrix creates structure with H atom."""
        struct = lattice_from_matrix([[3, 0, 0], [0, 4, 0], [0, 0, 5]])
        assert struct["lattice"]["matrix"] == [[3, 0, 0], [0, 4, 0], [0, 0, 5]]
        assert struct["sites"][0]["species"][0]["element"] == "H"


class TestCrystallographicAccuracy:
    """Verify crystallographic parameters are reasonable."""

    def test_nacl_lattice_parameter(self, nacl_json: str) -> None:
        """NaCl lattice parameter is ~5.64 Å."""
        data = json.loads(nacl_json)
        lattice_param = data["lattice"]["matrix"][0][0]
        assert lattice_param == pytest.approx(5.64, abs=0.01)

    def test_fcc_cu_lattice_parameter(self, fcc_cu_json: str) -> None:
        """FCC Cu lattice parameter is ~3.6 Å."""
        data = json.loads(fcc_cu_json)
        lattice_param = data["lattice"]["matrix"][0][0]
        assert lattice_param == pytest.approx(3.6, abs=0.01)

    def test_bcc_fe_lattice_parameter(self, bcc_fe_json: str) -> None:
        """BCC Fe lattice parameter is ~2.87 Å."""
        data = json.loads(bcc_fe_json)
        lattice_param = data["lattice"]["matrix"][0][0]
        assert lattice_param == pytest.approx(2.87, abs=0.01)

    def test_fcc_cu_has_four_atoms(self, fcc_cu_json: str) -> None:
        """FCC conventional cell has 4 atoms."""
        data = json.loads(fcc_cu_json)
        assert len(data["sites"]) == 4

    def test_rocksalt_has_coordination_six(self, rocksalt_nacl_json: str) -> None:
        """Rocksalt structure should have CN=6."""
        # Use ferrox to verify coordination
        cn_list = ferrox.get_coordination_numbers(rocksalt_nacl_json, cutoff=3.5)
        # All atoms should have CN=6 in rocksalt
        assert all(cn == 6 for cn in cn_list)

    def test_nacl_with_oxi_charges(self, nacl_with_oxi_json: str) -> None:
        """NaCl with oxidation states has Na+ and Cl-."""
        data = json.loads(nacl_with_oxi_json)
        na_site = data["sites"][0]
        cl_site = data["sites"][1]
        assert na_site["species"][0]["oxidation_state"] == 1
        assert cl_site["species"][0]["oxidation_state"] == -1


class TestDictVsJsonFixtures:
    """Verify dict and JSON fixture pairs are consistent."""

    def test_nacl_consistency(self, nacl_structure: dict, nacl_json: str) -> None:
        """nacl_structure and nacl_json represent same structure."""
        from_json = json.loads(nacl_json)
        assert nacl_structure["lattice"] == from_json["lattice"]
        assert len(nacl_structure["sites"]) == len(from_json["sites"])

    def test_fcc_cu_consistency(self, fcc_cu_structure: dict, fcc_cu_json: str) -> None:
        """fcc_cu_structure and fcc_cu_json represent same structure."""
        from_json = json.loads(fcc_cu_json)
        assert fcc_cu_structure["lattice"] == from_json["lattice"]
        assert len(fcc_cu_structure["sites"]) == len(from_json["sites"])
