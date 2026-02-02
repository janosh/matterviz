//! Molecular dynamics integrators and analysis.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyAny;

use crate::md::{
    self, LangevinIntegrator, MDState, NoseHooverChain, ThermostatStepError, VelocityRescale,
};
use crate::optimizers::{CellFireState, FireConfig, FireState};

use super::helpers::{
    array_to_mat3, default_pbc, mat3_to_array, positions_to_vec3, validate_opt,
    validate_positive_f64, vec3_to_positions,
};

// === Validation Helpers ===

/// Validate temperature is finite and non-negative.
#[inline]
fn validate_temperature(temp: f64) -> PyResult<()> {
    if !temp.is_finite() || temp < 0.0 {
        return Err(PyValueError::new_err(format!(
            "temperature must be finite and non-negative, got {temp}"
        )));
    }
    Ok(())
}

/// Validate degrees of freedom is positive.
#[inline]
fn validate_n_dof(n_dof: usize) -> PyResult<()> {
    if n_dof == 0 {
        return Err(PyValueError::new_err(
            "n_dof must be positive (number of degrees of freedom)",
        ));
    }
    Ok(())
}

/// Convert ThermostatStepError to PyErr.
#[inline]
fn thermostat_step_err_to_pyerr(err: ThermostatStepError<PyErr>) -> PyErr {
    match err {
        ThermostatStepError::Callback(py_err) => py_err,
        ThermostatStepError::ForcesLength(err) => PyValueError::new_err(err.to_string()),
    }
}

/// Extract and validate forces from Python callback result.
/// Returns an error if the number of forces doesn't match the number of positions.
fn extract_and_validate_forces(
    result: &Bound<'_, PyAny>,
    n_atoms: usize,
) -> PyResult<Vec<nalgebra::Vector3<f64>>> {
    let forces: Vec<[f64; 3]> = result.extract()?;
    if forces.len() != n_atoms {
        return Err(PyValueError::new_err(format!(
            "Force callback returned {} forces for {} atoms",
            forces.len(),
            n_atoms
        )));
    }
    Ok(positions_to_vec3(&forces))
}

// === MDState ===

/// Python wrapper for MD state.
#[pyclass(name = "MDState")]
pub struct PyMDState {
    /// The inner MDState from the core library.
    pub inner: MDState,
}

#[pymethods]
impl PyMDState {
    /// Create a new MD state.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions in Angstrom
    ///     masses: N-element array of atomic masses in amu
    ///     velocities: Optional Nx3 array of velocities (default: zeros)
    #[new]
    #[pyo3(signature = (positions, masses, velocities = None))]
    fn new(
        positions: Vec<[f64; 3]>,
        masses: Vec<f64>,
        velocities: Option<Vec<[f64; 3]>>,
    ) -> PyResult<Self> {
        if positions.len() != masses.len() {
            return Err(PyValueError::new_err(format!(
                "Masses length ({}) must match positions length ({})",
                masses.len(),
                positions.len()
            )));
        }

        // Validate masses before passing to core library (which panics on invalid)
        for (idx, &mass) in masses.iter().enumerate() {
            if !mass.is_finite() || mass <= 0.0 {
                return Err(PyValueError::new_err(format!(
                    "Mass at index {idx} must be positive and finite, got {mass}"
                )));
            }
        }

        let pos_vec = positions_to_vec3(&positions);
        let mut state = MDState::new(pos_vec, masses);

        if let Some(vels) = velocities {
            if vels.len() != state.num_atoms() {
                return Err(PyValueError::new_err(format!(
                    "Velocities length ({}) must match positions length ({})",
                    vels.len(),
                    state.num_atoms()
                )));
            }
            state.velocities = positions_to_vec3(&vels);
        }

        Ok(Self { inner: state })
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution.
    #[pyo3(signature = (temperature_k, seed = None))]
    fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) -> PyResult<()> {
        validate_temperature(temperature_k)?;
        self.inner.init_velocities(temperature_k, seed);
        Ok(())
    }

