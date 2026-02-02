"""Tests for cell operations in ferrox.

Includes test cases ported from pymatgen for correctness validation.
"""

import itertools

import numpy as np
import pytest
from conftest import (
    lattice_from_matrix,
    make_cubic_structure,
    make_site,
    make_structure,
)
from ferrox import cell, structure


class TestMinimumImageDistance:
    """Tests for cell_minimum_image_distance."""

    def test_same_point_zero_distance(
        self, orthorhombic_structure: dict, triclinic_structure: dict
    ) -> None:
        """Same point should have zero distance in any lattice."""
        for struct, point in [
            (orthorhombic_structure, [0.0, 0.0, 0.0]),
            (triclinic_structure, [0.5, 0.5, 0.5]),
        ]:
            dist = cell.minimum_image_distance(struct, point, point)
            assert dist == pytest.approx(0.0, abs=1e-10)

    def test_periodic_boundary_shorter_path(self, orthorhombic_structure: dict) -> None:
        """Points across periodic boundary should use shorter path."""
        # 0.1 to 0.9 along x: direct = 0.8*3.0 = 2.4, via boundary = 0.2*3.0 = 0.6
        dist = cell.minimum_image_distance(
            orthorhombic_structure, [0.1, 0.0, 0.0], [0.9, 0.0, 0.0]
        )
        assert dist == pytest.approx(0.6, abs=1e-10)

    def test_non_periodic_axis_no_wrap(self, orthorhombic_structure: dict) -> None:
        """Non-periodic axes don't wrap."""
        # Set structure pbc to have non-periodic z
        orthorhombic_structure["lattice"]["pbc"] = [True, True, False]
        dist = cell.minimum_image_distance(
            orthorhombic_structure, [0.0, 0.0, 0.1], [0.0, 0.0, 0.9]
        )
        # Direct distance in z: 0.8 * 5.0 = 4.0
        assert dist == pytest.approx(4.0, abs=1e-10)

    def test_cubic_across_boundary_pymatgen(self) -> None:
        """Test from pymatgen: cubic cell distance across boundary."""
        # From pymatgen test_get_distance_and_image
        cubic = make_cubic_structure(10.0, [make_site("H", [0, 0, 0])])
        # [0, 0, 0.1] to [0, 0, 0.9] should wrap to distance 2.0
        dist = cell.minimum_image_distance(cubic, [0.0, 0.0, 0.1], [0.0, 0.0, 0.9])
        assert dist == pytest.approx(2.0, abs=1e-10)

    def test_minimum_image_brute_force_validation(self) -> None:
        """Validate minimum image against brute-force search (pymatgen pattern)."""
        rng = np.random.default_rng(seed=42)

        for _ in range(5):
            # Random lattice with varying lengths
            lengths = rng.integers(3, 15, 3)
            matrix = rng.random((3, 3)) * lengths.reshape(3, 1)
            # Ensure positive volume
            if np.linalg.det(matrix) < 0.1:
                continue

            struct = lattice_from_matrix(matrix.tolist())
            frac1 = rng.random(3).tolist()
            frac2 = rng.random(3).tolist()

            # Brute-force: check all images in [-3, 3]^3
            # Lattice matrix has vectors as rows, so frac-to-cart is delta @ matrix
            scope = range(-3, 4)
            min_dist_brute = float("inf")
            for img in itertools.product(scope, scope, scope):
                delta = np.array(frac1) - (np.array(frac2) + np.array(img))
                cart = delta @ matrix
                dist = np.linalg.norm(cart)
                min_dist_brute = min(min_dist_brute, dist)

            # Compare with ferrox
            ferrox_dist = cell.minimum_image_distance(struct, frac1, frac2)
            assert ferrox_dist <= min_dist_brute + 1e-6


class TestWrapToUnitCell:
    """Tests for cell_wrap_to_unit_cell."""

    def test_wrap_positions_to_unit_interval(self) -> None:
        """Positions are wrapped to [0, 1)."""
        struct = make_cubic_structure(
            5.0,
            [
                make_site("Na", [-0.5, 1.5, 2.3]),
                make_site("Cl", [0.3, 0.7, -0.2]),
            ],
        )
        wrapped = structure.wrap_to_unit_cell(struct)
        sites = wrapped["sites"]

        # [-0.5, 1.5, 2.3] -> [0.5, 0.5, 0.3]
        assert sites[0]["abc"] == pytest.approx([0.5, 0.5, 0.3], abs=1e-10)
        # [0.3, 0.7, -0.2] -> [0.3, 0.7, 0.8]
        assert sites[1]["abc"] == pytest.approx([0.3, 0.7, 0.8], abs=1e-10)


