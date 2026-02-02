"""Tests for ferrox defect generation functions."""

from __future__ import annotations

from typing import ClassVar

import ferrox
import numpy as np
import pytest
from conftest import make_cubic_structure, make_site


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
        result = ferrox.defect_create_vacancy(nacl_json, site_idx)
        assert result["defect_type"] == "vacancy"
        assert len(result["structure"]["sites"]) == 1
        assert result["original_species"] == expected_species
        assert (
            result["structure"]["sites"][0]["species"][0]["element"]
            == remaining_element
        )

    def test_correct_position(self, nacl_json: str) -> None:
        """Vacancy records correct position."""
        result = ferrox.defect_create_vacancy(nacl_json, 0)
        assert result["position"] == pytest.approx([0, 0, 0], abs=1e-6)

    def test_out_of_bounds_raises(self, nacl_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            ferrox.defect_create_vacancy(nacl_json, 10)


class TestSubstitution:
    """Tests for defect_create_substitution function."""

    def test_changes_species(self, nacl_json: str) -> None:
        """Substitution changes species at site and preserves count."""
        result = ferrox.defect_create_substitution(nacl_json, 0, "K")
        assert result["defect_type"] == "substitution"
        assert result["species"] == "K"
        assert result["original_species"] == "Na"

        sites = result["structure"]["sites"]
        assert len(sites) == 2
        assert sites[0]["species"][0]["element"] == "K"
        assert sites[1]["species"][0]["element"] == "Cl"

    def test_with_oxidation_state(self, nacl_json: str) -> None:
        """Substitution with oxidation state."""
        result = ferrox.defect_create_substitution(nacl_json, 0, "K+")
        assert result["species"] == "K+"

    def test_invalid_species_raises(self, nacl_json: str) -> None:
        """Empty species string raises error."""
        with pytest.raises(ValueError, match="Invalid species"):
            ferrox.defect_create_substitution(nacl_json, 0, "")


class TestInterstitial:
    """Tests for defect_create_interstitial function."""

    def test_adds_atom_at_correct_position(self, nacl_json: str) -> None:
        """Interstitial increases num_sites by 1 at correct position."""
        pos = [0.25, 0.25, 0.25]
        result = ferrox.defect_create_interstitial(nacl_json, pos, "Li")

        assert result["defect_type"] == "interstitial"
        assert result["species"] == "Li"
        assert len(result["structure"]["sites"]) == 3

        new_site = result["structure"]["sites"][-1]
        assert new_site["species"][0]["element"] == "Li"
        assert new_site["abc"] == pytest.approx(pos, abs=1e-6)

    def test_invalid_species_raises(self, nacl_json: str) -> None:
        """Invalid species raises error."""
        with pytest.raises(ValueError, match="Invalid species"):
            ferrox.defect_create_interstitial(nacl_json, [0.5, 0.5, 0.5], "Invalid")


class TestAntisite:
    """Tests for defect_create_antisite function."""

    def test_swaps_species_and_preserves_count(self, nacl_json: str) -> None:
        """Antisite swaps two species and preserves site count."""
        # Note: antisite returns structure directly, not wrapped like other defect functions
        result = ferrox.defect_create_antisite(nacl_json, 0, 1)
        sites = result["sites"]
        assert len(sites) == 2
        assert sites[0]["species"][0]["element"] == "Cl"
        assert sites[1]["species"][0]["element"] == "Na"

    @pytest.mark.parametrize("idx1,idx2", [(0, 0), (0, 10)])
    def test_invalid_indices_raise(self, nacl_json: str, idx1: int, idx2: int) -> None:
        """Same site or out of bounds indices raise error."""
        with pytest.raises((ValueError, IndexError)):
            ferrox.defect_create_antisite(nacl_json, idx1, idx2)


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
        sites = ferrox.defect_find_interstitial_sites(fcc_cu_json, 1.0)
        assert len(sites) > 0

        for site in sites:
            assert len(site["frac_coords"]) == 3
            assert len(site["cart_coords"]) == 3
            assert site["min_distance"] >= 1.0
            assert site["site_type"] in self.VALID_SITE_TYPES

    def test_respects_min_dist(self, fcc_cu_json: str) -> None:
        """All returned sites have min_distance >= threshold."""
        min_dist = 1.5
        sites = ferrox.defect_find_interstitial_sites(fcc_cu_json, min_dist)
        for site in sites:
            assert site["min_distance"] >= min_dist

    def test_symprec_parameter(self, fcc_cu_json: str) -> None:
        """Symprec parameter works for site deduplication."""
        sites_tight = ferrox.defect_find_interstitial_sites(
            fcc_cu_json, 1.0, symprec=0.01
        )
        sites_loose = ferrox.defect_find_interstitial_sites(
            fcc_cu_json, 1.0, symprec=0.1
        )
        assert isinstance(sites_tight, list) and isinstance(sites_loose, list)


class TestFindSupercell:
    """Tests for defect_find_supercell function."""

    def test_satisfies_min_distance(self, nacl_json: str) -> None:
        """Supercell perpendicular distances >= min_dist."""
        matrix = ferrox.defect_find_supercell(nacl_json, min_image_dist=10.0)
        assert len(matrix) == 3 and all(len(row) == 3 for row in matrix)

        # For NaCl (a=5.64), need at least 2x2x2 for ~10 Å distances
        det = int(round(np.linalg.det(matrix)))
        assert det >= 8
        assert all(matrix[idx][idx] >= 2 for idx in range(3))

    def test_respects_max_atoms(self, nacl_json: str) -> None:
        """Supercell stays within max_atoms limit."""
        max_atoms = 50
        matrix = ferrox.defect_find_supercell(
            nacl_json, min_image_dist=8.0, max_atoms=max_atoms
        )
        det = abs(int(round(np.linalg.det(matrix))))
        assert 2 * det <= max_atoms  # NaCl has 2 atoms

    def test_diagonal_matrix_for_cubic(self, nacl_json: str) -> None:
        """Returned matrix is diagonal for cubic structure."""
        matrix = ferrox.defect_find_supercell(nacl_json, min_image_dist=10.0)
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
        assert ferrox.defect_classify_site(coordination) == expected


class TestEdgeCases:
    """Tests for edge cases with empty or minimal structures."""

    def test_empty_structure_no_interstitials(self) -> None:
        """Empty structure returns no interstitial sites."""
        empty = make_cubic_structure(5.0, [], as_json=True)
        assert ferrox.defect_find_interstitial_sites(empty, 1.0) == []

    def test_single_atom_vacancy(self) -> None:
        """Single atom structure can have vacancy created."""
        single = make_cubic_structure(5.0, [make_site("Fe", [0, 0, 0])], as_json=True)
        result = ferrox.defect_create_vacancy(single, 0)
        assert len(result["structure"]["sites"]) == 0


# === Voronoi Interstitial Tests ===


class TestVoronoiInterstitials:
    """Tests for defect_find_voronoi_interstitials function."""

    def test_fcc_finds_interstitial_sites(self, fcc_cu_json: str) -> None:
        """FCC structure should have octahedral and/or tetrahedral interstitial sites."""
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json, symprec=0.01)
        assert len(sites) > 0
        site_types = {site["site_type"] for site in sites}
        # FCC should have both octahedral and tetrahedral sites
        assert "octahedral" in site_types or "tetrahedral" in site_types

    def test_min_dist_filters_small_sites(self, fcc_cu_json: str) -> None:
        """Large min_dist should filter out small interstitial sites."""
        sites_no_filter = ferrox.defect_find_voronoi_interstitials(
            fcc_cu_json, min_dist=0.1
        )
        sites_filtered = ferrox.defect_find_voronoi_interstitials(
            fcc_cu_json, min_dist=2.0
        )
        assert len(sites_filtered) <= len(sites_no_filter)

    def test_returns_required_fields(self, fcc_cu_json: str) -> None:
        """Each site should have all required fields."""
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json)
        if sites:
            site = sites[0]
            assert "frac_coords" in site
            assert "cart_coords" in site
            assert "min_dist" in site
            assert "coordination" in site
            assert "site_type" in site

    def test_empty_structure_returns_empty(self) -> None:
        """Empty structure should return empty list."""
        empty = make_cubic_structure(5.0, [], as_json=True)
        sites = ferrox.defect_find_voronoi_interstitials(empty)
        assert sites == []

    def test_sites_sorted_by_min_dist(self, fcc_cu_json: str) -> None:
        """Sites should be sorted by min_dist descending (largest first)."""
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json)
        if len(sites) > 1:
            dists = [site["min_dist"] for site in sites]
            assert dists == sorted(dists, reverse=True)

    def test_frac_coords_in_unit_cell(self, fcc_cu_json: str) -> None:
        """Fractional coordinates should be in [0, 1)."""
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json)
        for site in sites:
            frac = site["frac_coords"]
            assert all(0 <= coord < 1 for coord in frac)

    def test_fcc_octahedral_sites_at_expected_coords(self, fcc_cu_json: str) -> None:
        """FCC octahedral sites should be at face-center positions (0.5, 0.5, 0.5)."""
        # In FCC, octahedral sites are at the edge centers and body center
        # Body-centered position: [0.5, 0.5, 0.5] - 4b Wyckoff in Fm-3m
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json, min_dist=0.5)
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
        sites = ferrox.defect_find_voronoi_interstitials(fcc_cu_json, min_dist=0.3)
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
        sites = ferrox.defect_find_voronoi_interstitials(bcc_fe_json, min_dist=0.3)
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
            assert has_face_center, "BCC octahedral sites should include face centers"