    /// Get kinetic energy in eV.
    fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Get temperature in Kelvin.
    fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Get number of atoms.
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.positions)
    }

    /// Set positions from Nx3 array.
    #[setter]
    fn set_positions(&mut self, positions: Vec<[f64; 3]>) -> PyResult<()> {
        if positions.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Positions length ({}) must match num_atoms ({})",
                positions.len(),
                self.inner.num_atoms()
            )));
        }
        self.inner.positions = positions_to_vec3(&positions);
        Ok(())
    }

    /// Get velocities as Nx3 array.
    #[getter]
    fn velocities(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.velocities)
    }

    /// Set velocities from Nx3 array.
    #[setter]
    fn set_velocities(&mut self, velocities: Vec<[f64; 3]>) -> PyResult<()> {
        if velocities.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Velocities length ({}) must match num_atoms ({})",
                velocities.len(),
                self.inner.num_atoms()
            )));
        }
        self.inner.velocities = positions_to_vec3(&velocities);
        Ok(())
    }

    /// Get forces as Nx3 array.
    #[getter]
    fn forces(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.forces)
    }

    /// Set forces from Nx3 array.
    #[setter]
    fn set_forces(&mut self, forces: Vec<[f64; 3]>) -> PyResult<()> {
        if forces.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Forces length ({}) must match num_atoms ({})",
                forces.len(),
                self.inner.num_atoms()
            )));
        }
        let force_vec = positions_to_vec3(&forces);
        self.inner.set_forces(&force_vec);
        Ok(())
    }
}

// === LangevinIntegrator ===

/// Python wrapper for Langevin integrator.
#[pyclass(name = "LangevinIntegrator")]
pub struct PyLangevinIntegrator {
    inner: LangevinIntegrator,
}

#[pymethods]
impl PyLangevinIntegrator {
    /// Create a new Langevin integrator.
    ///
    /// Args:
    ///     temperature_k: Target temperature in Kelvin (must be non-negative)
    ///     friction: Friction coefficient in 1/fs (must be positive, typical: 0.001 to 0.01)
    ///     dt: Time step in fs (must be positive)
    ///     seed: Optional random seed for reproducibility
    #[new]
    #[pyo3(signature = (temperature_k, friction, dt, seed = None))]
    fn new(temperature_k: f64, friction: f64, dt: f64, seed: Option<u64>) -> PyResult<Self> {
        validate_temperature(temperature_k)?;
        validate_positive_f64(friction, "friction")?;
        validate_positive_f64(dt, "timestep dt")?;
        Ok(Self {
            inner: LangevinIntegrator::new(temperature_k, friction, dt, seed),
        })
    }

    /// Perform one Langevin dynamics step.
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    fn step(
        &mut self,
        state: &mut PyMDState,
        compute_forces: Py<PyAny>,
        py: Python<'_>,
    ) -> PyResult<()> {
        self.inner.try_step(&mut state.inner, |positions| {
            let n_atoms = positions.len();
            let pos_arr = vec3_to_positions(positions);
            let result = compute_forces.call1(py, (pos_arr,))?;
            extract_and_validate_forces(result.bind(py), n_atoms)
        })
    }

    /// Set target temperature.
    fn set_temperature(&mut self, temperature_k: f64) -> PyResult<()> {
        validate_temperature(temperature_k)?;
        self.inner.set_temperature(temperature_k);
        Ok(())
    }

    /// Set friction coefficient.
    fn set_friction(&mut self, friction: f64) -> PyResult<()> {
        validate_positive_f64(friction, "friction")?;
        self.inner.set_friction(friction);
        Ok(())
    }

    /// Set time step.
    fn set_dt(&mut self, dt: f64) -> PyResult<()> {
        validate_positive_f64(dt, "timestep dt")?;
        self.inner.set_dt(dt);
        Ok(())
    }
}

/// Perform one velocity Verlet step (NVE ensemble).
///
/// Raises:
///     RuntimeError: If force computation fails. State is restored to its
///         original value before the step when this happens.
#[pyfunction]
fn velocity_verlet_step(
    state: &mut PyMDState,
    dt: f64,
    compute_forces: Py<PyAny>,
    py: Python<'_>,
) -> PyResult<()> {
    match md::try_velocity_verlet_step(std::mem::take(&mut state.inner), dt, |positions| {
        let n_atoms = positions.len();
        let pos_arr = vec3_to_positions(positions);
        let result = compute_forces.call1(py, (pos_arr,))?;
        extract_and_validate_forces(result.bind(py), n_atoms)
    }) {
        Ok(new_state) => {
            state.inner = new_state;
            Ok(())
        }
        Err((original_state, err)) => {
            state.inner = original_state;
            Err(err)
        }
    }
}

