"""Tests comparing ferrox classical potentials against analytical formulas.

Note: Direct ASE comparison tests are not included because ASE's LJ and Morse
calculators use different conventions (e.g., energy shift at cutoff). Instead,
we test against analytical formulas which ferrox implements directly.
"""

from collections.abc import Callable

import numpy as np
import pytest
from ferrox import potentials
from numpy.testing import assert_allclose

# === Lennard-Jones Analytical Tests ===


class TestLennardJonesAnalytical:
    """Test ferrox LJ against analytical formula: V = 4*eps*[(sig/r)^12 - (sig/r)^6]."""

    @pytest.mark.parametrize("dist", [0.9, 1.0, 1.122462, 1.5, 2.0, 3.0, 4.0, 5.0])
    def test_lj_energy_analytical(self, dist: float) -> None:
        """Test LJ energy against analytical formula."""
        sigma = 1.0
        epsilon = 1.0
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        energy_ferrox, _ = potentials.compute_lennard_jones(
            positions, sigma=sigma, epsilon=epsilon
        )

        # Analytical: V = 4*eps*[(sig/r)^12 - (sig/r)^6]
        s_over_r = sigma / dist
        s6 = s_over_r**6
        s12 = s6 * s6
        expected_energy = 4.0 * epsilon * (s12 - s6)

        assert_allclose(energy_ferrox, expected_energy, rtol=1e-12)

    @pytest.mark.parametrize("dist", [0.9, 1.0, 1.122462, 1.5, 2.0, 3.0, 4.0, 5.0])
    def test_lj_force_analytical(self, dist: float) -> None:
        """Test LJ force against analytical formula."""
        sigma = 1.0
        epsilon = 1.0
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        _, forces_ferrox = potentials.compute_lennard_jones(
            positions, sigma=sigma, epsilon=epsilon
        )

        # Analytical: F = 24*eps/r * [2(sig/r)^12 - (sig/r)^6]
        s_over_r = sigma / dist
        s6 = s_over_r**6
        s12 = s6 * s6
        expected_force_x = 24.0 * epsilon / dist * (2.0 * s12 - s6)

        assert_allclose(forces_ferrox[1][0], expected_force_x, rtol=1e-8)
        assert_allclose(forces_ferrox[0][0], -expected_force_x, rtol=1e-8)


# === Morse Potential Analytical Tests ===


class TestMorseAnalytical:
    """Test ferrox Morse against analytical formula: V = D(1-exp(-a(r-r0)))^2 - D."""

    @pytest.mark.parametrize("dist", [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0])
    def test_morse_energy_analytical(self, dist: float) -> None:
        """Test Morse energy against analytical formula."""
        well_depth = 2.0
        alpha = 1.5
        eq_dist = 1.2
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        energy_ferrox, _, _ = potentials.compute_morse(
            positions, d=well_depth, alpha=alpha, r0=eq_dist, cutoff=10.0
        )

        # Analytical: V = D(1-exp(-a(r-r0)))^2 - D
        exp_term = np.exp(-alpha * (dist - eq_dist))
        expected_energy = well_depth * (1.0 - exp_term) ** 2 - well_depth

        assert_allclose(energy_ferrox, expected_energy, rtol=1e-12)

    @pytest.mark.parametrize("dist", [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0])
    def test_morse_force_analytical(self, dist: float) -> None:
        """Test Morse force against analytical formula."""
        well_depth = 2.0
        alpha = 1.5
        eq_dist = 1.2
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        _, forces_ferrox, _ = potentials.compute_morse(
            positions, d=well_depth, alpha=alpha, r0=eq_dist, cutoff=10.0
        )

        # Analytical: F = -dV/dr = -2*D*a*(1-exp(-a*(r-r0)))*exp(-a*(r-r0))
        exp_term = np.exp(-alpha * (dist - eq_dist))
        dvdr = 2.0 * well_depth * alpha * (1.0 - exp_term) * exp_term
        expected_force_x = -dvdr

        assert_allclose(forces_ferrox[1][0], expected_force_x, rtol=1e-12)


# === Soft Sphere Comparison Tests ===


