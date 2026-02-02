//! Molecular dynamics integrators WASM bindings.

use nalgebra::Vector3;
use wasm_bindgen::prelude::*;

use crate::md;
use crate::wasm_types::WasmResult;

use super::helpers::{
    parse_flat_cell, parse_flat_vec3, validate_n_dof, validate_positive_f64, validate_temperature,
};

/// Parse flat 9-element stress tensor to Matrix3.
#[inline]
fn parse_stress(stress: &[f64]) -> Result<nalgebra::Matrix3<f64>, String> {
    // Reuse parse_flat_cell logic but unwrap the Option
    parse_flat_cell(Some(stress)).map(|opt| opt.unwrap())
}

/// MD simulation state for WASM.
#[wasm_bindgen]
pub struct JsMDState {
    pub(crate) inner: md::MDState,
}

#[wasm_bindgen]
impl JsMDState {
    /// Create a new MD state.
    ///
    /// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
    /// masses: array of atomic masses in amu
    #[wasm_bindgen(constructor)]
    pub fn new(positions: Vec<f64>, masses: Vec<f64>) -> Result<JsMDState, JsError> {
        let n_atoms = masses.len();
        if positions.len() != n_atoms * 3 {
            return Err(JsError::new(&format!(
                "positions length {} must be 3 * masses length {}",
                positions.len(),
                n_atoms
            )));
        }
        // Validate masses are positive and finite
        for (idx, &mass) in masses.iter().enumerate() {
            if !mass.is_finite() || mass <= 0.0 {
                return Err(JsError::new(&format!(
                    "Mass at index {idx} must be positive and finite, got {mass}"
                )));
            }
        }
        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        Ok(JsMDState {
            inner: md::MDState::new(pos_vec, masses),
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Set positions from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_positions(&mut self, positions: Vec<f64>) -> Result<(), JsError> {
        self.inner.positions =
            parse_flat_vec3(&positions, self.inner.num_atoms()).map_err(|e| JsError::new(&e))?;
        Ok(())
    }

    /// Get velocities as flat array.
    #[wasm_bindgen(getter)]
    pub fn velocities(&self) -> Vec<f64> {
        self.inner
            .velocities
            .iter()
            .flat_map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Set velocities from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_velocities(&mut self, velocities: Vec<f64>) -> Result<(), JsError> {
        self.inner.velocities =
            parse_flat_vec3(&velocities, self.inner.num_atoms()).map_err(|e| JsError::new(&e))?;
        Ok(())
    }

    /// Get forces as flat array.
    #[wasm_bindgen(getter)]
    pub fn forces(&self) -> Vec<f64> {
        self.inner
            .forces
            .iter()
            .flat_map(|f| [f.x, f.y, f.z])
            .collect()
    }

    /// Set forces from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_forces(&mut self, forces: Vec<f64>) -> Result<(), JsError> {
        self.inner.forces =
            parse_flat_vec3(&forces, self.inner.num_atoms()).map_err(|e| JsError::new(&e))?;
        Ok(())
    }

    /// Get masses.
    #[wasm_bindgen(getter)]
    pub fn masses(&self) -> Vec<f64> {
        self.inner.masses.clone()
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution.
    #[wasm_bindgen]
    pub fn init_velocities(
        &mut self,
        temperature_k: f64,
        seed: Option<u64>,
    ) -> Result<(), JsError> {
        validate_temperature(temperature_k).map_err(|err| JsError::new(&err))?;
        self.inner.init_velocities(temperature_k, seed);
        Ok(())
    }

    /// Compute kinetic energy in eV.
    #[wasm_bindgen]
    pub fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Compute temperature in Kelvin.
    #[wasm_bindgen]
    pub fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Set cell matrix (9 elements, row-major).
    #[wasm_bindgen]
    pub fn set_cell(
        &mut self,
        cell: Vec<f64>,
        pbc_x: bool,
        pbc_y: bool,
        pbc_z: bool,
    ) -> Result<(), JsError> {
        if cell.len() != 9 {
            return Err(JsError::new(&format!(
                "cell must have 9 elements, got {}",
                cell.len()
            )));
        }
        self.inner.cell = Some(nalgebra::Matrix3::new(
            cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
        ));
        self.inner.pbc = [pbc_x, pbc_y, pbc_z];
        Ok(())
    }
}

/// Perform one velocity Verlet MD step (half-step velocity update + full position update).
///
/// This function updates positions and velocities in-place. The caller must:
/// 1. Call this function with current forces
/// 2. Compute new forces at the updated positions
/// 3. Call `md_velocity_verlet_finish` with new forces to complete the velocity update
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// dt_fs: timestep in femtoseconds (must be finite and positive)
#[wasm_bindgen]
pub fn md_velocity_verlet_step(
    state: &mut JsMDState,
    forces: Vec<f64>,
    dt_fs: f64,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        validate_positive_f64(dt_fs, "dt_fs")?;
        let n_atoms = state.inner.num_atoms();
        let force_vec = parse_flat_vec3(&forces, n_atoms)?;
        state.inner.set_forces(&force_vec);
        // Velocity Verlet: half-step velocity, full-step position
        let dt_internal = dt_fs * md::FS_TO_INTERNAL;
        let half_dt = 0.5 * dt_internal;
        for idx in 0..n_atoms {
            let mass = state.inner.masses[idx];
            let accel = state.inner.forces[idx] / mass;
            state.inner.velocities[idx] += half_dt * accel;
            state.inner.positions[idx] += dt_internal * state.inner.velocities[idx];
        }
        Ok(())
    })();
    result.into()
}

/// Complete the velocity Verlet step after computing new forces.
#[wasm_bindgen]
pub fn md_velocity_verlet_finalize(
    state: &mut JsMDState,
    new_forces: Vec<f64>,
    dt_fs: f64,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        validate_positive_f64(dt_fs, "dt_fs")?;
        let n_atoms = state.inner.num_atoms();
        let force_vec = parse_flat_vec3(&new_forces, n_atoms)?;
        state.inner.set_forces(&force_vec);
        let dt_internal = dt_fs * md::FS_TO_INTERNAL;
        let half_dt = 0.5 * dt_internal;
        for idx in 0..n_atoms {
            let mass = state.inner.masses[idx];
            let accel = state.inner.forces[idx] / mass;
            state.inner.velocities[idx] += half_dt * accel;
        }
        Ok(())
    })();
    result.into()
}

