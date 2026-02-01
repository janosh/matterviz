"""Tests for lattice property functions in ferrox."""

import math

import ferrox
import numpy as np
import pytest


@pytest.fixture
def cubic_structure() -> dict:
    """Create a simple cubic NaCl structure."""
    return {
        "lattice": {"matrix": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]]},
        "sites": [
            {"species": [{"element": "Na", "occu": 1.0}], "abc": [0, 0, 0]},
            {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.5, 0.5, 0.5]},
        ],
    }


@pytest.fixture
def hexagonal_structure() -> dict:
    """Create a hexagonal structure (alpha = beta = 90 deg, gamma = 120 deg)."""
    a, c = 3.0, 5.0
    return {  # Hexagonal lattice vectors
        "lattice": {
            "matrix": [
                [a, 0, 0],
                [-a / 2, a * math.sqrt(3) / 2, 0],
                [0, 0, c],
            ]
        },
        "sites": [
            {"species": [{"element": "Zn", "occu": 1.0}], "abc": [0, 0, 0]},
        ],
    }


@pytest.fixture
def triclinic_structure() -> dict:
    """Create a triclinic structure with non-orthogonal axes."""
    return {
        "lattice": {
            "matrix": [
                [4.0, 0.5, 0.2],
                [0.3, 5.0, 0.4],
                [0.1, 0.2, 6.0],
            ]
        },
        "sites": [
            {"species": [{"element": "Si", "occu": 1.0}], "abc": [0, 0, 0]},
        ],
    }


class TestMetricTensor:
    """Tests for get_lattice_metric_tensor."""

    def test_metric_tensor_cubic(self, cubic_structure: dict) -> None:
        """Cubic lattice has diagonal metric tensor with a² entries."""
        g = ferrox.get_lattice_metric_tensor(cubic_structure)
        assert len(g) == 3 and all(len(row) == 3 for row in g)
        # Off-diagonal ~0, diagonal = a² ≈ 31.81
        assert abs(g[0][1]) < 1e-10 and abs(g[0][2]) < 1e-10 and abs(g[1][2]) < 1e-10
        expected = 5.64**2
        assert all(abs(g[i][i] - expected) < 0.01 for i in range(3))

    def test_metric_tensor_symmetric(self, triclinic_structure: dict) -> None:
        """Metric tensor is symmetric (G = G^T)."""
        g = ferrox.get_lattice_metric_tensor(triclinic_structure)
        assert abs(g[0][1] - g[1][0]) < 1e-10
        assert abs(g[0][2] - g[2][0]) < 1e-10
        assert abs(g[1][2] - g[2][1]) < 1e-10

    def test_metric_tensor_positive_diagonal(self, hexagonal_structure: dict) -> None:
        """Metric tensor diagonal elements are positive."""
        g = ferrox.get_lattice_metric_tensor(hexagonal_structure)
        assert all(g[i][i] > 0 for i in range(3))


class TestInverseMatrix:
    """Tests for get_lattice_inv_matrix."""

    def test_inv_matrix_cubic(self, cubic_structure: dict) -> None:
        """Cubic lattice inverse is diagonal with 1/a entries."""
        inv = ferrox.get_lattice_inv_matrix(cubic_structure)
        assert len(inv) == 3 and all(len(row) == 3 for row in inv)
        expected = 1.0 / 5.64
        assert abs(inv[0][1]) < 1e-10 and abs(inv[0][2]) < 1e-10
        assert all(abs(inv[i][i] - expected) < 1e-6 for i in range(3))

    def test_inv_matrix_product_is_identity(self, triclinic_structure: dict) -> None:
        """M * M^(-1) = I."""
        mat = np.array(triclinic_structure["lattice"]["matrix"])
        inv = np.array(ferrox.get_lattice_inv_matrix(triclinic_structure))
        assert np.allclose(mat @ inv, np.eye(3), atol=1e-10)