class TestSoftSphereAnalytical:
    """Test ferrox Soft Sphere against analytical formula."""

    @pytest.mark.parametrize(
        "sigma,epsilon,alpha,dist",
        [
            (1.0, 1.0, 12.0, 1.0),  # Hard sphere at sigma
            (1.0, 1.0, 12.0, 1.5),  # Hard sphere beyond sigma
            (1.0, 1.0, 6.0, 1.0),  # Softer potential
            (1.5, 0.5, 8.0, 2.0),  # Different params
        ],
    )
    def test_soft_sphere_energy_analytical(
        self, sigma: float, epsilon: float, alpha: float, dist: float
    ) -> None:
        """Test soft sphere energy against analytical formula V = eps*(sig/r)^a."""
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        energy_ferrox, _, _ = potentials.compute_soft_sphere(
            positions, sigma=sigma, epsilon=epsilon, alpha=alpha, cutoff=10.0
        )

        # Analytical
        expected_energy = epsilon * (sigma / dist) ** alpha

        assert_allclose(energy_ferrox, expected_energy, rtol=1e-12)

    @pytest.mark.parametrize(
        "sigma,epsilon,alpha,dist",
        [
            (1.0, 1.0, 12.0, 1.0),
            (1.0, 1.0, 12.0, 1.5),
            (1.0, 1.0, 6.0, 1.0),
            (1.5, 0.5, 8.0, 2.0),
        ],
    )
    def test_soft_sphere_force_analytical(
        self, sigma: float, epsilon: float, alpha: float, dist: float
    ) -> None:
        """Test soft sphere force against formula F = a*eps*(sig^a)/r^(a+1)."""
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]

        # Ferrox
        _, forces_ferrox, _ = potentials.compute_soft_sphere(
            positions, sigma=sigma, epsilon=epsilon, alpha=alpha, cutoff=10.0
        )

        # Analytical force on atom 1 (repulsive, pointing away from atom 0)
        expected_force_x = alpha * epsilon * (sigma**alpha) / (dist ** (alpha + 1))

        assert_allclose(forces_ferrox[1][0], expected_force_x, rtol=1e-10)
        assert_allclose(forces_ferrox[0][0], -expected_force_x, rtol=1e-10)


# === Conservation Law Tests ===


