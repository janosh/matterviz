"""Tests for molecular dynamics integrators and state."""

from __future__ import annotations

import numpy as np
import pytest
from ferrox import md, optimizers

# === Fixtures ===


@pytest.fixture
def simple_positions() -> list[list[float]]:
    """Two-atom system for testing."""
    return [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]


@pytest.fixture
def masses() -> list[float]:
    """Masses for two-atom system (carbon-like)."""
    return [12.0, 12.0]


@pytest.fixture
def md_state(simple_positions: list[list[float]], masses: list[float]) -> md.MDState:
    """Create a basic MD state for testing."""
    return md.MDState(simple_positions, masses)


def harmonic_forces(positions: list[list[float]]) -> list[list[float]]:
    """Harmonic spring between atoms at equilibrium distance 2.0."""
    pos = np.array(positions)
    r_vec = pos[1] - pos[0]
    r = np.linalg.norm(r_vec)
    k = 1.0  # spring constant
    r0 = 2.0  # equilibrium distance
    force_mag = -k * (r - r0)
    force_dir = r_vec / r if r > 0 else np.zeros(3)
    f0 = force_mag * force_dir
    return [f0.tolist(), (-f0).tolist()]


# === MDState Tests ===


class TestMDState:
    """Tests for MDState class."""

    def test_init_basic(
        self, simple_positions: list[list[float]], masses: list[float]
    ) -> None:
        """MDState initializes with positions and masses."""
        state = md.MDState(simple_positions, masses)
        assert len(state.positions) == 2
        assert len(state.velocities) == 2
        assert len(state.forces) == 2

    def test_positions_accessible(self, md_state: md.MDState) -> None:
        """Positions are accessible and correct."""
        assert md_state.positions[0] == [0.0, 0.0, 0.0]
        assert md_state.positions[1] == [2.0, 0.0, 0.0]

    def test_velocities_initially_zero(self, md_state: md.MDState) -> None:
        """Velocities are initially zero."""
        for vel in md_state.velocities:
            assert vel == [0.0, 0.0, 0.0]

    def test_forces_initially_zero(self, md_state: md.MDState) -> None:
        """Forces are initially zero."""
        for force in md_state.forces:
            assert force == [0.0, 0.0, 0.0]

    def test_init_velocities(self, md_state: md.MDState) -> None:
        """init_velocities sets non-zero velocities."""
        md_state.init_velocities(300.0, seed=42)
        has_nonzero = any(
            any(abs(comp) > 1e-10 for comp in vel) for vel in md_state.velocities
        )
        assert has_nonzero

    def test_temperature_after_init(self, md_state: md.MDState) -> None:
        """Temperature is approximately target after init_velocities."""
        target_temp = 300.0
        md_state.init_velocities(target_temp, seed=42)
        actual_temp = md_state.temperature()
        # Allow wide tolerance for 2-atom system (only ~3 DOF after COM removal)
        # Statistical fluctuations scale as 1/sqrt(N_DOF), so can be very large
        assert 0.1 * target_temp < actual_temp < 5.0 * target_temp

    def test_kinetic_energy_positive_after_init(self, md_state: md.MDState) -> None:
        """Kinetic energy is positive after velocity initialization."""
        md_state.init_velocities(300.0, seed=42)
        ke = md_state.kinetic_energy()
        assert ke > 0

    def test_set_velocities(self, md_state: md.MDState) -> None:
        """Velocities can be set directly."""
        new_vels = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]]
        md_state.velocities = new_vels
        assert md_state.velocities[0][0] == pytest.approx(1.0)
        assert md_state.velocities[1][0] == pytest.approx(-1.0)

    def test_set_forces(self, md_state: md.MDState) -> None:
        """Forces can be set directly."""
        new_forces = [[0.5, 0.0, 0.0], [-0.5, 0.0, 0.0]]
        md_state.forces = new_forces
        assert md_state.forces[0][0] == pytest.approx(0.5)
        assert md_state.forces[1][0] == pytest.approx(-0.5)

    def test_num_atoms(self, md_state: md.MDState) -> None:
        """num_atoms returns correct count."""
        assert md_state.num_atoms() == 2


# === Velocity Verlet Tests ===


class TestVelocityVerlet:
    """Tests for velocity Verlet integrator."""

    def test_step_updates_positions(self, md_state: md.MDState) -> None:
        """Velocity Verlet step updates positions."""
        md_state.init_velocities(300.0, seed=42)
        orig_pos = [list(pos) for pos in md_state.positions]
        md.velocity_verlet_step(md_state, 1.0, harmonic_forces)
        assert md_state.positions != orig_pos


# === Langevin Tests ===


class TestLangevinIntegrator:
    """Tests for Langevin dynamics integrator."""

    def test_init(self) -> None:
        """LangevinIntegrator initializes with parameters."""
        integrator = md.LangevinIntegrator(300.0, 0.01, 1.0, seed=42)
        assert integrator is not None

    def test_step_runs(self, md_state: md.MDState) -> None:
        """Langevin step runs without error."""
        integrator = md.LangevinIntegrator(300.0, 0.01, 1.0, seed=42)
        integrator.step(md_state, harmonic_forces)

    def test_set_temperature(self) -> None:
        """set_temperature changes target temperature."""
        integrator = md.LangevinIntegrator(300.0, 0.01, 1.0, seed=42)
        integrator.set_temperature(500.0)
        # Verify temperature was changed if getter is available
        if hasattr(integrator, "temperature"):
            assert integrator.temperature == pytest.approx(500.0)