// === Nose-Hoover Chain ===

/// Nosé-Hoover chain thermostat for NVT molecular dynamics.
#[pyclass(name = "NoseHooverChain")]
pub struct PyNoseHooverChain {
    inner: NoseHooverChain,
}

#[pymethods]
impl PyNoseHooverChain {
    /// Create a new Nosé-Hoover chain thermostat.
    ///
    /// Args:
    ///     target_temp: Target temperature in Kelvin (must be non-negative)
    ///     tau: Coupling time constant in fs (must be positive)
    ///     dt: Time step in fs (must be positive)
    ///     n_dof: Number of degrees of freedom (must be positive)
    #[new]
    fn new(target_temp: f64, tau: f64, dt: f64, n_dof: usize) -> PyResult<Self> {
        validate_temperature(target_temp)?;
        validate_positive_f64(tau, "coupling time constant tau")?;
        validate_positive_f64(dt, "timestep dt")?;
        validate_n_dof(n_dof)?;
        Ok(Self {
            inner: NoseHooverChain::new(target_temp, tau, dt, n_dof),
        })
    }

    /// Perform one NVT step.
    fn step(&mut self, state: &mut PyMDState, compute_forces: &Bound<'_, PyAny>) -> PyResult<()> {
        self.inner
            .try_step(&mut state.inner, |positions| {
                let n_atoms = positions.len();
                let result = compute_forces.call1((vec3_to_positions(positions),))?;
                extract_and_validate_forces(&result, n_atoms)
            })
            .map_err(thermostat_step_err_to_pyerr)
    }

    /// Set target temperature.
    fn set_temperature(&mut self, target_temp: f64) -> PyResult<()> {
        validate_positive_f64(target_temp, "target_temp")?;
        self.inner.set_temperature(target_temp);
        Ok(())
    }
}

// === Velocity Rescaling ===

/// Velocity rescaling (Bussi) thermostat for NVT molecular dynamics.
#[pyclass(name = "VelocityRescale")]
pub struct PyVelocityRescale {
    inner: VelocityRescale,
}

#[pymethods]
impl PyVelocityRescale {
    /// Create a new velocity rescaling thermostat.
    ///
    /// Args:
    ///     target_temp: Target temperature in Kelvin (must be non-negative)
    ///     tau: Coupling time constant in fs (must be positive)
    ///     dt: Time step in fs (must be positive)
    ///     n_dof: Number of degrees of freedom (must be positive)
    ///     seed: Optional random seed for reproducibility
    #[new]
    #[pyo3(signature = (target_temp, tau, dt, n_dof, seed = None))]
    fn new(target_temp: f64, tau: f64, dt: f64, n_dof: usize, seed: Option<u64>) -> PyResult<Self> {
        validate_temperature(target_temp)?;
        validate_positive_f64(tau, "coupling time constant tau")?;
        validate_positive_f64(dt, "timestep dt")?;
        validate_n_dof(n_dof)?;
        Ok(Self {
            inner: VelocityRescale::new(target_temp, tau, dt, n_dof, seed),
        })
    }

    /// Perform one NVT step.
    fn step(&mut self, state: &mut PyMDState, compute_forces: &Bound<'_, PyAny>) -> PyResult<()> {
        self.inner
            .try_step(&mut state.inner, |positions| {
                let n_atoms = positions.len();
                let result = compute_forces.call1((vec3_to_positions(positions),))?;
                extract_and_validate_forces(&result, n_atoms)
            })
            .map_err(thermostat_step_err_to_pyerr)
    }

    /// Set target temperature.
    fn set_temperature(&mut self, target_temp: f64) -> PyResult<()> {
        validate_positive_f64(target_temp, "target_temp")?;
        self.inner.set_temperature(target_temp);
        Ok(())
    }
}

// === NPT State ===

/// State for NPT molecular dynamics.
#[pyclass(name = "NPTState")]
pub struct PyNPTState {
    inner: md::NPTState,
}

