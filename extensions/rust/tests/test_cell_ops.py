"""Tests for cell operations in ferrox.

Includes test cases ported from pymatgen for correctness validation.
"""

import itertools

import ferrox
import numpy as np
import pytest
from conftest import lattice_from_matrix, make_cubic_structure, make_site, make_structure


class TestMinimumImageDistance:
    """Tests for cell_minimum_image_distance."""

    def test_same_point_zero_distance(
        self, orthorhombic_structure: dict, triclinic_structure: dict
    ) -> None:
        """Same point should have zero distance in any lattice."""
        pbc = [True, True, True]
        for struct, point in [
            (orthorhombic_structure, [0.0, 0.0, 0.0]),
            (triclinic_structure, [0.5, 0.5, 0.5]),
        ]:
            dist = ferrox.cell_minimum_image_distance(struct, point, point, pbc)
            assert dist == pytest.approx(0.0, abs=1e-10)

    def test_periodic_boundary_shorter_path(self, orthorhombic_structure: dict) -> None:
        """Points across periodic boundary should use shorter path."""
        # 0.1 to 0.9 along x: direct = 0.8*3.0 = 2.4, via boundary = 0.2*3.0 = 0.6
        dist = ferrox.cell_minimum_image_distance(
            orthorhombic_structure, [0.1, 0.0, 0.0], [0.9, 0.0, 0.0], [True, True, True]
        )
        assert dist == pytest.approx(0.6, abs=1e-10)

    def test_non_periodic_axis_no_wrap(self, orthorhombic_structure: dict) -> None:
        """Non-periodic axes don't wrap."""
        pbc = [True, True, False]  # z is not periodic
        dist = ferrox.cell_minimum_image_distance(
            orthorhombic_structure, [0.0, 0.0, 0.1], [0.0, 0.0, 0.9], pbc
        )
        # Direct distance in z: 0.8 * 5.0 = 4.0
        assert dist == pytest.approx(4.0, abs=1e-10)

    def test_cubic_across_boundary_pymatgen(self) -> None:
        """Test from pymatgen: cubic cell distance across boundary."""
        # From pymatgen test_get_distance_and_image
        cubic = make_cubic_structure(10.0, [make_site("H", [0, 0, 0])])
        pbc = [True, True, True]
        # [0, 0, 0.1] to [0, 0, 0.9] should wrap to distance 2.0
        dist = ferrox.cell_minimum_image_distance(
            cubic, [0.0, 0.0, 0.1], [0.0, 0.0, 0.9], pbc
        )
        assert dist == pytest.approx(2.0, abs=1e-10)

    def test_minimum_image_brute_force_validation(self) -> None:
        """Validate minimum image against brute-force search (pymatgen pattern)."""
        rng = np.random.default_rng(seed=42)
        pbc = [True, True, True]

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
            ferrox_dist = ferrox.cell_minimum_image_distance(struct, frac1, frac2, pbc)
            assert ferrox_dist <= min_dist_brute + 1e-6


class TestWrapToUnitCell:
    """Tests for cell_wrap_to_unit_cell."""

    def test_wrap_positions_to_unit_interval(self) -> None:
        """Positions are wrapped to [0, 1)."""
        struct = make_cubic_structure(5.0, [
            make_site("Na", [-0.5, 1.5, 2.3]),
            make_site("Cl", [0.3, 0.7, -0.2]),
        ])
        wrapped = ferrox.cell_wrap_to_unit_cell(struct)
        sites = wrapped["sites"]

        # [-0.5, 1.5, 2.3] -> [0.5, 0.5, 0.3]
        assert sites[0]["abc"] == pytest.approx([0.5, 0.5, 0.3], abs=1e-10)
        # [0.3, 0.7, -0.2] -> [0.3, 0.7, 0.8]
        assert sites[1]["abc"] == pytest.approx([0.3, 0.7, 0.8], abs=1e-10)


