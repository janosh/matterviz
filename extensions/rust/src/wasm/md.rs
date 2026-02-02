//! Molecular dynamics integrators WASM bindings.

use nalgebra::Vector3;
use wasm_bindgen::prelude::*;

use crate::integrators;
use crate::wasm_types::WasmResult;

/// MD simulation state for WASM.
#[wasm_bindgen]
pub struct JsMDState {
    pub(crate) inner: integrators::MDState,
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
            inner: integrators::MDState::new(pos_vec, masses),
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
    ///
    /// # Panics
    /// Panics if length doesn't match `n_atoms * 3`.
    #[wasm_bindgen(setter)]
    pub fn set_positions(&mut self, positions: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        let expected = n_atoms * 3;
        assert_eq!(
            positions.len(),
            expected,
            "positions: expected {} elements (3 * {} atoms), got {}",
            expected,
            n_atoms,
            positions.len()
        );
        self.inner.positions = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
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
    ///
    /// # Panics
    /// Panics if length doesn't match `n_atoms * 3`.
    #[wasm_bindgen(setter)]
    pub fn set_velocities(&mut self, velocities: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        let expected = n_atoms * 3;
        assert_eq!(
            velocities.len(),
            expected,
            "velocities: expected {} elements (3 * {} atoms), got {}",
            expected,
            n_atoms,
            velocities.len()
        );
        self.inner.velocities = velocities
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
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
    ///
    /// # Panics
    /// Panics if length doesn't match `n_atoms * 3`.
    #[wasm_bindgen(setter)]
    pub fn set_forces(&mut self, forces: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        let expected = n_atoms * 3;
        assert_eq!(
            forces.len(),
            expected,
            "forces: expected {} elements (3 * {} atoms), got {}",
            expected,
            n_atoms,
            forces.len()
        );
        self.inner.forces = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
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
    pub fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) {
        self.inner.init_velocities(temperature_k, seed);
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
        // Validate timestep first
        if !dt_fs.is_finite() || dt_fs <= 0.0 {
            return Err(format!("dt_fs must be finite and positive, got {dt_fs}"));
        }

        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

        state.inner.set_forces(&force_vec);

        // Velocity Verlet: half-step velocity, full-step position, then caller computes new forces
        let dt_internal = dt_fs * integrators::units::FS_TO_INTERNAL;
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
        if !dt_fs.is_finite() || dt_fs <= 0.0 {
            return Err(format!("dt_fs must be finite and positive, got {dt_fs}"));
        }
        let n_atoms = state.inner.num_atoms();
        if new_forces.len() != n_atoms * 3 {
            return Err(format!(
                "new_forces length {} must be {} (3 * n_atoms)",
                new_forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = new_forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

        state.inner.set_forces(&force_vec);

        let dt_internal = dt_fs * integrators::units::FS_TO_INTERNAL;
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
    inner: integrators::LangevinIntegrator,
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
        if temperature_k < 0.0 {
            return Err(JsError::new("temperature must be non-negative"));
        }
        if friction <= 0.0 {
            return Err(JsError::new("friction must be positive"));
        }
        if dt <= 0.0 {
            return Err(JsError::new("timestep dt must be positive"));
        }
        Ok(JsLangevinIntegrator {
            inner: integrators::LangevinIntegrator::new(temperature_k, friction, dt, seed),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, temperature_k: f64) {
        self.inner.set_temperature(temperature_k);
    }

    /// Set friction coefficient.
    #[wasm_bindgen]
    pub fn set_friction(&mut self, friction: f64) {
        self.inner.set_friction(friction);
    }

    /// Set timestep.
    #[wasm_bindgen]
    pub fn set_dt(&mut self, dt: f64) {
        self.inner.set_dt(dt);
    }
}

/// Perform one Langevin dynamics step (for use with JS force callback).
///
/// This version takes forces directly rather than a callback,
/// since JS callbacks across WASM boundary are complex.
#[wasm_bindgen]
pub fn langevin_step_with_forces(
    integrator: &mut JsLangevinIntegrator,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        integrator
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

// === Thermostats ===

/// Nose-Hoover chain thermostat for NVT ensemble.
#[wasm_bindgen]
pub struct JsNoseHooverChain {
    inner: integrators::NoseHooverChain,
}

#[wasm_bindgen]
impl JsNoseHooverChain {
    /// Create a new Nose-Hoover chain thermostat.
    ///
    /// target_temp: target temperature in Kelvin (must be non-negative)
    /// tau: coupling time constant in femtoseconds (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// n_dof: number of degrees of freedom (typically 3 * n_atoms - 3)
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_temp: f64,
        tau: f64,
        dt: f64,
        n_dof: usize,
    ) -> Result<JsNoseHooverChain, JsError> {
        if target_temp < 0.0 {
            return Err(JsError::new("temperature must be non-negative"));
        }
        if tau <= 0.0 {
            return Err(JsError::new("coupling time constant tau must be positive"));
        }
        if dt <= 0.0 {
            return Err(JsError::new("timestep dt must be positive"));
        }
        Ok(JsNoseHooverChain {
            inner: integrators::NoseHooverChain::new(target_temp, tau, dt, n_dof),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

/// Perform one Nose-Hoover chain step with provided forces.
#[wasm_bindgen]
pub fn nose_hoover_step_with_forces(
    thermostat: &mut JsNoseHooverChain,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        thermostat
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

/// Velocity rescaling thermostat (stochastic, canonical sampling).
#[wasm_bindgen]
pub struct JsVelocityRescale {
    inner: integrators::VelocityRescale,
}

#[wasm_bindgen]
impl JsVelocityRescale {
    /// Create a new velocity rescale thermostat.
    ///
    /// target_temp: target temperature in Kelvin (must be non-negative)
    /// tau: coupling time constant in femtoseconds (must be positive)
    /// dt: timestep in femtoseconds (must be positive)
    /// n_dof: number of degrees of freedom
    /// seed: optional RNG seed
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_temp: f64,
        tau: f64,
        dt: f64,
        n_dof: usize,
        seed: Option<u64>,
    ) -> Result<JsVelocityRescale, JsError> {
        if target_temp < 0.0 {
            return Err(JsError::new("temperature must be non-negative"));
        }
        if tau <= 0.0 {
            return Err(JsError::new("coupling time constant tau must be positive"));
        }
        if dt <= 0.0 {
            return Err(JsError::new("timestep dt must be positive"));
        }
        Ok(JsVelocityRescale {
            inner: integrators::VelocityRescale::new(target_temp, tau, dt, n_dof, seed),
        })
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

/// Perform one velocity rescale step with provided forces.
#[wasm_bindgen]
pub fn velocity_rescale_step_with_forces(
    thermostat: &mut JsVelocityRescale,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        thermostat
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

// === NPT Ensemble ===

/// State for NPT molecular dynamics with variable cell.
#[wasm_bindgen]
pub struct JsNPTState {
    inner: integrators::NPTState,
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
            inner: integrators::NPTState::new(pos_vec, masses, cell_mat, [pbc_x, pbc_y, pbc_z]),
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
    inner: integrators::NPTIntegrator,
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
        if temperature < 0.0 {
            return Err(JsError::new("temperature must be non-negative"));
        }
        if tau_t <= 0.0 {
            return Err(JsError::new(
                "thermostat time constant tau_t must be positive",
            ));
        }
        if tau_p <= 0.0 {
            return Err(JsError::new(
                "barostat time constant tau_p must be positive",
            ));
        }
        if dt <= 0.0 {
            return Err(JsError::new("timestep dt must be positive"));
        }
        if total_mass <= 0.0 {
            return Err(JsError::new("total_mass must be positive"));
        }
        let config = integrators::NPTConfig::new(temperature, pressure, tau_t, tau_p, dt);
        Ok(JsNPTIntegrator {
            inner: integrators::NPTIntegrator::new(config, n_atoms, total_mass),
        })
    }

    /// Get instantaneous pressure from stress tensor.
    #[wasm_bindgen]
    pub fn pressure(&self, stress: Vec<f64>) -> WasmResult<f64> {
        if stress.len() != 9 {
            return WasmResult::err("stress must have 9 elements");
        }
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );
        WasmResult::ok(self.inner.pressure(&stress_mat))
    }
}

/// Perform one NPT step with provided forces and stress.
#[wasm_bindgen]
pub fn npt_step_with_forces_and_stress(
    integrator: &mut JsNPTIntegrator,
    state: &mut JsNPTState,
    forces: Vec<f64>,
    stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }
        if stress.len() != 9 {
            return Err("stress must have 9 elements".to_string());
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );

        integrator
            .inner
            .step(&mut state.inner, |_, _| (force_vec.clone(), stress_mat));
        Ok(())
    })();
    result.into()
}
