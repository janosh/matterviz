//! Velocity Verlet integrator (NVE ensemble).

use nalgebra::Vector3;

use super::state::MDState;
use super::units;

fn validate_dt(dt_fs: f64) {
    assert!(
        dt_fs > 0.0 && dt_fs.is_finite(),
        "velocity_verlet requires dt_fs > 0 and finite (got {dt_fs})"
    );
}

/// First half of velocity Verlet: update velocities and positions.
/// After this, compute new forces and call `velocity_verlet_finalize`.
pub fn velocity_verlet_init(mut state: MDState, dt_fs: f64) -> MDState {
    validate_dt(dt_fs);
    let dt = dt_fs * units::FS_TO_INTERNAL;
    for ((pos, vel), (&force, &mass)) in state
        .positions
        .iter_mut()
        .zip(&mut state.velocities)
        .zip(state.forces.iter().zip(&state.masses))
    {
        let accel = force / mass;
        *vel += 0.5 * dt * accel;
        *pos += dt * *vel;
    }
    state
}

/// Complete velocity Verlet with new forces.
pub fn velocity_verlet_finalize(
    mut state: MDState,
    dt_fs: f64,
    new_forces: &[Vector3<f64>],
) -> MDState {
    validate_dt(dt_fs);
    assert_eq!(
        new_forces.len(),
        state.num_atoms(),
        "new_forces.len() must match state.num_atoms()"
    );
    let dt = dt_fs * units::FS_TO_INTERNAL;
    state.forces = new_forces.to_vec();
    for (vel, (&force, &mass)) in state
        .velocities
        .iter_mut()
        .zip(state.forces.iter().zip(&state.masses))
    {
        *vel += 0.5 * dt * force / mass;
    }
    state
}

/// Complete velocity Verlet step with force function.
pub fn velocity_verlet_step<F>(state: MDState, dt_fs: f64, mut compute_forces: F) -> MDState
where
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    let state = velocity_verlet_init(state, dt_fs);
    let new_forces = compute_forces(&state.positions);
    velocity_verlet_finalize(state, dt_fs, &new_forces)
}

/// Complete velocity Verlet step with fallible force function.
///
/// If the force computation fails, the original state is returned along with the error.
///
/// # Errors
/// Returns the error from compute_forces if it fails, along with the original state.
#[allow(clippy::result_large_err)]
pub fn try_velocity_verlet_step<F, E>(
    state: MDState,
    dt_fs: f64,
    mut compute_forces: F,
) -> Result<MDState, (MDState, E)>
where
    F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
{
    if state.num_atoms() == 0 {
        return Ok(state);
    }
    let original_state = state.clone();
    let state = velocity_verlet_init(state, dt_fs);
    match compute_forces(&state.positions) {
        Ok(new_forces) => Ok(velocity_verlet_finalize(state, dt_fs, &new_forces)),
        Err(err) => Err((original_state, err)),
    }
}