class TestNiggliReduction:
    """Tests for Niggli reduction functions."""

    def test_niggli_ordered_lengths(self, triclinic_structure: dict) -> None:
        """Niggli cell has a <= b <= c."""
        niggli = ferrox.cell_niggli_reduce(triclinic_structure, tolerance=1e-5)
        lengths = np.linalg.norm(niggli["matrix"], axis=1)
        assert lengths[0] <= lengths[1] + 1e-5
        assert lengths[1] <= lengths[2] + 1e-5

    def test_niggli_idempotent(self, triclinic_structure: dict) -> None:
        """Reducing already-reduced cell is identity."""
        niggli1 = ferrox.cell_niggli_reduce(triclinic_structure, tolerance=1e-5)
        niggli_struct = make_structure(
            {"matrix": niggli1["matrix"]},
            triclinic_structure["sites"],
        )
        assert ferrox.cell_is_niggli_reduced(niggli_struct, tolerance=1e-5)

        niggli2 = ferrox.cell_niggli_reduce(niggli_struct, tolerance=1e-5)
        assert np.allclose(niggli1["matrix"], niggli2["matrix"], atol=1e-5)

    def test_niggli_preserves_volume(self, triclinic_structure: dict) -> None:
        """Niggli reduction preserves volume."""
        original_vol = abs(np.linalg.det(triclinic_structure["lattice"]["matrix"]))
        niggli = ferrox.cell_niggli_reduce(triclinic_structure, tolerance=1e-5)
        niggli_vol = abs(np.linalg.det(niggli["matrix"]))
        assert niggli_vol == pytest.approx(original_vol, abs=1e-3)

    def test_niggli_cubic_from_skewed_pymatgen(self) -> None:
        """Pymatgen test: skewed cell reduces to cubic."""
        # [[1,1,1], [1,1,0], [0,1,1]] * 5 should reduce to cubic 5x5x5
        base = np.array([[1, 1, 1], [1, 1, 0], [0, 1, 1]])
        matrix = np.dot(base, 5 * np.eye(3)).tolist()
        struct = lattice_from_matrix(matrix)

        niggli = ferrox.cell_niggli_reduce(struct, tolerance=1e-5)
        lengths = np.linalg.norm(niggli["matrix"], axis=1)
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

        niggli = ferrox.cell_niggli_reduce(struct, tolerance=1e-5)
        niggli_vol = abs(np.linalg.det(niggli["matrix"]))
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

            niggli = ferrox.cell_niggli_reduce(struct, tolerance=1e-5)
            niggli_vol = abs(np.linalg.det(niggli["matrix"]))

            assert niggli_vol == pytest.approx(original_vol, abs=1e-3)


class TestSupercellStrategies:
    """Tests for supercell finding strategies."""

    def test_target_atoms_strategy(self, nacl_structure: dict) -> None:
        """Supercell approaches target atom count."""
        target = 16  # 2 atoms in unit cell, want 16
        matrix = ferrox.cell_find_supercell_matrix(
            nacl_structure, strategy="target_atoms", target_value=target
        )
        det = round(np.linalg.det(matrix))
        actual_atoms = det * 2
        assert abs(actual_atoms - target) <= 2

    def test_min_length_strategy(self, orthorhombic_structure: dict) -> None:
        """Cell lengths exceed min_length."""
        matrix = ferrox.cell_find_supercell_matrix(
            orthorhombic_structure, strategy="min_length", target_value=10.0
        )
        # Original lengths: 3.0, 4.0, 5.0
        assert matrix[0][0] >= 4  # 3.0 * 4 = 12.0 >= 10.0
        assert matrix[1][1] >= 3  # 4.0 * 3 = 12.0 >= 10.0
        assert matrix[2][2] >= 2  # 5.0 * 2 = 10.0 >= 10.0

    def test_min_image_dist_strategy(self, orthorhombic_structure: dict) -> None:
        """Minimum image distance exceeds target."""
        matrix = ferrox.cell_find_supercell_matrix(
            orthorhombic_structure, strategy="min_image_dist", target_value=8.0
        )
        # For orthorhombic: 3*m_a >= 8, 4*m_b >= 8, 5*m_c >= 8
        assert matrix[0][0] >= 3
        assert matrix[1][1] >= 2
        assert matrix[2][2] >= 2


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
            perp = ferrox.cell_perpendicular_distances(struct)
            assert len(perp) == 3
            assert all(d_val > 0 for d_val in perp)
            assert perp == pytest.approx(expected, abs=1e-10)


class TestLatticeEquivalence:
    """Tests for lattice equivalence checking."""

    def test_identity(self, nacl_structure: dict) -> None:
        """Same lattice is equivalent to itself."""
        assert ferrox.cell_lattices_equivalent(
            nacl_structure, nacl_structure, length_tol=0.2, angle_tol=5.0
        )

    def test_permuted_axes(self) -> None:
        """Permuted axes are equivalent."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_structure(
            {"matrix": [[0, 4.0, 0], [0, 0, 4.0], [4.0, 0, 0]]},
            [make_site("C", [0, 0, 0])],
        )
        assert ferrox.cell_lattices_equivalent(
            struct1, struct2, length_tol=0.2, angle_tol=5.0
        )

    def test_different_volume_not_equivalent(self) -> None:
        """Different volume lattices are not equivalent."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_cubic_structure(5.0, [make_site("C", [0, 0, 0])])
        # 25% size difference exceeds 20% tolerance
        assert not ferrox.cell_lattices_equivalent(
            struct1, struct2, length_tol=0.2, angle_tol=5.0
        )