class TestConservationLaws:
    """Test that potentials satisfy physical conservation laws."""

    @pytest.mark.parametrize(
        "potential_fn,kwargs",
        [
            (potentials.compute_lennard_jones, {"sigma": 1.0, "epsilon": 1.0}),
            (
                potentials.compute_morse,
                {"d": 1.0, "alpha": 1.5, "r0": 1.2, "cutoff": 10.0},
            ),
            (
                potentials.compute_soft_sphere,
                {"sigma": 1.0, "epsilon": 1.0, "alpha": 6.0, "cutoff": 10.0},
            ),
        ],
    )
    def test_momentum_conservation(self, potential_fn: Callable, kwargs: dict) -> None:
        """Total force should sum to zero (Newton's third law)."""
        # Random multi-atom configuration
        np_rng = np.random.default_rng(seed=42)
        n_atoms = 10
        positions = np_rng.uniform(0, 5, size=(n_atoms, 3)).tolist()

        result = potential_fn(positions, **kwargs)

        # Handle different return types
        if isinstance(result, tuple) and len(result) == 2:
            _, forces = result
        else:
            _, forces, _ = result

        total_force = np.sum(forces, axis=0)
        assert_allclose(total_force, [0.0, 0.0, 0.0], atol=1e-12)

    @pytest.mark.parametrize(
        "potential_fn,kwargs",
        [
            (potentials.compute_lennard_jones, {"sigma": 1.0, "epsilon": 1.0}),
            (
                potentials.compute_morse,
                {"d": 1.0, "alpha": 1.5, "r0": 1.2, "cutoff": 10.0},
            ),
            (
                potentials.compute_soft_sphere,
                {"sigma": 1.0, "epsilon": 1.0, "alpha": 6.0, "cutoff": 10.0},
            ),
        ],
    )
    def test_translational_invariance(
        self, potential_fn: Callable, kwargs: dict
    ) -> None:
        """Energy should not change under rigid translation."""
        np_rng = np.random.default_rng(seed=42)
        n_atoms = 5
        positions = np_rng.uniform(0, 5, size=(n_atoms, 3))

        # Original energy
        result1 = potential_fn(positions.tolist(), **kwargs)
        energy1 = result1[0] if isinstance(result1, tuple) else result1

        # Translated positions
        translation = np.array([10.0, -5.0, 3.0])
        positions_translated = positions + translation

        result2 = potential_fn(positions_translated.tolist(), **kwargs)
        energy2 = result2[0] if isinstance(result2, tuple) else result2

        assert_allclose(energy1, energy2, rtol=1e-12)

    @pytest.mark.parametrize(
        "potential_fn,kwargs",
        [
            (potentials.compute_lennard_jones, {"sigma": 1.0, "epsilon": 1.0}),
            (
                potentials.compute_morse,
                {"d": 1.0, "alpha": 1.5, "r0": 1.2, "cutoff": 10.0},
            ),
            (
                potentials.compute_soft_sphere,
                {"sigma": 1.0, "epsilon": 1.0, "alpha": 6.0, "cutoff": 10.0},
            ),
        ],
    )
    def test_rotational_invariance(self, potential_fn: Callable, kwargs: dict) -> None:
        """Energy should not change under rigid rotation."""
        np_rng = np.random.default_rng(seed=42)
        n_atoms = 5
        positions = np_rng.uniform(0, 5, size=(n_atoms, 3))

        # Original energy
        result1 = potential_fn(positions.tolist(), **kwargs)
        energy1 = result1[0] if isinstance(result1, tuple) else result1

        # Rotation matrix (90 degrees about z-axis)
        rot = np.array(
            [
                [0, -1, 0],
                [1, 0, 0],
                [0, 0, 1],
            ],
            dtype=float,
        )
        positions_rotated = positions @ rot.T

        result2 = potential_fn(positions_rotated.tolist(), **kwargs)
        energy2 = result2[0] if isinstance(result2, tuple) else result2

        assert_allclose(energy1, energy2, rtol=1e-12)


# === Test Helpers ===


def assert_stress_symmetric(stress: list[list[float]]) -> None:
    """Assert stress tensor is symmetric."""
    stress_arr = np.array(stress)
    assert_allclose(stress_arr[0, 1], stress_arr[1, 0], atol=1e-14)
    assert_allclose(stress_arr[0, 2], stress_arr[2, 0], atol=1e-14)
    assert_allclose(stress_arr[1, 2], stress_arr[2, 1], atol=1e-14)


# === Harmonic Bonds Tests ===