class TestNiggliReduction:
    """Tests for Niggli reduction functions."""

    def test_niggli_ordered_lengths(self, triclinic_structure: dict) -> None:
        """Niggli cell has a <= b <= c."""
        niggli = cell.niggli_reduce(triclinic_structure)
        lengths = np.linalg.norm(niggli["lattice"]["matrix"], axis=1)
        assert lengths[0] <= lengths[1] + 1e-5
        assert lengths[1] <= lengths[2] + 1e-5

    def test_niggli_idempotent(self, triclinic_structure: dict) -> None:
        """Reducing already-reduced cell is identity."""
        niggli1 = cell.niggli_reduce(triclinic_structure)
        niggli_struct = make_structure(
            {"matrix": niggli1["lattice"]["matrix"]},
            triclinic_structure["sites"],
        )
        assert cell.is_niggli_reduced(niggli_struct, tolerance=1e-5)

        niggli2 = cell.niggli_reduce(niggli_struct)
        assert np.allclose(
            niggli1["lattice"]["matrix"], niggli2["lattice"]["matrix"], atol=1e-5
        )

    def test_niggli_preserves_volume(self, triclinic_structure: dict) -> None:
        """Niggli reduction preserves volume."""
        original_vol = abs(np.linalg.det(triclinic_structure["lattice"]["matrix"]))
        niggli = cell.niggli_reduce(triclinic_structure)
        niggli_vol = abs(np.linalg.det(niggli["lattice"]["matrix"]))
        assert niggli_vol == pytest.approx(original_vol, abs=1e-3)

    def test_niggli_cubic_from_skewed_pymatgen(self) -> None:
        """Pymatgen test: skewed cell reduces to cubic."""
        # [[1,1,1], [1,1,0], [0,1,1]] * 5 should reduce to cubic 5x5x5
        base = np.array([[1, 1, 1], [1, 1, 0], [0, 1, 1]])
        matrix = np.dot(base, 5 * np.eye(3)).tolist()
        struct = lattice_from_matrix(matrix)

        niggli = cell.niggli_reduce(struct)
        lengths = np.linalg.norm(niggli["lattice"]["matrix"], axis=1)
        assert lengths == pytest.approx([5.0, 5.0, 5.0], abs=1e-3)

    def test_niggli_rhombohedral_pymatgen(self) -> None:
        """Pymatgen test: rhombohedral lattice Niggli reduction."""
        # Row-major lattice: each row is a lattice vector
        matrix = [
            [1.432950, 0.827314, 4.751000],
            [-1.432950, 0.827314, 4.751000],
            [0.0, -1.654628, 4.751000],
        ]
        struct = lattice_from_matrix(matrix)

        niggli = cell.niggli_reduce(struct)
        niggli_vol = abs(np.linalg.det(niggli["lattice"]["matrix"]))
        original_vol = abs(np.linalg.det(matrix))
        assert niggli_vol == pytest.approx(original_vol, abs=1e-3)

    def test_niggli_random_preserves_volume(self) -> None:
        """Niggli reduction always preserves volume for random lattices."""
        rng = np.random.default_rng(seed=123)

        for _ in range(5):
            matrix = rng.random((3, 3)) * 5
            if abs(np.linalg.det(matrix)) < 0.5:
                continue

            struct = lattice_from_matrix(matrix.tolist())
            original_vol = abs(np.linalg.det(matrix))

            niggli = cell.niggli_reduce(struct)
            niggli_vol = abs(np.linalg.det(niggli["lattice"]["matrix"]))

            assert niggli_vol == pytest.approx(original_vol, abs=1e-3)


class TestSupercellStrategies:
    """Tests for supercell finding strategies."""

    def test_target_atoms_strategy(self, nacl_structure: dict) -> None:
        """Supercell approaches target atom count."""
        target = 16  # 2 atoms in unit cell, want 16
        matrix = cell.find_supercell_matrix(nacl_structure, target_atoms=target)
        det = round(np.linalg.det(matrix))
        actual_atoms = det * 2
        assert abs(actual_atoms - target) <= 2

    def test_default_target_atoms(self, nacl_structure: dict) -> None:
        """Default target_atoms (100) works."""
        matrix = cell.find_supercell_matrix(nacl_structure)
        det = round(np.linalg.det(matrix))
        actual_atoms = det * 2
        # Should approach 100 atoms
        assert 80 <= actual_atoms <= 120


