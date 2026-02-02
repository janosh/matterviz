"""Tests for surface analysis functions in ferrox.

Includes test cases ported from pymatgen for correctness validation.
"""

import math
from typing import ClassVar

import ferrox
import numpy as np
import pytest
from conftest import lattice_from_matrix, make_site, make_structure


class TestEnumerateMiller:
    """Tests for surface_enumerate_miller."""

    def test_max_1_includes_low_index_planes(self) -> None:
        """Standard low-index planes are included."""
        indices = ferrox.surface_enumerate_miller(1)
        assert len(indices) >= 7
        for plane in ([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]):
            assert plane in indices

    def test_excludes_zero(self) -> None:
        """(0,0,0) is not in the list."""
        indices = ferrox.surface_enumerate_miller(2)
        assert [0, 0, 0] not in indices

    def test_max_2_includes_more_planes(self) -> None:
        """Higher indices are included with max_index=2."""
        indices = ferrox.surface_enumerate_miller(2)
        assert len(indices) > 7
        assert [1, 1, 0] in indices and [1, 1, 1] in indices

    def test_subset_property(self) -> None:
        """Miller indices with max_index i are subset of max_index i+1."""
        for max_idx in range(1, 3):
            indices_lower = set(tuple(idx) for idx in ferrox.surface_enumerate_miller(max_idx))
            indices_higher = set(tuple(idx) for idx in ferrox.surface_enumerate_miller(max_idx + 1))
            assert indices_lower <= indices_higher


class TestDSpacing:
    """Tests for surface_d_spacing."""

    def test_cubic_d_spacing_formula(self, simple_cubic_structure: dict) -> None:
        """Verify d-spacing formula for cubic system: d = a / sqrt(h² + k² + l²)."""
        lattice_param = 4.0

        # d_100 = a/1 = 4.0, d_110 = a/sqrt(2), d_111 = a/sqrt(3)
        assert ferrox.surface_d_spacing(simple_cubic_structure, 1, 0, 0) == pytest.approx(lattice_param, abs=0.01)
        assert ferrox.surface_d_spacing(simple_cubic_structure, 1, 1, 0) == pytest.approx(lattice_param / math.sqrt(2), abs=0.01)
        assert ferrox.surface_d_spacing(simple_cubic_structure, 1, 1, 1) == pytest.approx(lattice_param / math.sqrt(3), abs=0.01)

    def test_d_200_is_half_lattice_param(self, simple_cubic_structure: dict) -> None:
        """d_200 = a/2."""
        assert ferrox.surface_d_spacing(simple_cubic_structure, 2, 0, 0) == pytest.approx(2.0, abs=0.01)

    def test_d_hkl_general_pymatgen(self) -> None:
        """Pymatgen test: d_hkl formula for cubic cell."""
        # From pymatgen test_d_hkl: d = a / sqrt(h² + k² + l²)
        lattice_param = 10.0
        struct = lattice_from_matrix([
            [lattice_param, 0, 0],
            [0, lattice_param, 0],
            [0, 0, lattice_param],
        ])
        hkl = (1, 2, 3)
        expected = (sum(idx**2 for idx in hkl) / lattice_param**2) ** (-0.5)
        assert ferrox.surface_d_spacing(struct, *hkl) == pytest.approx(expected, abs=0.01)

    @pytest.mark.parametrize("hkl,expected_factor", [
        ((1, 0, 0), 1.0),
        ((0, 1, 0), 1.0),
        ((0, 0, 1), 1.0),
        ((1, 1, 0), 1 / math.sqrt(2)),
        ((1, 1, 1), 1 / math.sqrt(3)),
        ((2, 0, 0), 0.5),
        ((2, 2, 0), 0.5 / math.sqrt(2)),
        ((3, 0, 0), 1 / 3),
    ])
    def test_d_spacing_parametrized(self, hkl: tuple, expected_factor: float) -> None:
        """Parametrized d-spacing tests for cubic system."""
        lattice_param = 5.0
        struct = lattice_from_matrix([
            [lattice_param, 0, 0],
            [0, lattice_param, 0],
            [0, 0, lattice_param],
        ])
        expected = lattice_param * expected_factor
        assert ferrox.surface_d_spacing(struct, *hkl) == pytest.approx(expected, abs=0.01)


