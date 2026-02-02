"""Tests for integrator error handling when force callbacks fail."""

import pytest
from ferrox import md


def failing_force_fn(_positions: list[list[float]]) -> list[list[float]]:
    """Force callback that always raises."""
    raise RuntimeError("Force computation failed")


def snapshot_state(state: md.MDState) -> tuple[list, list, list]:
    """Record positions, velocities, and forces."""
    return (
        [list(pos) for pos in state.positions],
        [list(vel) for vel in state.velocities],
        [list(force) for force in state.forces],
    )


def assert_state_unchanged(
    state: md.MDState, snapshot: tuple[list, list, list]
) -> None:
    """Verify state matches a previous snapshot."""
    orig_pos, orig_vel, orig_forces = snapshot
    for idx in range(len(orig_pos)):
        assert list(state.positions[idx]) == orig_pos[idx]
        assert list(state.velocities[idx]) == orig_vel[idx]
        assert list(state.forces[idx]) == orig_forces[idx]


@pytest.fixture
def md_state() -> md.MDState:
    """Create a simple MD state for testing."""
    state = md.MDState([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]], [12.0, 12.0])
    state.velocities = [[0.1, 0.05, -0.02], [-0.1, -0.05, 0.02]]
    state.forces = [[-0.1, 0.0, 0.0], [0.1, 0.0, 0.0]]
    return state


@pytest.fixture(
    params=[
        (
            "NoseHooverChain",
            {"target_temp": 300.0, "tau": 100.0, "dt": 1.0, "n_dof": 3},
        ),
        (
            "VelocityRescale",
            {"target_temp": 300.0, "tau": 100.0, "dt": 1.0, "n_dof": 3, "seed": 42},
        ),
        (
            "LangevinIntegrator",
            {"temperature_k": 300.0, "friction": 0.01, "dt": 1.0, "seed": 42},
        ),
    ],
    ids=["nose_hoover", "velocity_rescale", "langevin"],
)
def integrator(request: pytest.FixtureRequest) -> object:
    """Create integrator/thermostat for testing."""
    name, kwargs = request.param
    return getattr(md, name)(**kwargs)


def test_error_raises_exception(integrator: object, md_state: md.MDState) -> None:
    """Integrator.step() should raise when force callback fails."""
    with pytest.raises(RuntimeError, match="Force computation failed"):
        integrator.step(md_state, failing_force_fn)


def test_state_restored_on_error(integrator: object, md_state: md.MDState) -> None:
    """Integrator.step() should restore state when force callback fails."""
    original = snapshot_state(md_state)

    with pytest.raises(RuntimeError):
        integrator.step(md_state, failing_force_fn)

    assert_state_unchanged(md_state, original)
