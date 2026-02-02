"""Tests for integrator error handling when force callbacks fail."""

import ferrox
import pytest


def failing_force_fn(_positions: list[list[float]]) -> list[list[float]]:
    """Force callback that always raises."""
    raise RuntimeError("Force computation failed")


def snapshot_state(state: ferrox.MDState) -> tuple[list, list, list]:
    """Record positions, velocities, and forces."""
    return (
        [list(pos) for pos in state.positions],
        [list(vel) for vel in state.velocities],
        [list(force) for force in state.forces],
    )


def assert_state_unchanged(
    state: ferrox.MDState, snapshot: tuple[list, list, list]
) -> None:
    """Verify state matches a previous snapshot."""
    orig_pos, orig_vel, orig_forces = snapshot
    for idx in range(len(orig_pos)):
        assert list(state.positions[idx]) == orig_pos[idx]
        assert list(state.velocities[idx]) == orig_vel[idx]
        assert list(state.forces[idx]) == orig_forces[idx]


@pytest.fixture
def md_state() -> ferrox.MDState:
    """Create a simple MD state for testing."""
    state = ferrox.MDState([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]], [12.0, 12.0])
    state.velocities = [[0.1, 0.05, -0.02], [-0.1, -0.05, 0.02]]
    state.forces = [[-0.1, 0.0, 0.0], [0.1, 0.0, 0.0]]
    return state


@pytest.fixture
def nose_hoover() -> ferrox.NoseHooverChain:
    """Create NoseHooverChain thermostat."""
    return ferrox.NoseHooverChain(target_temp=300.0, tau=100.0, dt=1.0, n_dof=3)


@pytest.fixture
def velocity_rescale() -> ferrox.VelocityRescale:
    """Create VelocityRescale thermostat."""
    return ferrox.VelocityRescale(
        target_temp=300.0, tau=100.0, dt=1.0, n_dof=3, seed=42
    )


@pytest.fixture
def langevin() -> ferrox.LangevinIntegrator:
    """Create Langevin integrator."""
    return ferrox.LangevinIntegrator(
        temperature_k=300.0, friction=0.01, dt=1.0, seed=42
    )


@pytest.mark.parametrize(
    "thermostat_fixture", ["nose_hoover", "velocity_rescale", "langevin"]
)
def test_error_raises_exception(
    thermostat_fixture: str, md_state: ferrox.MDState, request: pytest.FixtureRequest
) -> None:
    """Thermostat.step() should raise when force callback fails."""
    thermostat = request.getfixturevalue(thermostat_fixture)
    with pytest.raises(RuntimeError, match="Force computation failed"):
        thermostat.step(md_state, failing_force_fn)


@pytest.mark.parametrize(
    "thermostat_fixture", ["nose_hoover", "velocity_rescale", "langevin"]
)
def test_state_restored_on_error(
    thermostat_fixture: str, md_state: ferrox.MDState, request: pytest.FixtureRequest
) -> None:
    """Thermostat.step() should restore state when force callback fails."""
    thermostat = request.getfixturevalue(thermostat_fixture)
    original = snapshot_state(md_state)

    with pytest.raises(RuntimeError):
        thermostat.step(md_state, failing_force_fn)

    assert_state_unchanged(md_state, original)