class TestSurfaceAtoms:
    """Tests for surface_get_surface_atoms."""

    def test_finds_valid_surface_atoms(self, fcc_cu_structure: dict) -> None:
        """Surface atoms are found and have valid indices."""
        slab = ferrox.make_slab(fcc_cu_structure, [1, 0, 0], min_slab_size=8.0)
        n_sites = len(slab["sites"])
        surface_atoms = ferrox.surface_get_surface_atoms(slab, tolerance=0.1)
        assert len(surface_atoms) > 0
        assert all(0 <= idx < n_sites for idx in surface_atoms)


class TestSurfaceArea:
    """Tests for surface_area."""

    def test_surface_area_positive_and_correct(
        self, fcc_cu_structure: dict, simple_cubic_structure: dict
    ) -> None:
        """Surface area is positive and matches expected values."""
        # FCC Cu slab should have positive area
        fcc_slab = ferrox.make_slab(fcc_cu_structure, [1, 0, 0], min_slab_size=8.0)
        assert ferrox.surface_area(fcc_slab) > 0

        # Cubic (100) surface area >= a² = 16 Å²
        cubic_slab = ferrox.make_slab(simple_cubic_structure, [1, 0, 0], min_slab_size=8.0)
        assert ferrox.surface_area(cubic_slab) >= 16.0 - 0.1


class TestMillerToNormal:
    """Tests for surface_miller_to_normal."""

    @pytest.mark.parametrize("hkl,dominant_axis", [
        ((1, 0, 0), 0),  # (100) along x
        ((0, 1, 0), 1),  # (010) along y
        ((0, 0, 1), 2),  # (001) along z
    ])
    def test_miller_normal_direction(
        self, simple_cubic_structure: dict, hkl: tuple, dominant_axis: int
    ) -> None:
        """Miller normals point along correct axis for cubic cell and have unit length."""
        normal = ferrox.surface_miller_to_normal(simple_cubic_structure, *hkl)
        # Verify unit length
        assert math.sqrt(sum(comp**2 for comp in normal)) == pytest.approx(1.0, abs=0.001)
        # Verify dominant axis
        assert abs(normal[dominant_axis]) > 0.99
        for idx in range(3):
            if idx != dominant_axis:
                assert abs(normal[idx]) < 0.01


class TestAdsorptionSites:
    """Tests for surface_find_adsorption_sites."""

    REQUIRED_FIELDS: ClassVar[set[str]] = {
        "site_type",
        "position",
        "cart_position",
        "height",
        "coordinating_atoms",
    }

    def test_atop_count_matches_surface_atoms(self, fcc_cu_structure: dict) -> None:
        """Number of atop sites equals number of surface atoms."""
        slab = ferrox.make_slab(fcc_cu_structure, [1, 0, 0], min_slab_size=8.0)
        surface_atoms = ferrox.surface_get_surface_atoms(slab, tolerance=0.1)
        sites = ferrox.surface_find_adsorption_sites(slab, height=2.0, site_types=["atop"])
        atop_sites = [site for site in sites if site["site_type"] == "atop"]
        assert len(atop_sites) == len(surface_atoms)

    def test_has_required_fields(self, fcc_cu_structure: dict) -> None:
        """Adsorption sites have all required fields."""
        slab = ferrox.make_slab(fcc_cu_structure, [1, 0, 0], min_slab_size=8.0)
        sites = ferrox.surface_find_adsorption_sites(slab, height=2.0)
        if sites:
            assert self.REQUIRED_FIELDS.issubset(sites[0].keys())


class TestSurfaceEnergy:
    """Tests for surface_calculate_energy."""

    def test_formula(self) -> None:
        """Verify surface energy formula: E_surf = (E_slab - n * E_bulk) / (2 * A)."""
        # (-100 - 8*(-10)) / (2*20) = (-100 + 80) / 40 = -0.5
        energy = ferrox.surface_calculate_energy(
            slab_energy=-100.0, bulk_energy_per_atom=-10.0, n_atoms=8, surface_area=20.0
        )
        assert energy == pytest.approx(-0.5, abs=0.001)

    def test_positive_for_typical_surface(self) -> None:
        """Typical surfaces have positive surface energy."""
        # (-80 - 10*(-10)) / (2*20) = 20/40 = 0.5
        energy = ferrox.surface_calculate_energy(
            slab_energy=-80.0, bulk_energy_per_atom=-10.0, n_atoms=10, surface_area=20.0
        )
        assert energy > 0