/// Langevin dynamics integrator for NVT ensemble.
#[wasm_bindgen]
pub struct JsLangevinIntegrator {
    inner: md::LangevinIntegrator,
}

#[wasm_bindgen]
impl JsLangevinIntegrator {
    /// Create a new Langevin integrator.
    ///
    /// temperature_k: target temperature in Kelvin (must be non-negative)
    /// friction: friction coefficient in 1/fs (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// seed: optional RNG seed for reproducibility
    #[wasm_bindgen(constructor)]
    pub fn new(
        temperature_k: f64,
        friction: f64,
        dt: f64,
        seed: Option<u64>,
    ) -> Result<JsLangevinIntegrator, JsError> {
        validate_temperature(temperature_k).map_err(|err| JsError::new(&err))?;
        validate_positive_f64(friction, "friction").map_err(|err| JsError::new(&err))?;
        validate_positive_f64(dt, "timestep dt").map_err(|err| JsError::new(&err))?;
        Ok(JsLangevinIntegrator {
            inner: md::LangevinIntegrator::new(temperature_k, friction, dt, seed),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, temperature_k: f64) -> Result<(), JsError> {
        validate_temperature(temperature_k).map_err(|err| JsError::new(&err))?;
        self.inner.set_temperature(temperature_k);
        Ok(())
    }

    /// Set friction coefficient.
    #[wasm_bindgen]
    pub fn set_friction(&mut self, friction: f64) -> Result<(), JsError> {
        validate_positive_f64(friction, "friction").map_err(|err| JsError::new(&err))?;
        self.inner.set_friction(friction);
        Ok(())
    }

    /// Set timestep.
    #[wasm_bindgen]
    pub fn set_dt(&mut self, dt: f64) -> Result<(), JsError> {
        validate_positive_f64(dt, "timestep dt").map_err(|err| JsError::new(&err))?;
        self.inner.set_dt(dt);
        Ok(())
    }
}

/// Perform the first part of a Langevin step (B-A-O-A: velocity half-step, position update,
/// thermostat).
///
/// This is the split API for proper force handling:
/// 1. Call `langevin_step_init` with current forces
/// 2. Get new positions from `state.positions`
/// 3. Compute forces at new positions
/// 4. Call `langevin_step_finalize` with new forces
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
#[wasm_bindgen]
pub fn langevin_step_init(
    integrator: &mut JsLangevinIntegrator,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        state.inner.forces = parse_flat_vec3(&forces, state.inner.num_atoms())?;
        integrator.inner.step_init(&mut state.inner);
        Ok(())
    })();
    result.into()
}