@pytest.mark.skip(reason="perpendicular_distances not implemented in cell module")
class TestPerpendicularDistances:
    """Tests for perpendicular distance calculation."""

    def test_perpendicular_distances(
        self, orthorhombic_structure: dict, nacl_structure: dict
    ) -> None:
        """Perpendicular distances match expected values for orthogonal cells."""
        for struct, expected in [
            (orthorhombic_structure, [3.0, 4.0, 5.0]),
            (nacl_structure, [5.64, 5.64, 5.64]),
        ]:
            perp = cell.perpendicular_distances(struct)
            assert len(perp) == 3
            assert all(d_val > 0 for d_val in perp)
            assert perp == pytest.approx(expected, abs=1e-10)


class TestLatticeEquivalence:
    """Tests for lattice equivalence checking."""

    def test_identity(self, nacl_structure: dict) -> None:
        """Same lattice is equivalent to itself."""
        assert cell.lattices_equivalent(
            nacl_structure, nacl_structure, length_tol=0.2, angle_tol=5.0
        )

    def test_permuted_axes(self) -> None:
        """Permuted axes are equivalent."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_structure(
            {"matrix": [[0, 4.0, 0], [0, 0, 4.0], [4.0, 0, 0]]},
            [make_site("C", [0, 0, 0])],
        )
        assert cell.lattices_equivalent(struct1, struct2, length_tol=0.2, angle_tol=5.0)

    def test_different_volume_not_equivalent(self) -> None:
        """Different volume lattices are not equivalent."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_cubic_structure(5.0, [make_site("C", [0, 0, 0])])
        # 25% size difference exceeds 20% tolerance
        assert not cell.lattices_equivalent(
            struct1, struct2, length_tol=0.2, angle_tol=5.0
        )