class TestWulffConstruction:
    """Tests for surface_compute_wulff."""

    def test_wulff_properties_and_facets(self, simple_cubic_structure: dict) -> None:
        """Wulff construction produces valid result with required fields."""
        surface_energies = [([1, 0, 0], 1.0), ([1, 1, 0], 1.2), ([1, 1, 1], 0.9)]
        wulff = ferrox.surface_compute_wulff(simple_cubic_structure, surface_energies)

        # Check top-level fields
        required_fields = {"facets", "total_surface_area", "volume", "sphericity"}
        assert required_fields.issubset(wulff.keys())
        assert wulff["total_surface_area"] > 0
        assert wulff["volume"] > 0
        assert 0 <= wulff["sphericity"] <= 1

        # Check facet fields
        assert len(wulff["facets"]) > 0
        facet_fields = {"miller_index", "surface_energy", "normal", "area_fraction"}
        assert facet_fields.issubset(wulff["facets"][0].keys())


class TestMillerIndexEdgeCases:
    """Tests for Miller index edge cases."""

    @pytest.mark.parametrize(
        ("max_idx", "min_count", "required_planes"),
        [
            (1, 7, [(1, 0, 0), (1, 1, 0), (1, 1, 1)]),
            (2, 7, [(1, 0, 0), (1, 1, 0), (1, 1, 1), (2, 1, 0)]),
        ],
    )
    def test_enumerate_miller(
        self, max_idx: int, min_count: int, required_planes: list
    ) -> None:
        """Enumerate produces unique Miller indices including required planes."""
        indices = ferrox.surface_enumerate_miller(max_idx)
        as_tuples = [tuple(idx) for idx in indices]
        assert len(indices) >= min_count
        assert len(as_tuples) == len(set(as_tuples)), "Indices should be unique"
        for plane in required_planes:
            assert plane in as_tuples, f"Missing required plane {plane}"

    def test_d_spacing_zero_miller_raises(self, simple_cubic_structure: dict) -> None:
        """D-spacing with [0,0,0] Miller index raises error."""
        with pytest.raises(Exception):
            ferrox.surface_d_spacing(simple_cubic_structure, 0, 0, 0)

    def test_d_spacing_equivalent_miller(self, simple_cubic_structure: dict) -> None:
        """D-spacing is same for equivalent Miller indices."""
        d_100 = ferrox.surface_d_spacing(simple_cubic_structure, 1, 0, 0)
        d_200 = ferrox.surface_d_spacing(simple_cubic_structure, 2, 0, 0)
        assert d_200 == pytest.approx(d_100 / 2, rel=1e-6)


class TestSurfaceAreaEdgeCases:
    """Tests for surface area edge cases."""

    def test_surface_area_non_orthogonal(self) -> None:
        """Surface area works for non-orthogonal cells."""
        # Use lattice_from_matrix directly - it returns a structure
        structure = lattice_from_matrix([
            [5.0, 0.0, 0.0],
            [2.5, 4.33, 0.0],  # 60 degree angle (hexagonal-like)
            [0.0, 0.0, 10.0],
        ])
        area = ferrox.surface_area(structure)
        # Area should be |a x b| = 5.0 * 4.33 = 21.65
        assert area == pytest.approx(5.0 * 4.33, rel=0.01)


class TestNormalVectorEdgeCases:
    """Tests for surface normal vector edge cases."""

    @pytest.mark.parametrize(
        ("hkl", "expected_nonzero_axis"),
        [
            ((1, 0, 0), 0),  # Normal along x
            ((0, 1, 0), 1),  # Normal along y
            ((0, 0, 1), 2),  # Normal along z
        ],
    )
    def test_miller_to_normal_axis_aligned(
        self, simple_cubic_structure: dict, hkl: tuple, expected_nonzero_axis: int
    ) -> None:
        """Miller to normal produces axis-aligned normals for cubic cell."""
        normal = ferrox.surface_miller_to_normal(simple_cubic_structure, *hkl)
        # For cubic cell, (h,k,l) normal should be along (h,k,l) direction
        for axis in range(3):
            if axis == expected_nonzero_axis:
                assert abs(normal[axis]) > 0.99
            else:
                assert abs(normal[axis]) < 0.01


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