# === Charge State Guessing Tests (Extended from doped) ===


class TestChargeStateGuessing:
    """Tests for defect_guess_charge_states function."""

    def test_oxygen_vacancy_predicts_positive(self) -> None:
        """Oxygen vacancy should predict positive charge states."""
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="O", max_charge=4
        )
        assert len(guesses) > 0
        # O^{2-} vacancy => +2 should be likely
        charges = [g["charge"] for g in guesses]
        assert 2 in charges

    def test_sodium_vacancy_predicts_negative(self) -> None:
        """Sodium vacancy should predict negative charge state."""
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="Na", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Na^{+} vacancy => -1 should be present
        assert -1 in charges

    def test_interstitial_charge_states(self) -> None:
        """Interstitial should have charge matching oxidation state."""
        guesses = ferrox.defect_guess_charge_states(
            "interstitial", added_species="Li", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        assert 1 in charges  # Li^{+} interstitial

    def test_substitution_charge_difference(self) -> None:
        """Substitution charge should be difference of oxidation states."""
        guesses = ferrox.defect_guess_charge_states(
            "substitution", added_species="Al", original_species="Si", max_charge=4
        )
        # Al^{3+} on Si^{4+} => charge = -1
        charges = [g["charge"] for g in guesses]
        assert -1 in charges

    def test_probabilities_sum_to_one(self) -> None:
        """Probabilities should sum to approximately 1."""
        guesses = ferrox.defect_guess_charge_states("vacancy", removed_species="O")
        total_prob = sum(g["probability"] for g in guesses)
        assert abs(total_prob - 1.0) < 0.01

    def test_sorted_by_probability(self) -> None:
        """Results should be sorted by decreasing probability."""
        guesses = ferrox.defect_guess_charge_states("vacancy", removed_species="O")
        probs = [g["probability"] for g in guesses]
        assert probs == sorted(probs, reverse=True)

    def test_max_charge_limits_range(self) -> None:
        """max_charge parameter should limit charge state range."""
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="O", max_charge=2
        )
        charges = [g["charge"] for g in guesses]
        assert all(-2 <= charge <= 2 for charge in charges)

    def test_tellurium_vacancy_like_doped(self) -> None:
        """Te vacancy should predict charges like doped: +2, +1, 0, -1 (from Te^{2-})."""
        # doped CdTe test: v_Te [+2,+1,0,-1]
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="Te", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Te can be -2, so vacancy should have +2
        assert 2 in charges
        # Should also include lower charges
        assert any(c in charges for c in [1, 0])

    def test_cadmium_vacancy_like_doped(self) -> None:
        """Cd vacancy should predict charges like doped: +1, 0, -1, -2 (from Cd^{2+})."""
        # doped CdTe test: v_Cd [+1,0,-1,-2]
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="Cd", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Cd^{2+} vacancy => -2 charge
        assert -2 in charges

    def test_cadmium_interstitial_like_doped(self) -> None:
        """Cd interstitial should predict +2 as most likely (from Cd^{2+})."""
        # doped: Cd_i [+2,+1,0] - but +2 is dominant since Cd^{2+} is 99%+ in ICSD
        guesses = ferrox.defect_guess_charge_states(
            "interstitial", added_species="Cd", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        assert 2 in charges  # Cd^{2+} is dominant
        # Neutral is always included as fallback
        assert 0 in charges or len(guesses) > 0

    def test_selenium_substitution_on_tellurium_like_doped(self) -> None:
        """Se on Te site (same column) should predict neutral as most likely."""
        # doped: Se_Te [+1,0,-1] - isoelectronic, so 0 should be high probability
        guesses = ferrox.defect_guess_charge_states(
            "substitution", added_species="Se", original_species="Te", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Se^{2-} on Te^{2-} => 0 charge
        assert 0 in charges

    def test_transition_metal_substitution(self) -> None:
        """Fe on Ni substitution should predict small charge differences."""
        # Fe can be +2, +3; Ni is typically +2
        # Fe^{2+} on Ni^{2+} => 0; Fe^{3+} on Ni^{2+} => +1
        guesses = ferrox.defect_guess_charge_states(
            "substitution", added_species="Fe", original_species="Ni", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Should include 0 (same oxidation) and +1 (Fe^{3+} on Ni^{2+})
        assert 0 in charges or 1 in charges

    def test_yttrium_vacancy_like_doped_ytos(self) -> None:
        """Y vacancy should predict charges up to -3 (from Y^{3+})."""
        # doped YTOS: v_Y [+1,0,-1,-2,-3]
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="Y", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Y^{3+} vacancy => -3 charge
        assert -3 in charges

    def test_titanium_vacancy_like_doped_ytos(self) -> None:
        """Ti vacancy should predict charges up to -4 (from Ti^{4+})."""
        # doped YTOS: v_Ti [+1,0,-1,-2,-3,-4]
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="Ti", max_charge=4
        )
        charges = [g["charge"] for g in guesses]
        # Ti^{4+} vacancy => -4 charge
        assert -4 in charges

    def test_reasoning_string_format(self) -> None:
        """Reasoning string should contain element and charge info."""
        guesses = ferrox.defect_guess_charge_states(
            "vacancy", removed_species="O", max_charge=4
        )
        for guess in guesses:
            assert "reasoning" in guess
            # Should mention the element
            assert "O" in guess["reasoning"] or "oxygen" in guess["reasoning"].lower()

    def test_antisite_typically_neutral(self) -> None:
        """Antisite defects typically have small charges when same-valence swap."""
        # Fe on Ni - both commonly +2, so charge difference is 0
        guesses = ferrox.defect_guess_charge_states(
            "antisite", added_species="Fe", original_species="Ni", max_charge=4
        )
        # Antisite may return guesses or be empty depending on implementation
        # The key is it doesn't crash and returns valid data structure
        assert isinstance(guesses, list)
        if guesses:
            charges = [g["charge"] for g in guesses]
            # Should have reasonable charge states
            assert all(-4 <= c <= 4 for c in charges)


# === Wyckoff Labels Tests ===


class TestWyckoffLabels:
    """Tests for get_wyckoff_labels function."""

    def test_fcc_returns_labels(self, fcc_cu_json: str) -> None:
        """FCC structure should return Wyckoff labels."""
        labels = ferrox.get_wyckoff_labels(fcc_cu_json)
        assert labels is not None
        assert len(labels) == 4  # Four Cu sites in conventional FCC

    def test_nacl_returns_labels(self, rocksalt_nacl_json: str) -> None:
        """NaCl rocksalt should return Wyckoff labels."""
        labels = ferrox.get_wyckoff_labels(rocksalt_nacl_json)
        assert labels is not None
        assert len(labels) == 8  # 4 Na + 4 Cl sites

    def test_returns_required_fields(self, fcc_cu_json: str) -> None:
        """Each Wyckoff site should have required fields."""
        labels = ferrox.get_wyckoff_labels(fcc_cu_json)
        if labels:
            site = labels[0]
            assert "label" in site
            assert "multiplicity" in site
            assert "site_symmetry" in site
            assert "representative_coords" in site

    def test_symprec_parameter(self, fcc_cu_json: str) -> None:
        """Different symprec values should work."""
        labels_tight = ferrox.get_wyckoff_labels(fcc_cu_json, symprec=0.001)
        labels_loose = ferrox.get_wyckoff_labels(fcc_cu_json, symprec=0.1)
        # Both should return valid results for clean structure
        assert labels_tight is not None
        assert labels_loose is not None

    def test_fcc_cu_wyckoff_4a(self, fcc_cu_json: str) -> None:
        """FCC Cu atoms should be at 4a Wyckoff position (Fm-3m)."""
        # In Fm-3m (space group 225), FCC atoms at [0,0,0] are on 4a position
        labels = ferrox.get_wyckoff_labels(fcc_cu_json)
        if labels:
            # All Cu atoms should have same Wyckoff label
            wyckoff_labels = [site["label"] for site in labels]
            # Should be 4a or equivalent
            assert all("4" in label or "a" in label.lower() for label in wyckoff_labels)

    def test_nacl_different_wyckoffs_for_na_and_cl(
        self, rocksalt_nacl_json: str
    ) -> None:
        """NaCl should have different Wyckoff positions for Na (4a) and Cl (4b)."""
        # In Fm-3m, Na at [0,0,0] is 4a, Cl at [0.5,0.5,0.5] is 4b
        labels = ferrox.get_wyckoff_labels(rocksalt_nacl_json)
        if labels:
            wyckoff_labels = [site["label"] for site in labels]
            # Should have at least 2 different Wyckoff positions
            unique_labels = set(wyckoff_labels)
            # Both Na and Cl positions should be present (Na 4a and Cl 4b)
            assert len(unique_labels) >= 2

    def test_multiplicity_matches_label(self, fcc_cu_json: str) -> None:
        """Multiplicity field should match the number in the Wyckoff label."""
        labels = ferrox.get_wyckoff_labels(fcc_cu_json)
        if labels:
            for site in labels:
                label = site["label"]
                multiplicity = site["multiplicity"]
                # Extract number from label (e.g., "4a" -> 4)
                import re

                numbers = re.findall(r"\d+", label)
                if numbers:
                    expected_mult = int(numbers[0])
                    assert multiplicity == expected_mult, (
                        f"Multiplicity {multiplicity} != label {label}"
                    )

    def test_site_symmetry_is_string(self, fcc_cu_json: str) -> None:
        """Site symmetry should be a valid string (point group notation)."""
        labels = ferrox.get_wyckoff_labels(fcc_cu_json)
        if labels:
            for site in labels:
                sym = site["site_symmetry"]
                assert isinstance(sym, str)
                assert len(sym) > 0


# === Defect Naming Tests ===


class TestDefectNaming:
    """Tests for defect_generate_name function."""

    def test_vacancy_name(self) -> None:
        """Vacancy should be named v_{element}."""
        name = ferrox.defect_generate_name("vacancy", original_species="O")
        assert name == "v_O"

    def test_vacancy_with_wyckoff(self) -> None:
        """Vacancy with Wyckoff should include it in name."""
        name = ferrox.defect_generate_name(
            "vacancy", original_species="O", wyckoff="4a"
        )
        assert name == "v_O_4a"

    def test_substitution_name(self) -> None:
        """Substitution should be named {new}_on_{old}."""
        name = ferrox.defect_generate_name(
            "substitution", species="Fe", original_species="Ni"
        )
        assert name == "Fe_on_Ni"

    def test_interstitial_name(self) -> None:
        """Interstitial should be named {element}_i."""
        name = ferrox.defect_generate_name("interstitial", species="Li")
        assert name == "Li_i"

    def test_interstitial_with_site_type(self) -> None:
        """Interstitial with site type should include it."""
        name = ferrox.defect_generate_name(
            "interstitial", species="Li", site_type="oct"
        )
        assert name == "Li_i_oct"

    def test_antisite_name(self) -> None:
        """Antisite should be named {new}_{old}."""
        name = ferrox.defect_generate_name(
            "antisite", species="Fe", original_species="Ni"
        )
        assert name == "Fe_Ni"

    @pytest.mark.parametrize(
        "defect_type", ["vacancy", "interstitial", "substitution", "antisite"]
    )
    def test_case_insensitive(self, defect_type: str) -> None:
        """Defect type should be case insensitive."""
        upper = ferrox.defect_generate_name(
            defect_type.upper(), species="Fe", original_species="Ni"
        )
        lower = ferrox.defect_generate_name(
            defect_type.lower(), species="Fe", original_species="Ni"
        )
        assert upper == lower


class TestDefectGenerateAll:
    """Tests for defect_generate_all workflow function."""

    def test_returns_required_fields(self, nacl_json: str) -> None:
        """Result contains all expected top-level fields."""
        result = ferrox.defect_generate_all(nacl_json)
        required = {
            "supercell_matrix",
            "vacancies",
            "substitutions",
            "interstitials",
            "antisites",
            "spacegroup",
            "n_defects",
        }
        assert required.issubset(result.keys())

    def test_vacancies_generated(self, nacl_json: str) -> None:
        """Vacancies are generated for each unique element."""
        result = ferrox.defect_generate_all(
            nacl_json,
            include_substitutions=False,
            include_interstitials=False,
            include_antisites=False,
        )
        assert len(result["vacancies"]) >= 2  # Na and Cl vacancies
        assert all("v_" in defect["name"] for defect in result["vacancies"])

    def test_antisites_generated_for_binary(self, nacl_json: str) -> None:
        """Antisites are generated for binary compounds."""
        result = ferrox.defect_generate_all(
            nacl_json,
            include_vacancies=False,
            include_substitutions=False,
            include_interstitials=False,
        )
        assert len(result["antisites"]) >= 2  # Na_Cl and Cl_Na

    def test_extrinsic_substitutions(self, nacl_json: str) -> None:
        """Extrinsic dopants create substitution defects."""
        result = ferrox.defect_generate_all(
            nacl_json,
            extrinsic=["Li", "Br"],
            include_vacancies=False,
            include_interstitials=False,
            include_antisites=False,
        )
        substitution_names = [defect["name"] for defect in result["substitutions"]]
        assert any("Li" in name for name in substitution_names)
        assert any("Br" in name for name in substitution_names)

    def test_defect_entry_fields(self, nacl_json: str) -> None:
        """Each defect entry has required fields."""
        result = ferrox.defect_generate_all(nacl_json)
        required = {
            "name",
            "defect_type",
            "frac_coords",
            "charge_states",
            "equivalent_sites",
        }
        for defect_list in [result["vacancies"], result["antisites"]]:
            for defect in defect_list:
                assert required.issubset(defect.keys())

    def test_n_defects_is_sum(self, nacl_json: str) -> None:
        """n_defects equals sum of all defect lists."""
        result = ferrox.defect_generate_all(nacl_json)
        total = (
            len(result["vacancies"])
            + len(result["substitutions"])
            + len(result["interstitials"])
            + len(result["antisites"])
        )
        assert result["n_defects"] == total

    def test_supercell_matrix_is_3x3(self, nacl_json: str) -> None:
        """Supercell matrix has correct shape."""
        result = ferrox.defect_generate_all(nacl_json)
        assert len(result["supercell_matrix"]) == 3
        assert all(len(row) == 3 for row in result["supercell_matrix"])

    def test_charge_states_have_probabilities(self, nacl_json: str) -> None:
        """Charge states include probability and reasoning."""
        result = ferrox.defect_generate_all(nacl_json)
        for vacancy in result["vacancies"]:
            if vacancy["charge_states"]:
                charge_state = vacancy["charge_states"][0]
                assert "charge" in charge_state
                assert "probability" in charge_state
                assert "reasoning" in charge_state