#[pymethods]
impl PyNPTState {
    /// Create a new NPT state.
    #[new]
    #[pyo3(signature = (positions, masses, cell, pbc = None))]
    fn new(
        positions: Vec<[f64; 3]>,
        masses: Vec<f64>,
        cell: [[f64; 3]; 3],
        pbc: Option<[bool; 3]>,
    ) -> PyResult<Self> {
        if positions.len() != masses.len() {
            return Err(PyValueError::new_err(format!(
                "Masses length ({}) must match positions length ({})",
                masses.len(),
                positions.len()
            )));
        }

        // Validate masses before passing to core library (which panics on invalid)
        for (idx, &mass) in masses.iter().enumerate() {
            if !mass.is_finite() || mass <= 0.0 {
                return Err(PyValueError::new_err(format!(
                    "Mass at index {idx} must be positive and finite, got {mass}"
                )));
            }
        }

        let pos_vec = positions_to_vec3(&positions);
        let cell_mat = array_to_mat3(cell);
        // NPT always has a cell, so default pbc to true
        let pbc_arr = default_pbc(pbc, true);

        Ok(Self {
            inner: md::NPTState::new(pos_vec, masses, cell_mat, pbc_arr),
        })
    }

    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.positions)
    }

    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        mat3_to_array(&self.inner.cell)
    }
}

// === FIRE Optimizer ===

/// Python wrapper for FIRE configuration.
#[pyclass(name = "FireConfig")]
#[derive(Clone)]
pub struct PyFireConfig {
    inner: FireConfig,
}

#[pymethods]
impl PyFireConfig {
    /// Create a new FIRE configuration.
    #[new]
    #[pyo3(signature = (dt_start = None, dt_max = None, n_min = None, f_inc = None, f_dec = None, alpha_start = None, f_alpha = None, max_step = None))]
    fn new(
        dt_start: Option<f64>,
        dt_max: Option<f64>,
        n_min: Option<usize>,
        f_inc: Option<f64>,
        f_dec: Option<f64>,
        alpha_start: Option<f64>,
        f_alpha: Option<f64>,
        max_step: Option<f64>,
    ) -> PyResult<Self> {
        validate_opt(dt_start, "dt_start", "positive", |v| v > 0.0)?;
        validate_opt(dt_max, "dt_max", "positive", |v| v > 0.0)?;
        if n_min == Some(0) {
            return Err(PyValueError::new_err("n_min must be greater than 0"));
        }
        validate_opt(f_inc, "f_inc", "> 1", |v| v > 1.0)?;
        validate_opt(f_dec, "f_dec", "in (0, 1)", |v| v > 0.0 && v < 1.0)?;
        validate_opt(alpha_start, "alpha_start", "in (0, 1]", |v| {
            v > 0.0 && v <= 1.0
        })?;
        validate_opt(f_alpha, "f_alpha", "in (0, 1)", |v| v > 0.0 && v < 1.0)?;
        validate_opt(max_step, "max_step", "positive", |v| v > 0.0)?;

        let mut config = FireConfig::default();
        config.dt_start = dt_start.unwrap_or(config.dt_start);
        config.dt_max = dt_max.unwrap_or(config.dt_max);
        config.n_min = n_min.unwrap_or(config.n_min);
        config.f_inc = f_inc.unwrap_or(config.f_inc);
        config.f_dec = f_dec.unwrap_or(config.f_dec);
        config.alpha_start = alpha_start.unwrap_or(config.alpha_start);
        config.f_alpha = f_alpha.unwrap_or(config.f_alpha);
        config.max_step = max_step.unwrap_or(config.max_step);

        if config.dt_max < config.dt_start {
            return Err(PyValueError::new_err(format!(
                "dt_max ({}) must be >= dt_start ({})",
                config.dt_max, config.dt_start
            )));
        }
        Ok(Self { inner: config })
    }

    #[getter]
    fn dt_start(&self) -> f64 {
        self.inner.dt_start
    }

    #[getter]
    fn dt_max(&self) -> f64 {
        self.inner.dt_max
    }

    #[getter]
    fn max_step(&self) -> f64 {
        self.inner.max_step
    }
}

/// Python wrapper for FIRE optimizer state.
#[pyclass(name = "FireState")]
pub struct PyFireState {
    inner: FireState,
    config: FireConfig,
}