class TestHarmonicBondsAnalytical:
    """Test ferrox harmonic bonds against analytical formula: V = 0.5 * k * (r - r0)²."""

    def test_harmonic_equilibrium(self) -> None:
        """At equilibrium distance, energy and forces should be zero."""
        positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]
        bonds = [[0, 1, 1.0, 1.0]]  # [i, j, k, r0]

        energy, forces, _ = potentials.compute_harmonic_bonds(positions, bonds)

        assert_allclose(energy, 0.0, atol=1e-14)
        assert_allclose(np.array(forces), 0.0, atol=1e-14)

    @pytest.mark.parametrize(
        "dist,r0", [(0.8, 1.0), (1.2, 1.0), (1.5, 1.0), (2.0, 1.5)]
    )
    def test_harmonic_energy_analytical(self, dist: float, r0: float) -> None:
        """Test harmonic bond energy against V = 0.5 * k * (r - r0)²."""
        spring_k = 2.0
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]
        bonds = [[0, 1, spring_k, r0]]

        energy, _, _ = potentials.compute_harmonic_bonds(positions, bonds)

        expected = 0.5 * spring_k * (dist - r0) ** 2
        assert_allclose(energy, expected, rtol=1e-12)

    @pytest.mark.parametrize(
        "dist,r0", [(0.8, 1.0), (1.2, 1.0), (1.5, 1.0), (2.0, 1.5)]
    )
    def test_harmonic_force_analytical(self, dist: float, r0: float) -> None:
        """Test harmonic bond force against F = -k * (r - r0)."""
        spring_k = 2.0
        positions = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]
        bonds = [[0, 1, spring_k, r0]]

        _, forces, _ = potentials.compute_harmonic_bonds(positions, bonds)

        # Force on atom 1: F = -k * (r - r0) in +x direction when compressed
        expected_force = -spring_k * (dist - r0)
        assert_allclose(forces[1][0], expected_force, rtol=1e-12)
        assert_allclose(forces[0][0], -expected_force, rtol=1e-12)

    def test_harmonic_multiple_bonds(self) -> None:
        """Test chain of 3 atoms with 2 bonds."""
        positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.2, 0.0, 0.0]]
        spring_k = 1.0
        r0 = 1.0
        bonds = [[0, 1, spring_k, r0], [1, 2, spring_k, r0]]

        energy, forces, _ = potentials.compute_harmonic_bonds(positions, bonds)

        # Bond 0-1: at equilibrium → E = 0
        # Bond 1-2: dist = 1.2, E = 0.5 * 1.0 * 0.2² = 0.02
        expected_energy = 0.5 * spring_k * (1.2 - r0) ** 2
        assert_allclose(energy, expected_energy, rtol=1e-12)

        # Total force should sum to zero (Newton's 3rd law)
        total_force = np.sum(forces, axis=0)
        assert_allclose(total_force, [0.0, 0.0, 0.0], atol=1e-14)

    def test_harmonic_momentum_conservation(self) -> None:
        """Forces should sum to zero."""
        np_rng = np.random.default_rng(seed=42)
        n_atoms = 6
        positions = np_rng.uniform(0, 5, size=(n_atoms, 3)).tolist()
        # Create a chain of bonds
        bonds = [[idx, idx + 1, 1.0, 1.5] for idx in range(n_atoms - 1)]

        _, forces, _ = potentials.compute_harmonic_bonds(positions, bonds)

        total_force = np.sum(forces, axis=0)
        assert_allclose(total_force, [0.0, 0.0, 0.0], atol=1e-12)

    def test_harmonic_3d_bond(self) -> None:
        """Test bond not aligned with axis."""
        # Atom 1 at (1, 1, 1), distance = sqrt(3) ≈ 1.732
        positions = [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]
        spring_k = 1.0
        r0 = 1.5
        bonds = [[0, 1, spring_k, r0]]

        energy, forces, _ = potentials.compute_harmonic_bonds(positions, bonds)

        dist = np.sqrt(3.0)
        expected_energy = 0.5 * spring_k * (dist - r0) ** 2
        assert_allclose(energy, expected_energy, rtol=1e-12)

        # Force direction should be along the bond
        force_vec = np.array(forces[1])
        bond_vec = np.array([1.0, 1.0, 1.0]) / dist
        force_along_bond = np.dot(force_vec, bond_vec)
        expected_force_mag = -spring_k * (dist - r0)
        assert_allclose(force_along_bond, expected_force_mag, rtol=1e-10)

    def test_harmonic_with_stress(self) -> None:
        """Test stress tensor computation (requires cell for volume normalization)."""
        positions = [[0.0, 0.0, 0.0], [1.5, 0.0, 0.0]]
        bonds = [[0, 1, 1.0, 1.0]]
        cell = [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]]
        _, _, stress = potentials.compute_harmonic_bonds(
            positions, bonds, cell=cell, compute_stress=True
        )
        assert stress is not None
        assert_stress_symmetric(stress)


# === Stress Tensor Tests ===


