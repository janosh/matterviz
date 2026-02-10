"""Tests for the ferrox distortion functions (ShakeNBreak-style)."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import (
    get_cart_coords,
    make_cubic_structure,
    make_site,
    make_structure,
    minimum_image_distance,
    structure_to_json,
)
from ferrox import defects

# === Fixtures ===


@pytest.fixture
def fcc_cu() -> dict:
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
def nacl_supercell() -> dict:
    """Create NaCl conventional cell (8 atoms) for neighbor testing."""
    lattice_param = 5.64
    lattice = {
        "matrix": [[lattice_param, 0, 0], [0, lattice_param, 0], [0, 0, lattice_param]]
    }
    # Conventional rocksalt cell (8 atoms)
    sites = [
        make_site("Na", [0, 0, 0]),
        make_site("Na", [0.5, 0.5, 0]),
        make_site("Na", [0.5, 0, 0.5]),
        make_site("Na", [0, 0.5, 0.5]),
        make_site("Cl", [0.5, 0, 0]),
        make_site("Cl", [0, 0.5, 0]),
        make_site("Cl", [0, 0, 0.5]),
        make_site("Cl", [0.5, 0.5, 0.5]),
    ]
    return make_structure(lattice, sites)


@pytest.fixture
def simple_dimer_structure() -> dict:
    """Simple 2-atom structure for dimer testing."""
    return make_cubic_structure(
        10.0,
        [
            make_site("Li", [0.1, 0.1, 0.1]),
            make_site("Li", [0.2, 0.1, 0.1]),  # 1 Å apart in x
        ],
    )


# === Test Classes ===


class TestDistortBonds:
    """Tests for defect_distort_bonds function."""

    def test_returns_list_of_structures(self, fcc_cu: dict) -> None:
        """distort_bonds returns list with one structure per factor."""
        factors = [-0.4, -0.2, 0.2, 0.4]
        results = defects.distort_bonds(
            structure_to_json(fcc_cu), 0, factors, cutoff=3.0
        )
        assert len(results) == len(factors)
        for result in results:
            assert "structure" in result
            assert "distortion_type" in result
            assert "distortion_factor" in result
            assert result["distortion_type"] == "bond_distortion"

    def test_distortion_factors_recorded(self, fcc_cu: dict) -> None:
        """Each result records correct distortion factor."""
        factors = [-0.3, 0.0, 0.3]
        results = defects.distort_bonds(
            structure_to_json(fcc_cu), 0, factors, cutoff=3.0
        )
        for idx, factor in enumerate(factors):
            assert results[idx]["distortion_factor"] == pytest.approx(factor, abs=1e-10)

    def test_center_site_idx_recorded(self, fcc_cu: dict) -> None:
        """Each result records correct center site index."""
        results = defects.distort_bonds(structure_to_json(fcc_cu), 2, [0.1], cutoff=3.0)
        assert results[0]["center_site_idx"] == 2

    def test_invalid_site_index_raises(self, fcc_cu: dict) -> None:
        """Out-of-bounds site index raises ValueError."""
        with pytest.raises(ValueError, match="out of bounds"):
            defects.distort_bonds(structure_to_json(fcc_cu), 100, [0.1], cutoff=3.0)

    def test_num_neighbors_limits_distortions(self, nacl_supercell: dict) -> None:
        """Only specified number of neighbors should be distorted."""
        # Distort only 2 nearest neighbors
        results_limited = defects.distort_bonds(
            structure_to_json(nacl_supercell), 0, [0.2], num_neighbors=2, cutoff=5.0
        )
        results_all = defects.distort_bonds(
            structure_to_json(nacl_supercell), 0, [0.2], cutoff=5.0
        )

        # Both should return valid structures
        assert len(results_limited) == 1
        assert len(results_all) == 1

        # Limited version should have fewer atoms moved
        orig_coords = get_cart_coords(nacl_supercell)
        limited_coords = get_cart_coords(results_limited[0]["structure"])
        all_coords = get_cart_coords(results_all[0]["structure"])

        limited_moved = np.sum(
            np.linalg.norm(limited_coords - orig_coords, axis=1) > 1e-6
        )
        all_moved = np.sum(np.linalg.norm(all_coords - orig_coords, axis=1) > 1e-6)

        assert limited_moved <= 2
        assert all_moved >= limited_moved

    def test_empty_factors_returns_empty(self, fcc_cu: dict) -> None:
        """Empty distortion factors returns empty list."""
        results = defects.distort_bonds(structure_to_json(fcc_cu), 0, [], cutoff=3.0)
        assert results == []

    def test_preserves_num_sites(self, fcc_cu: dict) -> None:
        """Distorted structure has same number of sites."""
        results = defects.distort_bonds(
            structure_to_json(fcc_cu), 0, [0.1, -0.1], cutoff=3.0
        )
        for result in results:
            assert len(result["structure"]["sites"]) == 4

    def test_preserves_species(self, nacl_supercell: dict) -> None:
        """Distorted structure preserves all species."""
        results = defects.distort_bonds(
            structure_to_json(nacl_supercell), 0, [0.1], cutoff=5.0
        )
        orig_elements = sorted(
            site["species"][0]["element"] for site in nacl_supercell["sites"]
        )
        new_elements = sorted(
            site["species"][0]["element"] for site in results[0]["structure"]["sites"]
        )
        assert orig_elements == new_elements

    def test_duplicate_neighbor_images_uses_closest(self) -> None:
        """Regression test: when same atom appears via multiple periodic images, use closest.

        In small cells with large cutoffs, the same neighbor atom can appear multiple times
        via different periodic images. The distortion should apply only the displacement
        computed from the closest image, not overwrite with a farther one.
        """
        # Small cell where cutoff exceeds cell size, causing duplicate neighbor entries
        small_cell = make_cubic_structure(
            2.0,  # Very small 2 Å cubic cell
            [
                make_site("Fe", [0.0, 0.0, 0.0]),  # Center atom
                make_site("Fe", [0.5, 0.5, 0.5]),  # Body-centered neighbor at ~1.73 Å
            ],
        )
        # Large cutoff ensures we see the same atom via multiple periodic images
        cutoff = 5.0  # Much larger than cell dimension
        results = defects.distort_bonds(
            structure_to_json(small_cell), 0, [0.3], cutoff=cutoff
        )

        # Should return a valid structure without errors
        assert len(results) == 1
        result = results[0]
        assert result["distortion_type"] == "bond_distortion"
        assert len(result["structure"]["sites"]) == 2

        # Verify the structure is valid (coordinates are finite, not NaN)
        new_coords = get_cart_coords(result["structure"])
        assert np.isfinite(new_coords).all()

        # Verify at least one atom moved (with factor 0.3, something should change)
        orig_coords = get_cart_coords(small_cell)
        max_displacement = np.max(np.linalg.norm(new_coords - orig_coords, axis=1))
        assert max_displacement > 0.01, (
            f"Expected some displacement, got {max_displacement}"
        )

        # The key regression check: run twice with same params should give same result
        # (if deduplication is broken, random ordering could give different results)
        results2 = defects.distort_bonds(
            structure_to_json(small_cell), 0, [0.3], cutoff=cutoff
        )
        new_coords2 = get_cart_coords(results2[0]["structure"])
        assert np.allclose(new_coords, new_coords2, atol=1e-10), (
            "Results should be deterministic"
        )


class TestCreateDimer:
    """Tests for defect_create_dimer function."""

    def test_dimer_reaches_target_distance(self, simple_dimer_structure: dict) -> None:
        """Dimer brings atoms to target distance."""
        target = 0.5
        result = defects.create_dimer(
            structure_to_json(simple_dimer_structure), 0, 1, target
        )
        assert "structure" in result
        assert result["distortion_type"] == "dimer"

        # Verify distance is approximately target
        coords = get_cart_coords(result["structure"])
        matrix = np.array(result["structure"]["lattice"]["matrix"])
        dist = minimum_image_distance(coords[0], coords[1], matrix)
        assert dist == pytest.approx(target, abs=0.01)

    def test_dimer_expands_distance(self, simple_dimer_structure: dict) -> None:
        """Dimer can also increase distance."""
        target = 3.0  # Larger than initial ~1 Å
        result = defects.create_dimer(
            structure_to_json(simple_dimer_structure), 0, 1, target
        )

        coords = get_cart_coords(result["structure"])
        matrix = np.array(result["structure"]["lattice"]["matrix"])
        dist = minimum_image_distance(coords[0], coords[1], matrix)
        assert dist == pytest.approx(target, abs=0.01)

    @pytest.mark.parametrize(
        ("site_a", "site_b", "target", "match"),
        [
            (0, 1, 0.0, "positive"),  # zero target
            (0, 1, -1.0, "positive"),  # negative target
            (0, 0, 2.0, "different"),  # same site
            (100, 1, 2.0, "out of bounds"),  # site_a out of bounds
            (0, 100, 2.0, "out of bounds"),  # site_b out of bounds
        ],
    )
    def test_invalid_inputs_raise(
        self,
        simple_dimer_structure: dict,
        site_a: int,
        site_b: int,
        target: float,
        match: str,
    ) -> None:
        """Invalid inputs raise appropriate errors."""
        with pytest.raises(ValueError, match=match):
            defects.create_dimer(
                structure_to_json(simple_dimer_structure), site_a, site_b, target
            )

    def test_preserves_num_sites(self, nacl_supercell: dict) -> None:
        """Dimer preserves number of sites."""
        result = defects.create_dimer(structure_to_json(nacl_supercell), 0, 1, 2.5)
        assert len(result["structure"]["sites"]) == len(nacl_supercell["sites"])


class TestRattleStructure:
    """Tests for defect_rattle function."""

    def test_rattle_returns_valid_structure(self, fcc_cu: dict) -> None:
        """Rattling returns valid distortion result."""
        result = defects.rattle(
            structure_to_json(fcc_cu), 0.1, seed=42, min_distance=0.5, max_attempts=100
        )
        assert result["distortion_type"] == "rattle"
        assert "structure" in result
        assert len(result["structure"]["sites"]) == 4

    def test_rattle_changes_positions(self, fcc_cu: dict) -> None:
        """Rattling modifies atomic positions."""
        result = defects.rattle(
            structure_to_json(fcc_cu), 0.2, seed=42, min_distance=0.3, max_attempts=100
        )

        orig_coords = get_cart_coords(fcc_cu)
        new_coords = get_cart_coords(result["structure"])
        diff = np.linalg.norm(new_coords - orig_coords)
        assert diff > 1e-6

    def test_rattle_is_reproducible(self, fcc_cu: dict) -> None:
        """Same seed produces same rattled structure."""
        result1 = defects.rattle(
            structure_to_json(fcc_cu), 0.1, seed=42, min_distance=0.5, max_attempts=100
        )
        result2 = defects.rattle(
            structure_to_json(fcc_cu), 0.1, seed=42, min_distance=0.5, max_attempts=100
        )

        coords1 = get_cart_coords(result1["structure"])
        coords2 = get_cart_coords(result2["structure"])
        np.testing.assert_allclose(coords1, coords2, atol=1e-10)

    def test_different_seeds_differ(self, fcc_cu: dict) -> None:
        """Different seeds produce different structures."""
        result1 = defects.rattle(
            structure_to_json(fcc_cu), 0.1, seed=1, min_distance=0.5, max_attempts=100
        )
        result2 = defects.rattle(
            structure_to_json(fcc_cu), 0.1, seed=2, min_distance=0.5, max_attempts=100
        )

        coords1 = get_cart_coords(result1["structure"])
        coords2 = get_cart_coords(result2["structure"])
        diff = np.linalg.norm(coords1 - coords2)
        assert diff > 1e-6

    def test_zero_stdev_unchanged(self, fcc_cu: dict) -> None:
        """Zero stdev leaves structure unchanged."""
        result = defects.rattle(
            structure_to_json(fcc_cu), 0.0, seed=42, min_distance=0.5, max_attempts=100
        )

        orig_coords = get_cart_coords(fcc_cu)
        new_coords = get_cart_coords(result["structure"])
        np.testing.assert_allclose(orig_coords, new_coords, atol=1e-10)

    def test_negative_stdev_raises(self, fcc_cu: dict) -> None:
        """Negative stdev raises error."""
        with pytest.raises(ValueError, match="non-negative"):
            defects.rattle(
                structure_to_json(fcc_cu),
                -0.1,
                seed=42,
                min_distance=0.5,
                max_attempts=100,
            )

    def test_records_stdev_as_factor(self, fcc_cu: dict) -> None:
        """Distortion factor records the stdev."""
        stdev = 0.15
        result = defects.rattle(
            structure_to_json(fcc_cu),
            stdev,
            seed=42,
            min_distance=0.5,
            max_attempts=100,
        )
        assert result["distortion_factor"] == pytest.approx(stdev)

    @pytest.mark.parametrize("stdev", [0.05, 0.1, 0.2])
    def test_rattle_with_various_stdev(self, fcc_cu: dict, stdev: float) -> None:
        """Rattling works with various stdev values."""
        result = defects.rattle(
            structure_to_json(fcc_cu),
            stdev,
            seed=42,
            min_distance=0.3,
            max_attempts=100,
        )
        assert result["distortion_factor"] == pytest.approx(stdev)
        assert len(result["structure"]["sites"]) == 4


class TestLocalRattle:
    """Tests for defect_local_rattle function."""

    def test_local_rattle_returns_structure(self, nacl_supercell: dict) -> None:
        """local_rattle returns valid distortion result."""
        result = defects.local_rattle(
            structure_to_json(nacl_supercell), 0, 0.5, 3.0, seed=42
        )
        assert "structure" in result
        assert result["distortion_type"] == "local_rattle"
        assert result["center_site_idx"] == 0

    def test_amplitude_decay_with_distance(self) -> None:
        """Displacement amplitude decays with distance from center."""
        # Create a structure with atoms at different distances from center
        lattice = {"matrix": [[10, 0, 0], [0, 10, 0], [0, 0, 10]]}
        sites = [
            make_site("Cu", [0.1, 0.1, 0.1]),  # center
            make_site("Cu", [0.2, 0.1, 0.1]),  # close (~1 Å)
            make_site("Cu", [0.5, 0.5, 0.5]),  # far (~7 Å)
        ]
        structure = make_structure(lattice, sites)

        result = defects.local_rattle(
            structure_to_json(structure), 0, 1.0, 2.0, seed=42
        )

        orig_coords = get_cart_coords(structure)
        new_coords = get_cart_coords(result["structure"])

        disp_close = np.linalg.norm(new_coords[1] - orig_coords[1])
        disp_far = np.linalg.norm(new_coords[2] - orig_coords[2])

        # Far atom should have smaller displacement due to decay
        assert disp_far < disp_close, (
            f"Far atom displacement ({disp_far:.4f}) should be < close atom ({disp_close:.4f})"
        )

    def test_reproducible_with_seed(self, nacl_supercell: dict) -> None:
        """Same seed produces same result."""
        result1 = defects.local_rattle(
            structure_to_json(nacl_supercell), 0, 0.5, 3.0, seed=42
        )
        result2 = defects.local_rattle(
            structure_to_json(nacl_supercell), 0, 0.5, 3.0, seed=42
        )

        coords1 = get_cart_coords(result1["structure"])
        coords2 = get_cart_coords(result2["structure"])
        np.testing.assert_allclose(coords1, coords2, atol=1e-10)

    def test_different_seeds_differ(self, nacl_supercell: dict) -> None:
        """Different seeds produce different structures."""
        result1 = defects.local_rattle(
            structure_to_json(nacl_supercell), 0, 0.5, 3.0, seed=1
        )
        result2 = defects.local_rattle(
            structure_to_json(nacl_supercell), 0, 0.5, 3.0, seed=2
        )

        coords1 = get_cart_coords(result1["structure"])
        coords2 = get_cart_coords(result2["structure"])
        diff = np.linalg.norm(coords1 - coords2)
        assert diff > 1e-6

    @pytest.mark.parametrize(
        ("center", "amplitude", "decay", "match"),
        [
            (100, 0.5, 3.0, "out of bounds"),  # center out of bounds
            (0, -0.5, 3.0, "non-negative"),  # negative amplitude
            (0, 0.5, 0.0, "positive"),  # zero decay radius
            (0, 0.5, -1.0, "positive"),  # negative decay radius
        ],
    )
    def test_invalid_inputs_raise(
        self, fcc_cu: dict, center: int, amplitude: float, decay: float, match: str
    ) -> None:
        """Invalid inputs raise appropriate errors."""
        with pytest.raises(ValueError, match=match):
            defects.local_rattle(
                structure_to_json(fcc_cu), center, amplitude, decay, seed=42
            )

    def test_zero_amplitude_unchanged(self, fcc_cu: dict) -> None:
        """Zero max_amplitude leaves structure unchanged."""
        result = defects.local_rattle(structure_to_json(fcc_cu), 0, 0.0, 3.0, seed=42)

        orig_coords = get_cart_coords(fcc_cu)
        new_coords = get_cart_coords(result["structure"])
        np.testing.assert_allclose(orig_coords, new_coords, atol=1e-10)

    def test_records_amplitude_as_factor(self, fcc_cu: dict) -> None:
        """Distortion factor records max_amplitude."""
        amplitude = 0.75
        result = defects.local_rattle(
            structure_to_json(fcc_cu), 0, amplitude, 3.0, seed=42
        )
        assert result["distortion_factor"] == pytest.approx(amplitude)

    @pytest.mark.parametrize("center_idx", [0, 1, 2, 3])
    def test_different_center_sites(self, fcc_cu: dict, center_idx: int) -> None:
        """Local rattle works with different center sites."""
        result = defects.local_rattle(
            structure_to_json(fcc_cu), center_idx, 0.3, 2.0, seed=42
        )
        assert result["center_site_idx"] == center_idx
        assert len(result["structure"]["sites"]) == 4


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_single_atom_distort_bonds(self) -> None:
        """Single atom structure with distort_bonds (no neighbors)."""
        single = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        results = defects.distort_bonds(structure_to_json(single), 0, [0.1], cutoff=3.0)
        # Should return result but with unchanged structure (no neighbors to distort)
        assert len(results) == 1
        assert len(results[0]["structure"]["sites"]) == 1

    def test_single_atom_rattle(self) -> None:
        """Single atom structure with rattle."""
        single = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        result = defects.rattle(
            structure_to_json(single), 0.1, seed=42, min_distance=0.5, max_attempts=100
        )
        assert len(result["structure"]["sites"]) == 1
        # Verify returned coordinates are valid (finite)
        new_coords = np.array(result["structure"]["sites"][0]["abc"])
        assert np.all(np.isfinite(new_coords))
        # For single atom, min_distance constraint may prevent movement, so just verify
        # the structure is valid - position change is not guaranteed

    def test_single_atom_local_rattle(self) -> None:
        """Single atom structure with local_rattle."""
        single = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        result = defects.local_rattle(structure_to_json(single), 0, 0.5, 3.0, seed=42)
        assert len(result["structure"]["sites"]) == 1

    def test_large_distortion_factor(self, fcc_cu: dict) -> None:
        """Large distortion factors work correctly."""
        results = defects.distort_bonds(
            structure_to_json(fcc_cu), 0, [1.0, -0.9], cutoff=3.0
        )
        assert len(results) == 2
        for result in results:
            assert len(result["structure"]["sites"]) == 4

    def test_very_small_cutoff(self, fcc_cu: dict) -> None:
        """Very small cutoff (no neighbors within range)."""
        results = defects.distort_bonds(structure_to_json(fcc_cu), 0, [0.1], cutoff=0.1)
        # Should return result with unchanged structure
        assert len(results) == 1
        orig_coords = get_cart_coords(fcc_cu)
        new_coords = get_cart_coords(results[0]["structure"])
        np.testing.assert_allclose(orig_coords, new_coords, atol=1e-10)

    def test_structure_with_many_sites(self) -> None:
        """Test with larger structure (more sites)."""
        # Create a 3x3x3 simple cubic structure
        sites = []
        for ix in range(3):
            for iy in range(3):
                for iz in range(3):
                    sites.append(make_site("Cu", [ix / 3, iy / 3, iz / 3]))

        structure = make_cubic_structure(9.0, sites)
        assert len(structure["sites"]) == 27

        result = defects.rattle(
            structure_to_json(structure),
            0.1,
            seed=42,
            min_distance=0.3,
            max_attempts=100,
        )
        assert len(result["structure"]["sites"]) == 27

    def test_dimer_same_position_raises(self) -> None:
        """Create dimer with atoms at same position raises error."""
        # Two atoms at exact same fractional coordinates: either merged during
        # parsing (causing out-of-bounds) or detected as same position by create_dimer
        degenerate = make_cubic_structure(
            4.0,
            [
                make_site("Fe", [0.0, 0.0, 0.0]),
                make_site("Fe", [0.0, 0.0, 0.0]),  # Exact same position
            ],
        )
        with pytest.raises(ValueError, match="same position|out of bounds"):
            defects.create_dimer(structure_to_json(degenerate), 0, 1, 2.0)

    def test_distort_bonds_highly_skewed_cell(self) -> None:
        """Distort bonds works correctly with highly skewed cell."""
        # Triclinic cell with angles far from 90 degrees
        lattice = {
            "matrix": [
                [4.0, 0.0, 0.0],
                [2.0, 3.5, 0.0],  # ~60 degree angle with a
                [1.0, 1.0, 3.0],  # Highly skewed
            ]
        }
        sites = [
            make_site("Fe", [0.0, 0.0, 0.0]),
            make_site("O", [0.25, 0.25, 0.25]),
            make_site("O", [0.75, 0.75, 0.75]),
        ]
        structure = make_structure(lattice, sites)
        results = defects.distort_bonds(
            structure_to_json(structure), 0, [0.1, -0.1], cutoff=4.0
        )
        assert len(results) == 2
        for result in results:
            assert len(result["structure"]["sites"]) == 3

    def test_rattle_with_min_distance_constraint(self) -> None:
        """Rattle respects minimum distance constraint."""
        structure = make_cubic_structure(
            3.0,
            [
                make_site("Fe", [0.0, 0.0, 0.0]),
                make_site("Fe", [0.5, 0.0, 0.0]),
            ],
        )
        # With tight min_distance, rattling should still succeed
        result = defects.rattle(
            structure_to_json(structure),
            0.05,
            seed=42,
            min_distance=0.5,
            max_attempts=100,
        )
        # Verify atoms didn't get too close
        coords = get_cart_coords(result["structure"])
        dist = np.linalg.norm(coords[0] - coords[1])
        assert dist >= 0.5 - 1e-6, f"Atoms too close: {dist}"