#[pymethods]
impl PyFireState {
    /// Create a new FIRE optimizer state.
    #[new]
    #[pyo3(signature = (positions, config = None))]
    fn new(positions: Vec<[f64; 3]>, config: Option<PyFireConfig>) -> Self {
        let pos_vec = positions_to_vec3(&positions);
        let fire_config = config.map(|cfg| cfg.inner).unwrap_or_default();
        let state = FireState::new(pos_vec, &fire_config);
        Self {
            inner: state,
            config: fire_config,
        }
    }

    /// Perform one FIRE optimization step.
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    fn step(&mut self, compute_forces: Py<PyAny>, py: Python<'_>) -> PyResult<()> {
        self.inner.try_step(
            |positions| {
                let n_atoms = positions.len();
                let pos_arr = vec3_to_positions(positions);
                let result = compute_forces.call1(py, (pos_arr,))?;
                extract_and_validate_forces(result.bind(py), n_atoms)
            },
            &self.config,
        )
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64) -> bool {
        self.inner.is_converged(fmax)
    }

    /// Get maximum force component magnitude.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Get number of atoms.
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.positions)
    }
}

/// Python wrapper for FIRE optimizer with cell optimization.
#[pyclass(name = "CellFireState")]
pub struct PyCellFireState {
    inner: CellFireState,
    config: FireConfig,
}

#[pymethods]
impl PyCellFireState {
    /// Create a new FIRE optimizer state with cell optimization.
    #[new]
    #[pyo3(signature = (positions, cell, config = None, cell_factor = 1.0))]
    fn new(
        positions: Vec<[f64; 3]>,
        cell: [[f64; 3]; 3],
        config: Option<PyFireConfig>,
        cell_factor: f64,
    ) -> Self {
        let pos_vec = positions_to_vec3(&positions);
        let cell_mat = array_to_mat3(cell);
        let fire_config = config.map(|cfg| cfg.inner).unwrap_or_default();
        let state = CellFireState::new(pos_vec, cell_mat, &fire_config, cell_factor);
        Self {
            inner: state,
            config: fire_config,
        }
    }

    /// Perform one FIRE optimization step with cell optimization.
    ///
    /// Raises:
    ///     RuntimeError: If force/stress computation fails. State is restored to its
    ///         original value before the step when this happens.
    fn step(&mut self, compute_forces_and_stress: Py<PyAny>, py: Python<'_>) -> PyResult<()> {
        self.inner.try_step(
            |positions, cell| {
                let n_atoms = positions.len();
                let pos_arr = vec3_to_positions(positions);
                let cell_arr = mat3_to_array(cell);

                let result = compute_forces_and_stress.call1(py, (pos_arr, cell_arr))?;
                let (forces, stress): (Vec<[f64; 3]>, [[f64; 3]; 3]) = result.extract(py)?;

                if forces.len() != n_atoms {
                    return Err(PyValueError::new_err(format!(
                        "Force callback returned {} forces for {} atoms",
                        forces.len(),
                        n_atoms
                    )));
                }

                let force_vec = positions_to_vec3(&forces);
                let stress_mat = array_to_mat3(stress);

                Ok((force_vec, stress_mat))
            },
            &self.config,
        )
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64, smax: f64) -> bool {
        self.inner.is_converged(fmax, smax)
    }

    /// Get maximum force component magnitude.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Get maximum stress component magnitude.
    fn max_stress(&self) -> f64 {
        self.inner.max_stress()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        vec3_to_positions(&self.inner.positions)
    }

    /// Get cell as 3x3 array.
    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        mat3_to_array(&self.inner.cell)
    }
}

/// Register the md submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "md")?;
    submod.add_class::<PyMDState>()?;
    submod.add_class::<PyLangevinIntegrator>()?;
    submod.add_class::<PyNoseHooverChain>()?;
    submod.add_class::<PyVelocityRescale>()?;
    submod.add_class::<PyNPTState>()?;
    submod.add_class::<PyFireConfig>()?;
    submod.add_class::<PyFireState>()?;
    submod.add_class::<PyCellFireState>()?;
    submod.add_function(wrap_pyfunction!(velocity_verlet_step, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