class TestIsSupercell:
    """Tests for supercell detection."""

    def test_2x2x2_detected(self) -> None:
        """2x2x2 supercell is detected."""
        primitive = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        supercell = make_cubic_structure(8.0, [make_site("C", [0, 0, 0])])

        result = ferrox.cell_is_supercell(primitive, supercell, tolerance=1e-5)
        assert result is not None
        assert result[0][0] == result[1][1] == result[2][2] == 2

    def test_non_integer_ratio_returns_none(self) -> None:
        """Non-integer ratio returns None."""
        struct1 = make_cubic_structure(4.0, [make_site("C", [0, 0, 0])])
        struct2 = make_cubic_structure(6.0, [make_site("C", [0, 0, 0])])
        # 1.5x is not an integer ratio
        assert ferrox.cell_is_supercell(struct1, struct2, tolerance=1e-5) is None


class TestMinimumImageVector:
    """Tests for minimum image vector calculation."""

    @pytest.mark.parametrize("delta,expected", [
        ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
        ([0.8, 0.0, 0.0], [-1.128, 0.0, 0.0]),  # 0.8 wraps to -0.2, * 5.64 = -1.128
    ])
    def test_minimum_image_vector(
        self, nacl_structure: dict, delta: list, expected: list
    ) -> None:
        """Minimum image vector wraps correctly."""
        vec = ferrox.cell_minimum_image_vector(nacl_structure, delta, [True, True, True])
        assert vec == pytest.approx(expected, abs=1e-10)


class TestDelaunayReduction:
    """Tests for Delaunay reduction."""

    def test_delaunay_valid_and_preserves_volume(self, triclinic_structure: dict) -> None:
        """Delaunay reduction produces valid result and preserves volume."""
        original_vol = abs(np.linalg.det(triclinic_structure["lattice"]["matrix"]))
        delaunay = ferrox.cell_delaunay_reduce(triclinic_structure, tolerance=1e-5)

        assert "matrix" in delaunay and "transformation" in delaunay
        assert np.array(delaunay["matrix"]).shape == (3, 3)
        assert np.array(delaunay["transformation"]).shape == (3, 3)
        assert abs(np.linalg.det(delaunay["matrix"])) == pytest.approx(original_vol, abs=1e-3)


class TestHighlySkewedCells:
    """Tests for highly skewed cell handling."""

    @pytest.fixture
    def highly_skewed_structure(self) -> dict:
        """Structure with angles far from 90 degrees (>30 deg deviation)."""
        # Triclinic cell with ~53 degree angle
        return lattice_from_matrix([
            [5.0, 0.0, 0.0],
            [4.0, 3.0, 0.0],
            [2.0, 2.0, 4.0],
        ])

    def test_minimum_image_highly_skewed(self, highly_skewed_structure: dict) -> None:
        """Minimum image distance works for highly skewed cells."""
        # Two points that are close via periodic image
        pos1 = [0.0, 0.0, 0.0]
        pos2 = [0.9, 0.9, 0.9]  # Close to [0,0,0] via wrapping
        dist = ferrox.cell_minimum_image_distance(
            highly_skewed_structure, pos1, pos2, [True, True, True]
        )
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
        wrapped = ferrox.cell_wrap_to_unit_cell(struct)
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
            ([0.0, 0.0, 0.5], [0.9, 0.9, 0.5], 0.707),  # Periodic xy wraps: sqrt(0.5²+0.5²)
        ],
    )
    def test_minimum_image_partial_pbc(
        self, slab_structure: dict, pos1: list, pos2: list, expected: float
    ) -> None:
        """Minimum image respects partial PBC in xy, no wrap in z."""
        dist = ferrox.cell_minimum_image_distance(
            slab_structure, pos1, pos2, [True, True, False]
        )
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
        wrapped = ferrox.cell_wrap_to_unit_cell(struct)
        sites = wrapped["sites"]
        assert sites[0]["abc"] == pytest.approx([0, 0, 0], abs=1e-10)
        assert sites[1]["abc"] == pytest.approx([0, 0, 0], abs=1e-10)
        assert sites[2]["abc"] == pytest.approx([0.5, 0.5, 0.5], abs=1e-10)
        assert sites[3]["abc"] == pytest.approx([0.5, 0.5, 0.5], abs=1e-10)

    def test_minimum_image_atoms_at_same_position(self, nacl_structure: dict) -> None:
        """Minimum image distance is zero for same position."""
        pos = [0.25, 0.25, 0.25]
        dist = ferrox.cell_minimum_image_distance(
            nacl_structure, pos, pos, [True, True, True]
        )
        assert dist == pytest.approx(0.0, abs=1e-10)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