class TestReciprocalLattice:
    """Tests for get_reciprocal_lattice."""

    def test_reciprocal_cubic(self, cubic_structure: dict) -> None:
        """Cubic reciprocal lattice is diagonal with 2π/a magnitude."""
        recip = ferrox.get_reciprocal_lattice(cubic_structure)
        assert len(recip) == 3 and all(len(row) == 3 for row in recip)
        # Off-diagonal ~0
        assert (
            abs(recip[0][1]) < 1e-10
            and abs(recip[0][2]) < 1e-10
            and abs(recip[1][2]) < 1e-10
        )
        # Diagonal = 2π/a
        expected = 2 * math.pi / 5.64
        assert all(abs(recip[i][i] - expected) < 0.01 for i in range(3))

    def test_reciprocal_orthogonality(self, triclinic_structure: dict) -> None:
        """Real and reciprocal lattice vectors satisfy a_i · b_j = 2π δ_ij."""
        real_mat = np.array(triclinic_structure["lattice"]["matrix"])
        recip_mat = np.array(ferrox.get_reciprocal_lattice(triclinic_structure))
        assert np.allclose(real_mat @ recip_mat.T, 2 * math.pi * np.eye(3), atol=1e-6)


class TestLLLReduction:
    """Tests for get_lll_reduced_lattice and get_lll_mapping."""

    def test_lll_preserves_volume_and_lengths(self, triclinic_structure: dict) -> None:
        """LLL reduction preserves volume and vector lengths for well-conditioned lattice."""
        original_mat = np.array(triclinic_structure["lattice"]["matrix"])
        lll_mat = np.array(ferrox.get_lll_reduced_lattice(triclinic_structure))
        assert len(lll_mat) == 3 and all(len(row) == 3 for row in lll_mat)
        # Volume preserved
        assert (
            abs(abs(np.linalg.det(original_mat)) - abs(np.linalg.det(lll_mat))) < 1e-6
        )

    def test_lll_cubic_unchanged(self, cubic_structure: dict) -> None:
        """Cubic lattice is already reduced, vector lengths unchanged."""
        original = np.array(cubic_structure["lattice"]["matrix"])
        lll = np.array(ferrox.get_lll_reduced_lattice(cubic_structure))
        original_lengths = sorted(np.linalg.norm(original, axis=1))
        lll_lengths = sorted(np.linalg.norm(lll, axis=1))
        assert np.allclose(original_lengths, lll_lengths, atol=1e-6)

    def test_lll_mapping_properties(self, triclinic_structure: dict) -> None:
        """LLL mapping is integer matrix with det ±1."""
        mapping = np.array(ferrox.get_lll_mapping(triclinic_structure))
        assert len(mapping) == 3 and all(len(row) == 3 for row in mapping)
        # Integer entries
        assert np.allclose(mapping, np.round(mapping), atol=1e-10)
        # Unimodular (det = ±1)
        assert abs(abs(np.linalg.det(mapping)) - 1.0) < 1e-10


class TestLatticeEdgeCases:
    """Edge case tests for lattice functions."""

    @pytest.mark.parametrize(
        ("matrix", "expected_g00"),
        [
            ([[10.0, 0, 0], [0, 10.0, 0], [0, 0, 0.01]], 100.0),  # Nearly singular
            ([[100.0, 0, 0], [0, 100.0, 0], [0, 0, 100.0]], 10000.0),  # Large constants
        ],
    )
    def test_extreme_lattices(self, matrix: list, expected_g00: float) -> None:
        """Functions handle extreme lattice geometries."""
        struct = {
            "lattice": {"matrix": matrix},
            "sites": [{"species": [{"element": "C", "occu": 1.0}], "abc": [0, 0, 0]}],
        }
        g = ferrox.get_lattice_metric_tensor(struct)
        assert g is not None
        assert abs(g[0][0] - expected_g00) < 0.01
        assert ferrox.get_lattice_inv_matrix(struct) is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