class TestIsSupercell:
    """Tests for supercell detection."""

    def test_2x2x2_detected(self) -> None:
        """2x2x2 supercell is detected."""
        primitive = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        supercell = make_cubic_structure(8.0, [make_site("C", [0, 0, 0])])

        result = cell.is_supercell(primitive, supercell, tolerance=1e-5)
        assert result is not None
        assert result[0][0] == result[1][1] == result[2][2] == 2

    def test_non_integer_ratio_returns_none(self) -> None:
        """Non-integer ratio returns None."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_cubic_structure(6.0, [make_site("C", [0, 0, 0])])
        # 1.5x is not an integer ratio
        assert cell.is_supercell(struct1, struct2, tolerance=1e-5) is None


class TestMinimumImageVector:
    """Tests for minimum image vector calculation."""

    @pytest.mark.parametrize(
        "point1,point2,expected",
        [
            ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            # delta of 0.8 wraps to -0.2, * 5.64 = -1.128
            ([0.0, 0.0, 0.0], [0.8, 0.0, 0.0], [-1.128, 0.0, 0.0]),
        ],
    )
    def test_minimum_image_vector(
        self, nacl_structure: dict, point1: list, point2: list, expected: list
    ) -> None:
        """Minimum image vector wraps correctly."""
        vec = cell.minimum_image_vector(nacl_structure, point1, point2)
        assert vec == pytest.approx(expected, abs=1e-10)


class TestDelaunayReduction:
    """Tests for Delaunay reduction."""

    def test_delaunay_valid_and_preserves_volume(
        self, triclinic_structure: dict
    ) -> None:
        """Delaunay reduction produces valid result and preserves volume."""
        original_vol = abs(np.linalg.det(triclinic_structure["lattice"]["matrix"]))
        delaunay = cell.delaunay_reduce(triclinic_structure)

        assert "lattice" in delaunay
        assert np.array(delaunay["lattice"]["matrix"]).shape == (3, 3)
        assert abs(np.linalg.det(delaunay["lattice"]["matrix"])) == pytest.approx(
            original_vol, abs=1e-3
        )


class TestHighlySkewedCells:
    """Tests for highly skewed cell handling."""

    @pytest.fixture
    def highly_skewed_structure(self) -> dict:
        """Structure with angles far from 90 degrees (>30 deg deviation)."""
        # Triclinic cell with ~53 degree angle
        return lattice_from_matrix(
            [
                [5.0, 0.0, 0.0],
                [4.0, 3.0, 0.0],
                [2.0, 2.0, 4.0],
            ]
        )

    def test_minimum_image_highly_skewed(self, highly_skewed_structure: dict) -> None:
        """Minimum image distance works for highly skewed cells."""
        # Two points that are close via periodic image
        pos1 = [0.0, 0.0, 0.0]
        pos2 = [0.9, 0.9, 0.9]  # Close to [0,0,0] via wrapping
        dist = cell.minimum_image_distance(highly_skewed_structure, pos1, pos2)
        # Should find the shorter periodic image
        assert dist > 0
        assert dist < 10.0  # Sanity check

    def test_wrap_to_unit_cell_highly_skewed(self) -> None:
        """Wrap to unit cell works for highly skewed cells."""
        # Create structure with positions outside [0, 1)
        struct = make_structure(
            {"matrix": [[5.0, 0.0, 0.0], [4.0, 3.0, 0.0], [2.0, 2.0, 4.0]]},
            [make_site("Na", [1.5, -0.5, 2.3]), make_site("Cl", [-0.1, 1.1, 0.0])],
        )
        wrapped = structure.wrap_to_unit_cell(struct)
        # All wrapped coordinates should be in [0, 1)
        for site in wrapped["sites"]:
            for coord in site["abc"]:
                assert 0.0 <= coord < 1.0, f"Coordinate {coord} not in [0, 1)"


class TestPartialPBC:
    """Tests for partial periodic boundary conditions."""

    @pytest.fixture
    def slab_structure(self) -> dict:
        """Structure with PBC only in x,y (slab geometry)."""
        struct = lattice_from_matrix([[5.0, 0, 0], [0, 5.0, 0], [0, 0, 20.0]])
        struct["lattice"]["pbc"] = [True, True, False]
        return struct

    @pytest.mark.parametrize(
        ("pos1", "pos2", "expected"),
        [
            ([0.0, 0.0, 0.0], [0.0, 0.0, 0.9], 18.0),  # Non-periodic z: 0.9*20=18
            (
                [0.0, 0.0, 0.5],
                [0.9, 0.9, 0.5],
                0.707,
            ),  # Periodic xy wraps: sqrt(0.5²+0.5²)
        ],
    )
    def test_minimum_image_partial_pbc(
        self, slab_structure: dict, pos1: list, pos2: list, expected: float
    ) -> None:
        """Minimum image respects partial PBC in xy, no wrap in z."""
        # pbc is already set on the slab_structure fixture
        dist = cell.minimum_image_distance(slab_structure, pos1, pos2)
        assert dist == pytest.approx(expected, abs=0.1)


class TestBoundaryValues:
    """Tests for boundary value handling."""

    def test_wrap_boundary_values(self) -> None:
        """Wrap handles boundary values correctly."""
        # Create structure with boundary positions
        struct = make_structure(
            {"matrix": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]]},
            [
                make_site("Na", [0.0, 0.0, 0.0]),
                make_site("Na", [1.0, 1.0, 1.0]),  # Should wrap to [0,0,0]
                make_site("Cl", [0.5, 0.5, 0.5]),
                make_site("Cl", [-0.5, -0.5, -0.5]),  # Should wrap to [0.5, 0.5, 0.5]
            ],
        )
        wrapped = structure.wrap_to_unit_cell(struct)
        sites = wrapped["sites"]
        assert sites[0]["abc"] == pytest.approx([0, 0, 0], abs=1e-10)
        assert sites[1]["abc"] == pytest.approx([0, 0, 0], abs=1e-10)
        assert sites[2]["abc"] == pytest.approx([0.5, 0.5, 0.5], abs=1e-10)
        assert sites[3]["abc"] == pytest.approx([0.5, 0.5, 0.5], abs=1e-10)

    def test_minimum_image_atoms_at_same_position(self, nacl_structure: dict) -> None:
        """Minimum image distance is zero for same position."""
        pos = [0.25, 0.25, 0.25]
        dist = cell.minimum_image_distance(nacl_structure, pos, pos)
        assert dist == pytest.approx(0.0, abs=1e-10)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
