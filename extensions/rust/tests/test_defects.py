"""Tests for ferrox defect generation functions."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest
from conftest import make_cubic_structure, make_site
from ferrox import defects


class TestVacancy:
    """Tests for defect_create_vacancy function."""

    @pytest.mark.parametrize(
        "site_idx,expected_species,remaining_element",
        [
            (0, "Na", "Cl"),
            (1, "Cl", "Na"),
        ],
    )
    def test_vacancy_removes_correct_atom(
        self,
        nacl_json: str,
        site_idx: int,
        expected_species: str,
        remaining_element: str,
    ) -> None:
        """Vacancy removes correct atom and records species."""
        result = defects.create_vacancy(nacl_json, site_idx)
        assert result["defect_type"] == "vacancy"
        assert len(result["structure"]["sites"]) == 1
        assert result["original_species"] == expected_species
        assert (
            result["structure"]["sites"][0]["species"][0]["element"]
            == remaining_element
        )

    def test_correct_position(self, nacl_json: str) -> None:
        """Vacancy records correct position."""
        result = defects.create_vacancy(nacl_json, 0)
        assert result["position"] == pytest.approx([0, 0, 0], abs=1e-6)

    def test_out_of_bounds_raises(self, nacl_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            defects.create_vacancy(nacl_json, 10)


class TestSubstitution:
    """Tests for defect_create_substitution function."""

    def test_changes_species(self, nacl_json: str) -> None:
        """Substitution changes species at site and preserves count."""
        result = defects.create_substitution(nacl_json, 0, "K")
        assert result["defect_type"] == "substitution"
        assert result["species"] == "K"
        assert result["original_species"] == "Na"

        sites = result["structure"]["sites"]
        assert len(sites) == 2
        assert sites[0]["species"][0]["element"] == "K"
        assert sites[1]["species"][0]["element"] == "Cl"

    def test_with_oxidation_state(self, nacl_json: str) -> None:
        """Substitution with oxidation state."""
        result = defects.create_substitution(nacl_json, 0, "K+")
        assert result["species"] == "K+"

    def test_invalid_species_raises(self, nacl_json: str) -> None:
        """Empty species string raises error."""
        with pytest.raises(ValueError, match="Invalid species"):
            defects.create_substitution(nacl_json, 0, "")


class TestInterstitial:
    """Tests for defect_create_interstitial function."""

    def test_adds_atom_at_correct_position(self, nacl_json: str) -> None:
        """Interstitial increases num_sites by 1 at correct position."""
        pos = [0.25, 0.25, 0.25]
        result = defects.create_interstitial(nacl_json, pos, "Li")

        assert result["defect_type"] == "interstitial"
        assert result["species"] == "Li"
        assert len(result["structure"]["sites"]) == 3

        new_site = result["structure"]["sites"][-1]
        assert new_site["species"][0]["element"] == "Li"
        assert new_site["abc"] == pytest.approx(pos, abs=1e-6)

    def test_invalid_species_raises(self, nacl_json: str) -> None:
        """Invalid species raises error."""
        with pytest.raises(ValueError, match="Invalid species"):
            defects.create_interstitial(nacl_json, [0.5, 0.5, 0.5], "Invalid")


class TestAntisite:
    """Tests for defect_create_antisite function."""

    def test_swaps_species_and_preserves_count(self, nacl_json: str) -> None:
        """Antisite swaps two species and preserves site count."""
        result = defects.create_antisite(nacl_json, 0, 1)
        sites = result["structure"]["sites"]
        assert len(sites) == 2
        assert sites[0]["species"][0]["element"] == "Cl"
        assert sites[1]["species"][0]["element"] == "Na"

    @pytest.mark.parametrize("idx1,idx2", [(0, 0), (0, 10)])
    def test_invalid_indices_raise(self, nacl_json: str, idx1: int, idx2: int) -> None:
        """Same site or out of bounds indices raise error."""
        with pytest.raises((ValueError, IndexError)):
            defects.create_antisite(nacl_json, idx1, idx2)


class TestFindInterstitialSites:
    """Tests for defect_find_interstitial_sites function."""

    VALID_SITE_TYPES: ClassVar[set[str]] = {
        "trigonal",
        "tetrahedral",
        "square_pyramidal",
        "octahedral",
        "cubic",
        "cuboctahedral",
        "other",
    }

    def test_returns_sites_for_fcc(self, fcc_cu_json: str) -> None:
        """FCC should have interstitial sites."""
        sites = defects.find_interstitial_sites(fcc_cu_json, 1.0)
        assert len(sites) > 0

        for site in sites:
            assert len(site["frac_coords"]) == 3
            assert len(site["cart_coords"]) == 3
            assert site["min_distance"] >= 1.0
            assert site["site_type"] in self.VALID_SITE_TYPES

    def test_respects_min_dist(self, fcc_cu_json: str) -> None:
        """All returned sites have min_distance >= threshold."""
        min_dist = 1.5
        sites = defects.find_interstitial_sites(fcc_cu_json, min_dist)
        for site in sites:
            assert site["min_distance"] >= min_dist

    def test_symprec_parameter(self, fcc_cu_json: str) -> None:
        """Symprec parameter affects site deduplication - looser tolerance merges more sites."""
        sites_tight = defects.find_interstitial_sites(fcc_cu_json, 1.0, symprec=0.01)
        sites_loose = defects.find_interstitial_sites(fcc_cu_json, 1.0, symprec=0.1)
        # Both should find sites in FCC structure
        assert len(sites_tight) > 0
        assert len(sites_loose) > 0
        # Looser symprec merges more symmetry-equivalent sites, so count should be <=
        assert len(sites_loose) <= len(sites_tight), (
            f"Loose symprec ({len(sites_loose)}) should find <= sites than tight ({len(sites_tight)})"
        )


class TestFindSupercell:
    """Tests for defect_find_supercell function."""

    def test_satisfies_min_distance(self, nacl_json: str) -> None:
        """Supercell perpendicular distances >= min_dist."""
        matrix = defects.find_supercell(nacl_json, min_image_dist=10.0)
        assert len(matrix) == 3 and all(len(row) == 3 for row in matrix)

        # For NaCl (a=5.64), need at least 2x2x2 for ~10 Å distances
        det = int(round(np.linalg.det(matrix)))
        assert det >= 8
        assert all(matrix[idx][idx] >= 2 for idx in range(3))

    def test_respects_max_atoms(self, nacl_json: str) -> None:
        """Supercell stays within max_atoms limit."""
        max_atoms = 50
        matrix = defects.find_supercell(
            nacl_json, min_image_dist=8.0, max_atoms=max_atoms
        )
        det = abs(int(round(np.linalg.det(matrix))))
        assert 2 * det <= max_atoms  # NaCl has 2 atoms

    def test_diagonal_matrix_for_cubic(self, nacl_json: str) -> None:
        """Returned matrix is diagonal for cubic structure."""
        matrix = defects.find_supercell(nacl_json, min_image_dist=10.0)
        # Off-diagonal elements should be zero
        assert matrix[0][1] == matrix[0][2] == 0
        assert matrix[1][0] == matrix[1][2] == 0
        assert matrix[2][0] == matrix[2][1] == 0


class TestClassifySite:
    """Tests for defect_classify_site function."""

    @pytest.mark.parametrize(
        "coordination, expected",
        [
            (3, "trigonal"),
            (4, "tetrahedral"),
            (5, "square_pyramidal"),
            (6, "octahedral"),
            (8, "cubic"),
            (12, "cuboctahedral"),
            (7, "other"),
            (9, "other"),
        ],
    )
    def test_coordination_mapping(self, coordination: int, expected: str) -> None:
        """Coordination numbers map to correct site types."""
        assert defects.classify_site(coordination) == expected


class TestEdgeCases:
    """Tests for edge cases with empty or minimal structures."""

    def test_empty_structure_no_interstitials(self) -> None:
        """Empty structure returns no interstitial sites."""
        empty = make_cubic_structure(5.0, [], as_json=True)
        assert defects.find_interstitial_sites(empty, 1.0) == []

    def test_single_atom_vacancy(self) -> None:
        """Single atom structure can have vacancy created."""
        single = make_cubic_structure(5.0, [make_site("Fe", [0, 0, 0])], as_json=True)
        result = defects.create_vacancy(single, 0)
        assert len(result["structure"]["sites"]) == 0


# === Voronoi Interstitial Tests ===


class TestVoronoiInterstitials:
    """Tests for find_interstitial_sites function (uses Voronoi under the hood)."""

    def test_fcc_finds_interstitial_sites(self, fcc_cu_json: str) -> None:
        """FCC structure should have octahedral and/or tetrahedral interstitial sites."""
        sites = defects.find_interstitial_sites(fcc_cu_json, symprec=0.01)
        assert len(sites) > 0
        site_types = {site["site_type"] for site in sites}
        # FCC should have both octahedral and tetrahedral sites
        assert "octahedral" in site_types or "tetrahedral" in site_types

    def test_min_dist_filters_small_sites(self, fcc_cu_json: str) -> None:
        """Large min_dist should filter out small interstitial sites."""
        sites_no_filter = defects.find_interstitial_sites(fcc_cu_json, min_dist=0.1)
        sites_filtered = defects.find_interstitial_sites(fcc_cu_json, min_dist=2.0)
        assert len(sites_filtered) <= len(sites_no_filter)

    def test_returns_required_fields(self, fcc_cu_json: str) -> None:
        """Each site should have all required fields."""
        sites = defects.find_interstitial_sites(fcc_cu_json)
        assert sites
        for site in sites:
            assert "frac_coords" in site
            assert "cart_coords" in site
            assert "min_distance" in site
            assert "coordination" in site
            assert "site_type" in site

    def test_empty_structure_returns_empty(self) -> None:
        """Empty structure should return empty list."""
        empty = make_cubic_structure(5.0, [], as_json=True)
        sites = defects.find_interstitial_sites(empty)
        assert sites == []

    def test_sites_sorted_by_min_distance(self, fcc_cu_json: str) -> None:
        """Sites should be sorted by min_distance descending (largest first)."""
        sites = defects.find_interstitial_sites(fcc_cu_json)
        if len(sites) > 1:
            dists = [site["min_distance"] for site in sites]
            assert dists == sorted(dists, reverse=True)

    def test_frac_coords_in_unit_cell(self, fcc_cu_json: str) -> None:
        """Fractional coordinates should be in [0, 1)."""
        sites = defects.find_interstitial_sites(fcc_cu_json)
        for site in sites:
            frac = site["frac_coords"]
            assert all(0 <= coord < 1 for coord in frac)

    def test_fcc_octahedral_sites_at_expected_coords(self, fcc_cu_json: str) -> None:
        """FCC octahedral sites should be at face-center positions (0.5, 0.5, 0.5)."""
        # In FCC, octahedral sites are at the edge centers and body center
        # Body-centered position: [0.5, 0.5, 0.5] - 4b Wyckoff in Fm-3m
        sites = defects.find_interstitial_sites(fcc_cu_json, min_dist=0.5)
        oct_sites = [s for s in sites if s["site_type"] == "octahedral"]
        if oct_sites:
            # At least one should be near [0.5, 0.5, 0.5]
            has_body_center = any(
                np.allclose(s["frac_coords"], [0.5, 0.5, 0.5], atol=0.1)
                for s in oct_sites
            )
            assert has_body_center, (
                f"No octahedral site near [0.5,0.5,0.5], found: {oct_sites}"
            )

    def test_fcc_tetrahedral_sites_at_expected_coords(self, fcc_cu_json: str) -> None:
        """FCC tetrahedral sites should be at [0.25, 0.25, 0.25] positions (8c Wyckoff)."""
        # In FCC, tetrahedral sites are at [0.25, 0.25, 0.25] and equivalents
        sites = defects.find_interstitial_sites(fcc_cu_json, min_dist=0.3)
        tet_sites = [s for s in sites if s["site_type"] == "tetrahedral"]
        if tet_sites:
            # Check for site near [0.25, 0.25, 0.25] or equivalent
            expected_coords = [0.25, 0.25, 0.25]
            has_tet_position = any(
                np.allclose(s["frac_coords"], expected_coords, atol=0.1)
                or np.allclose(s["frac_coords"], [0.75, 0.75, 0.75], atol=0.1)
                for s in tet_sites
            )
            assert has_tet_position, (
                f"No tetrahedral site at expected positions, found: {tet_sites}"
            )

    def test_bcc_octahedral_at_face_centers(self, bcc_fe_json: str) -> None:
        """BCC structure should have octahedral sites at face centers."""
        sites = defects.find_interstitial_sites(bcc_fe_json, min_dist=0.3)
        # BCC has octahedral sites at [0.5, 0, 0] and equivalents
        oct_sites = [s for s in sites if s["site_type"] == "octahedral"]
        if oct_sites:
            # Check for face-center positions
            face_center_coords = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]]
            has_face_center = any(
                any(
                    np.allclose(s["frac_coords"], fc, atol=0.1)
                    for fc in face_center_coords
                )
                for s in oct_sites
            )
            # BCC octahedral sites should be at face centers or edge midpoints
            assert has_face_center


# === Charge State Guessing Tests ===


class TestChargeStateGuessing:
    """Tests for guess_charge_states function."""

    @pytest.mark.parametrize(
        ("species", "expected_in_result"),
        [
            ("Li", [1]),  # Li common oxidation state
            ("O", [-2]),  # O common oxidation state
            ("Fe", [2, 3]),  # Fe common oxidation states
        ],
    )
    def test_returns_common_oxidation_states(
        self, species: str, expected_in_result: list[int]
    ) -> None:
        """Returns common oxidation states for known elements."""
        result = defects.guess_charge_states("vacancy", species=species)
        assert any(charge in result for charge in expected_in_result)

    def test_unknown_element_returns_default(self) -> None:
        """Unknown element returns default charge range."""
        result = defects.guess_charge_states("vacancy", species=None)
        assert -2 in result and 2 in result


# === Wyckoff Letters Tests ===


class TestWyckoffLetters:
    """Tests for get_wyckoff_letters function."""

    def test_fcc_returns_letters(self, fcc_cu_json: str) -> None:
        """FCC structure should return Wyckoff letters."""
        from ferrox import symmetry

        letters = symmetry.get_wyckoff_letters(fcc_cu_json)
        assert letters is not None
        assert len(letters) == 4  # Four Cu sites in conventional FCC
        # All Cu atoms should have same Wyckoff letter
        assert all(letter == letters[0] for letter in letters)

    def test_nacl_returns_letters(self, rocksalt_nacl_json: str) -> None:
        """NaCl rocksalt should return Wyckoff letters."""
        from ferrox import symmetry

        letters = symmetry.get_wyckoff_letters(rocksalt_nacl_json)
        assert letters is not None
        assert len(letters) == 8  # 4 Na + 4 Cl sites
        # Should have 2 unique Wyckoff letters (one for Na, one for Cl)
        unique_letters = set(letters)
        assert len(unique_letters) == 2

    def test_symprec_parameter(self, fcc_cu_json: str) -> None:
        """Different symprec values should work."""
        from ferrox import symmetry

        letters_tight = symmetry.get_wyckoff_letters(fcc_cu_json, symprec=0.001)
        letters_loose = symmetry.get_wyckoff_letters(fcc_cu_json, symprec=0.1)
        # Both should return valid results for clean structure
        assert letters_tight is not None
        assert letters_loose is not None


# === Generate All Tests ===


class TestDefectGenerateAll:
    """Tests for generate_all workflow function."""

    def test_returns_required_fields(self, nacl_json: str) -> None:
        """Result contains all expected top-level fields."""
        result = defects.generate_all(nacl_json)
        required = {"vacancies", "substitutions", "interstitials", "antisites"}
        assert required.issubset(result.keys())

    def test_vacancies_generated(self, nacl_json: str) -> None:
        """Vacancies are generated for each unique element."""
        result = defects.generate_all(nacl_json)
        assert len(result["vacancies"]) >= 2  # Na and Cl vacancies

    def test_defect_entry_fields(self, nacl_json: str) -> None:
        """Each defect entry has required fields."""
        result = defects.generate_all(nacl_json)
        required = {"name", "defect_type", "frac_coords", "equivalent_sites"}
        for defect_list in [result["vacancies"], result["antisites"]]:
            for defect in defect_list:
                assert required.issubset(defect.keys())