# === Nose-Hoover Tests ===


class TestNoseHooverChain:
    """Tests for Nosé-Hoover chain thermostat."""

    def test_init(self) -> None:
        """NoseHooverChain initializes with parameters."""
        n_dof = 6
        thermostat = md.NoseHooverChain(300.0, 100.0, 1.0, n_dof)
        assert thermostat is not None

    def test_step_runs(self, md_state: md.MDState) -> None:
        """Nose-Hoover step runs without error."""
        n_dof = 6
        thermostat = md.NoseHooverChain(300.0, 100.0, 1.0, n_dof)
        md_state.init_velocities(300.0, seed=42)
        thermostat.step(md_state, harmonic_forces)


# === Velocity Rescale Tests ===


class TestVelocityRescale:
    """Tests for velocity rescaling thermostat."""

    def test_init(self) -> None:
        """VelocityRescale initializes with parameters."""
        n_dof = 6
        thermostat = md.VelocityRescale(300.0, 100.0, 1.0, n_dof, seed=42)
        assert thermostat is not None

    def test_step_runs(self, md_state: md.MDState) -> None:
        """Velocity rescale step runs without error."""
        n_dof = 6
        thermostat = md.VelocityRescale(300.0, 100.0, 1.0, n_dof, seed=42)
        md_state.init_velocities(300.0, seed=42)
        thermostat.step(md_state, harmonic_forces)


# === FIRE Optimizer Tests ===


class TestFireOptimizer:
    """Tests for FIRE optimizer (in optimizers module)."""

    def test_fire_config_defaults(self) -> None:
        """FireConfig has sensible defaults."""
        config = optimizers.FireConfig()
        assert config.dt_start > 0
        assert config.dt_max > config.dt_start

    def test_fire_state_init(self) -> None:
        """FireState initializes with positions."""
        positions = [[0.0, 0.0, 0.0], [2.5, 0.0, 0.0]]
        state = optimizers.FireState(positions)
        assert len(state.positions) == 2


# === Edge Cases and Validation ===


class TestMDValidation:
    """Tests for input validation and edge cases."""

    def test_mismatched_lengths_raises(self) -> None:
        """Mismatched positions/masses lengths raise error."""
        positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]
        masses = [12.0]
        with pytest.raises((ValueError, RuntimeError)):
            md.MDState(positions, masses)

    def test_negative_mass_raises(self) -> None:
        """Negative mass raises error."""
        positions = [[0.0, 0.0, 0.0]]
        masses = [-12.0]
        with pytest.raises((ValueError, RuntimeError)):
            md.MDState(positions, masses)

    def test_zero_mass_raises(self) -> None:
        """Zero mass raises error."""
        positions = [[0.0, 0.0, 0.0]]
        masses = [0.0]
        with pytest.raises((ValueError, RuntimeError)):
            md.MDState(positions, masses)

    def test_force_callback_wrong_length_raises(self, md_state: md.MDState) -> None:
        """Force callback returning wrong number of forces raises error."""

        def bad_forces(_positions: list[list[float]]) -> list[list[float]]:
            return [[0.0, 0.0, 0.0]]

        md_state.init_velocities(300.0, seed=42)
        with pytest.raises((ValueError, RuntimeError)):
            md.velocity_verlet_step(md_state, 1.0, bad_forces)

    @pytest.mark.parametrize("temperature", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_init_velocities_invalid_temperature(
        self, md_state: md.MDState, temperature: float
    ) -> None:
        """NaN/Infinity temperature for init_velocities raises error."""
        with pytest.raises((ValueError, RuntimeError)):
            md_state.init_velocities(temperature, seed=42)

    @pytest.mark.parametrize("temperature", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_langevin_invalid_temperature(self, temperature: float) -> None:
        """NaN/Infinity temperature for LangevinIntegrator raises error."""
        with pytest.raises((ValueError, RuntimeError)):
            md.LangevinIntegrator(temperature, 0.01, 1.0, seed=42)

    @pytest.mark.parametrize("dt", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_langevin_invalid_dt(self, dt: float) -> None:
        """NaN/Infinity dt for LangevinIntegrator raises error."""
        with pytest.raises((ValueError, RuntimeError)):
            md.LangevinIntegrator(300.0, dt, 1.0, seed=42)

    @pytest.mark.parametrize("friction", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_langevin_invalid_friction(self, friction: float) -> None:
        """NaN/Infinity friction for LangevinIntegrator raises error."""
        with pytest.raises((ValueError, RuntimeError)):
            md.LangevinIntegrator(300.0, 0.01, friction, seed=42)

    @pytest.mark.parametrize("dt", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_velocity_verlet_invalid_dt(self, md_state: md.MDState, dt: float) -> None:
        """NaN/Infinity dt for velocity_verlet_step raises error."""
        md_state.init_velocities(300.0, seed=42)
        with pytest.raises((ValueError, RuntimeError)):
            md.velocity_verlet_step(md_state, dt, harmonic_forces)