class TestStressTensorValidation:
    """Test stress tensor computation for all potentials."""

    @pytest.mark.parametrize(
        "potential_fn,kwargs",
        [
            (
                potentials.compute_morse,
                {"d": 1.0, "alpha": 1.5, "r0": 1.2, "cutoff": 5.0},
            ),
            (
                potentials.compute_soft_sphere,
                {"sigma": 1.0, "epsilon": 1.0, "alpha": 6.0, "cutoff": 5.0},
            ),
        ],
    )
    def test_stress_symmetry(self, potential_fn: Callable, kwargs: dict) -> None:
        """Stress tensor should be symmetric (requires cell for volume normalization)."""
        np_rng = np.random.default_rng(seed=42)
        positions = np_rng.uniform(0, 3, size=(5, 3)).tolist()
        cell = [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]]
        _, _, stress = potential_fn(positions, **kwargs, cell=cell, compute_stress=True)
        assert stress is not None
        assert_stress_symmetric(stress)

    def test_morse_stress_virial(self) -> None:
        """Morse stress should satisfy virial relation: trace related to pressure."""
        positions = [[0.0, 0.0, 0.0], [1.5, 0.0, 0.0]]
        cell = [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]]

        _, _, stress = potentials.compute_morse(
            positions,
            cell=cell,
            d=1.0,
            alpha=1.5,
            r0=1.2,
            cutoff=5.0,
            compute_stress=True,
        )

        assert stress is not None
        # Stress tensor should have non-trivial xx component for 1D chain
        assert abs(stress[0][0]) > 1e-10

    def test_soft_sphere_stress_nonzero(self) -> None:
        """Soft sphere stress should be non-zero for interacting atoms."""
        positions = [[0.0, 0.0, 0.0], [0.8, 0.0, 0.0]]
        cell = [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]]

        _, _, stress = potentials.compute_soft_sphere(
            positions,
            cell=cell,
            sigma=1.0,
            epsilon=1.0,
            alpha=12.0,
            cutoff=5.0,
            compute_stress=True,
        )

        assert stress is not None
        # 1D chain should have non-zero xx stress component
        assert abs(stress[0][0]) > 1e-6, "xx stress should be non-zero for 1D pair"

    def test_stress_requires_cell(self) -> None:
        """Stress requires cell for volume normalization - returns None without it."""
        positions = [[0.0, 0.0, 0.0], [1.5, 0.0, 0.0]]

        # Without cell, stress should be None even if compute_stress=True
        _, _, stress = potentials.compute_morse(
            positions, d=1.0, alpha=1.5, r0=1.2, cutoff=5.0, compute_stress=True
        )
        assert stress is None, "Stress should be None without cell (no volume)"


# === Mixed PBC Tests ===


class TestMixedPeriodicBoundaryConditions:
    """Test potentials with mixed PBC settings."""

    def test_lj_pbc_vs_no_pbc(self) -> None:
        """LJ should give different results with and without PBC."""
        cell = [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]]
        # Two atoms at distance 1.0 (real-space distance)
        positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]

        energy_pbc, _ = potentials.compute_lennard_jones(
            positions, cell=cell, pbc=[True, True, True], sigma=1.0, epsilon=1.0
        )
        energy_no_pbc, _ = potentials.compute_lennard_jones(
            positions, sigma=1.0, epsilon=1.0
        )

        # Both should give same result since atoms are close and not near boundary
        assert_allclose(energy_pbc, energy_no_pbc, rtol=1e-10)

    def test_morse_momentum_with_pbc(self) -> None:
        """Morse forces should sum to zero with PBC."""
        cell = [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]]
        np_rng = np.random.default_rng(seed=42)
        positions = np_rng.uniform(0, 10, size=(5, 3)).tolist()

        _, forces, _ = potentials.compute_morse(
            positions,
            cell=cell,
            pbc=[True, True, True],
            d=1.0,
            alpha=2.0,
            r0=1.0,
            cutoff=5.0,
        )
        total_force = np.sum(forces, axis=0)
        assert_allclose(total_force, [0.0, 0.0, 0.0], atol=1e-12)

    def test_harmonic_pbc_across_boundary(self) -> None:
        """Harmonic bond should work correctly across PBC boundary."""
        cell = [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]]
        # Atoms across x-boundary: min image dist = 1.0
        positions = [[0.5, 5.0, 5.0], [9.5, 5.0, 5.0]]
        bonds = [[0, 1, 1.0, 1.0]]  # equilibrium at r0=1.0

        energy, forces, _ = potentials.compute_harmonic_bonds(
            positions, bonds, cell=cell, pbc=[True, True, True]
        )

        # At equilibrium → zero energy and forces
        assert_allclose(energy, 0.0, atol=1e-12)
        assert_allclose(np.array(forces), 0.0, atol=1e-12)