/// Complete a Langevin step after `langevin_step_init` (final velocity half-step with new
/// forces).
///
/// new_forces: flat array of forces computed at the updated positions [Fx0, Fy0, Fz0, ...]
#[wasm_bindgen]
pub fn langevin_step_finalize(
    integrator: &JsLangevinIntegrator,
    state: &mut JsMDState,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let force_vec = parse_flat_vec3(&new_forces, state.inner.num_atoms())?;
        integrator
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

/// Perform one complete Langevin dynamics step with both old and new forces.
///
/// This is a convenience wrapper that combines `langevin_step_init` and `langevin_step_finalize`.
/// Use this when you can pre-compute both the current forces and the forces at the new positions.
///
/// For most use cases, prefer the split API (`langevin_step_init` + `langevin_step_finalize`)
/// which allows computing forces at the updated positions between the two calls.
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// new_forces: flat array of forces at updated positions in eV/Angstrom
#[wasm_bindgen]
pub fn langevin_step_with_forces(
    integrator: &mut JsLangevinIntegrator,
    state: &mut JsMDState,
    forces: Vec<f64>,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        state.inner.forces = parse_flat_vec3(&forces, n_atoms)?;
        integrator.inner.step_init(&mut state.inner);
        let force_vec = parse_flat_vec3(&new_forces, n_atoms)?;
        integrator
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

// === Thermostats ===

/// Nose-Hoover chain thermostat for NVT ensemble.
#[wasm_bindgen]
pub struct JsNoseHooverChain {
    inner: md::NoseHooverChain,
}

#[wasm_bindgen]
impl JsNoseHooverChain {
    /// Create a new Nose-Hoover chain thermostat.
    ///
    /// target_temp: target temperature in Kelvin (must be non-negative)
    /// tau: coupling time constant in femtoseconds (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// n_dof: number of degrees of freedom (typically 3 * n_atoms - 3, must be > 0)
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_temp: f64,
        tau: f64,
        dt: f64,
        n_dof: usize,
    ) -> Result<JsNoseHooverChain, JsError> {
        validate_temperature(target_temp).map_err(|err| JsError::new(&err))?;
        validate_positive_f64(tau, "coupling time constant tau")
            .map_err(|err| JsError::new(&err))?;
        validate_positive_f64(dt, "timestep dt").map_err(|err| JsError::new(&err))?;
        validate_n_dof(n_dof).map_err(|err| JsError::new(&err))?;
        Ok(JsNoseHooverChain {
            inner: md::NoseHooverChain::new(target_temp, tau, dt, n_dof),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) -> Result<(), JsError> {
        validate_temperature(target_temp).map_err(|err| JsError::new(&err))?;
        self.inner.set_temperature(target_temp);
        Ok(())
    }
}

/// Perform the first part of a Nosé-Hoover step (thermostat half-step + velocity half-step +
/// position update).
///
/// This is the split API for proper force handling:
/// 1. Call `nose_hoover_step_init` with current forces
/// 2. Get new positions from `state.positions`
/// 3. Compute forces at new positions
/// 4. Call `nose_hoover_step_finalize` with new forces
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
#[wasm_bindgen]
pub fn nose_hoover_step_init(
    thermostat: &mut JsNoseHooverChain,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        state.inner.forces = parse_flat_vec3(&forces, state.inner.num_atoms())?;
        thermostat.inner.step_init(&mut state.inner);
        Ok(())
    })();
    result.into()
}

/// Complete a Nosé-Hoover step after `nose_hoover_step_init` (velocity half-step with new forces
/// + second thermostat half-step).
///
/// new_forces: flat array of forces computed at the updated positions [Fx0, Fy0, Fz0, ...]
#[wasm_bindgen]
pub fn nose_hoover_step_finalize(
    thermostat: &mut JsNoseHooverChain,
    state: &mut JsMDState,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let force_vec = parse_flat_vec3(&new_forces, state.inner.num_atoms())?;
        thermostat
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

/// Perform one complete Nosé-Hoover chain step with both old and new forces.
///
/// This is a convenience wrapper that combines `nose_hoover_step_init` and
/// `nose_hoover_step_finalize`.
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// new_forces: flat array of forces at updated positions in eV/Angstrom
#[wasm_bindgen]
pub fn nose_hoover_step_with_forces(
    thermostat: &mut JsNoseHooverChain,
    state: &mut JsMDState,
    forces: Vec<f64>,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        state.inner.forces = parse_flat_vec3(&forces, n_atoms)?;
        thermostat.inner.step_init(&mut state.inner);
        let force_vec = parse_flat_vec3(&new_forces, n_atoms)?;
        thermostat
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

/// Velocity rescaling thermostat (stochastic, canonical sampling).
#[wasm_bindgen]
pub struct JsVelocityRescale {
    inner: md::VelocityRescale,
}

#[wasm_bindgen]
impl JsVelocityRescale {
    /// Create a new velocity rescale thermostat.
    ///
    /// target_temp: target temperature in Kelvin (must be non-negative)
    /// tau: coupling time constant in femtoseconds (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// n_dof: number of degrees of freedom (must be > 0)
    /// seed: optional RNG seed
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_temp: f64,
        tau: f64,
        dt: f64,
        n_dof: usize,
        seed: Option<u64>,
    ) -> Result<JsVelocityRescale, JsError> {
        validate_temperature(target_temp).map_err(|err| JsError::new(&err))?;
        validate_positive_f64(tau, "coupling time constant tau")
            .map_err(|err| JsError::new(&err))?;
        validate_positive_f64(dt, "timestep dt").map_err(|err| JsError::new(&err))?;
        validate_n_dof(n_dof).map_err(|err| JsError::new(&err))?;
        Ok(JsVelocityRescale {
            inner: md::VelocityRescale::new(target_temp, tau, dt, n_dof, seed),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) -> Result<(), JsError> {
        validate_temperature(target_temp).map_err(|err| JsError::new(&err))?;
        self.inner.set_temperature(target_temp);
        Ok(())
    }
}

/// Perform the first part of a velocity rescale step (position update).
///
/// This is the split API for proper force handling:
/// 1. Call `velocity_rescale_step_init` with current forces
/// 2. Get new positions from `state.positions`
/// 3. Compute forces at new positions
/// 4. Call `velocity_rescale_step_finalize` with new forces
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
#[wasm_bindgen]
pub fn velocity_rescale_step_init(
    thermostat: &mut JsVelocityRescale,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        state.inner.forces = parse_flat_vec3(&forces, state.inner.num_atoms())?;
        thermostat.inner.step_init(&mut state.inner);
        Ok(())
    })();
    result.into()
}

/// Complete a velocity rescale step after `velocity_rescale_step_init` (velocity update +
/// rescaling).
///
/// new_forces: flat array of forces computed at the updated positions [Fx0, Fy0, Fz0, ...]
#[wasm_bindgen]
pub fn velocity_rescale_step_finalize(
    thermostat: &mut JsVelocityRescale,
    state: &mut JsMDState,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let force_vec = parse_flat_vec3(&new_forces, state.inner.num_atoms())?;
        thermostat
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

/// Perform one complete velocity rescale step with both old and new forces.
///
/// This is a convenience wrapper that combines `velocity_rescale_step_init` and
/// `velocity_rescale_step_finalize`.
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// new_forces: flat array of forces at updated positions in eV/Angstrom
#[wasm_bindgen]
pub fn velocity_rescale_step_with_forces(
    thermostat: &mut JsVelocityRescale,
    state: &mut JsMDState,
    forces: Vec<f64>,
    new_forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        state.inner.forces = parse_flat_vec3(&forces, n_atoms)?;
        thermostat.inner.step_init(&mut state.inner);
        let force_vec = parse_flat_vec3(&new_forces, n_atoms)?;
        thermostat
            .inner
            .step_finalize(&mut state.inner, &force_vec)
            .map_err(|err| err.to_string())?;
        Ok(())
    })();
    result.into()
}

// === NPT Ensemble ===

/// State for NPT molecular dynamics with variable cell.
#[wasm_bindgen]
pub struct JsNPTState {
    inner: md::NPTState,
}

#[wasm_bindgen]
impl JsNPTState {
    /// Create a new NPT state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// masses: array of atomic masses in amu
    /// cell: 9-element cell matrix (row-major) in Angstrom
    /// pbc_x, pbc_y, pbc_z: periodic boundary conditions
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: Vec<f64>,
        masses: Vec<f64>,
        cell: Vec<f64>,
        pbc_x: bool,
        pbc_y: bool,
        pbc_z: bool,
    ) -> Result<JsNPTState, JsError> {
        let n_atoms = masses.len();
        if positions.len() != n_atoms * 3 {
            return Err(JsError::new("positions length must be 3 * n_atoms"));
        }
        if cell.len() != 9 {
            return Err(JsError::new("cell must have 9 elements"));
        }

        // Validate masses: must all be positive and finite
        for mass in &masses {
            if !mass.is_finite() || *mass <= 0.0 {
                return Err(JsError::new("masses must be positive finite numbers"));
            }
        }

        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let cell_mat = nalgebra::Matrix3::new(
            cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
        );

        Ok(JsNPTState {
            inner: md::NPTState::new(pos_vec, masses, cell_mat, [pbc_x, pbc_y, pbc_z]),
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get velocities as flat array.
    #[wasm_bindgen(getter)]
    pub fn velocities(&self) -> Vec<f64> {
        self.inner
            .velocities
            .iter()
            .flat_map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Get cell matrix as flat array.
    #[wasm_bindgen(getter)]
    pub fn cell(&self) -> Vec<f64> {
        let c = &self.inner.cell;
        vec![
            c[(0, 0)],
            c[(0, 1)],
            c[(0, 2)],
            c[(1, 0)],
            c[(1, 1)],
            c[(1, 2)],
            c[(2, 0)],
            c[(2, 1)],
            c[(2, 2)],
        ]
    }

    /// Get cell volume in Angstrom³.
    #[wasm_bindgen]
    pub fn volume(&self) -> f64 {
        self.inner.volume()
    }

    /// Get kinetic energy in eV.
    #[wasm_bindgen]
    pub fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Get temperature in Kelvin.
    #[wasm_bindgen]
    pub fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }
}

/// NPT integrator using Parrinello-Rahman barostat.
#[wasm_bindgen]
pub struct JsNPTIntegrator {
    inner: md::NPTIntegrator,
}

#[wasm_bindgen]
impl JsNPTIntegrator {
    /// Create a new NPT integrator.
    ///
    /// temperature: target temperature in Kelvin (must be non-negative)
    /// pressure: target pressure in GPa
    /// tau_t: thermostat time constant in femtoseconds (must be positive)
    /// tau_p: barostat time constant in femtoseconds (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// n_atoms: number of atoms
    /// total_mass: total system mass in amu (must be positive)
    #[wasm_bindgen(constructor)]
    pub fn new(
        temperature: f64,
        pressure: f64,
        tau_t: f64,
        tau_p: f64,
        dt: f64,
        n_atoms: usize,
        total_mass: f64,
    ) -> Result<JsNPTIntegrator, JsError> {
        validate_temperature(temperature).map_err(|err| JsError::new(&err))?;
        if !pressure.is_finite() {
            return Err(JsError::new(&format!(
                "pressure must be finite, got {pressure}"
            )));
        }
        validate_positive_f64(tau_t, "thermostat time constant tau_t")
            .map_err(|err| JsError::new(&err))?;
        validate_positive_f64(tau_p, "barostat time constant tau_p")
            .map_err(|err| JsError::new(&err))?;
        validate_positive_f64(dt, "timestep dt").map_err(|err| JsError::new(&err))?;
        validate_positive_f64(total_mass, "total_mass").map_err(|err| JsError::new(&err))?;
        let config = md::NPTConfig::new(temperature, pressure, tau_t, tau_p, dt);
        Ok(JsNPTIntegrator {
            inner: md::NPTIntegrator::new(config, n_atoms, total_mass),
        })
    }

    /// Get instantaneous pressure from stress tensor.
    #[wasm_bindgen]
    pub fn pressure(&self, stress: Vec<f64>) -> WasmResult<f64> {
        match parse_stress(&stress) {
            Ok(stress_mat) => WasmResult::ok(self.inner.pressure(&stress_mat)),
            Err(err) => WasmResult::err(&err),
        }
    }
}

/// Perform the first part of an NPT step (thermostat half-step + cell half-step +
/// velocity half-step + position/cell update).
///
/// This is the split API for proper force handling:
/// 1. Call `npt_step_init` with current forces and stress
/// 2. Get new positions and cell from state
/// 3. Compute forces and stress at new configuration
/// 4. Call `npt_step_finalize` with new forces and stress
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// stress: 9-element stress tensor (row-major) in eV/Å³
#[wasm_bindgen]
pub fn npt_step_init(
    integrator: &mut JsNPTIntegrator,
    state: &mut JsNPTState,
    forces: Vec<f64>,
    stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        state.inner.forces = parse_flat_vec3(&forces, state.inner.num_atoms())?;
        let stress_mat = parse_stress(&stress)?;
        integrator.inner.step_init(&mut state.inner, &stress_mat);
        Ok(())
    })();
    result.into()
}

/// Complete an NPT step after `npt_step_init` (velocity second half + cell second half +
/// thermostat second half).
///
/// new_forces: flat array of forces computed at the updated positions [Fx0, Fy0, Fz0, ...]
/// new_stress: 9-element stress tensor at updated configuration (row-major) in eV/Å³
#[wasm_bindgen]
pub fn npt_step_finalize(
    integrator: &mut JsNPTIntegrator,
    state: &mut JsNPTState,
    new_forces: Vec<f64>,
    new_stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let force_vec = parse_flat_vec3(&new_forces, state.inner.num_atoms())?;
        let stress_mat = parse_stress(&new_stress)?;
        integrator
            .inner
            .step_finalize(&mut state.inner, &force_vec, &stress_mat);
        Ok(())
    })();
    result.into()
}

/// Perform one complete NPT step with both initial and new forces/stress.
///
/// This is a convenience wrapper that combines `npt_step_init` and `npt_step_finalize`.
///
/// forces: flat array of initial forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// stress: 9-element initial stress tensor (row-major) in eV/Å³
/// new_forces: flat array of forces at updated positions in eV/Angstrom
/// new_stress: 9-element stress tensor at updated configuration in eV/Å³
#[wasm_bindgen]
pub fn npt_step_with_forces_and_stress(
    integrator: &mut JsNPTIntegrator,
    state: &mut JsNPTState,
    forces: Vec<f64>,
    stress: Vec<f64>,
    new_forces: Vec<f64>,
    new_stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        state.inner.forces = parse_flat_vec3(&forces, n_atoms)?;
        let stress_mat = parse_stress(&stress)?;
        integrator.inner.step_init(&mut state.inner, &stress_mat);
        let new_force_vec = parse_flat_vec3(&new_forces, n_atoms)?;
        let new_stress_mat = parse_stress(&new_stress)?;
        integrator
            .inner
            .step_finalize(&mut state.inner, &new_force_vec, &new_stress_mat);
        Ok(())
    })();
    result.into()
}
