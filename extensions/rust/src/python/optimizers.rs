//! FIRE and CellFIRE optimizer Python bindings.

use nalgebra::{Matrix3, Vector3};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use crate::optimizers;

use super::helpers::{mat3_to_array, validate_opt, validate_positive_f64};

// === Validation Helpers ===

/// Parse and validate forces array, checking length and finiteness.
fn parse_forces(forces: &[[f64; 3]], expected_len: usize) -> PyResult<Vec<Vector3<f64>>> {
    if forces.len() != expected_len {
        return Err(PyValueError::new_err(format!(
            "forces length {} must be {} (n_atoms)",
            forces.len(),
            expected_len
        )));
    }
    forces
        .iter()
        .enumerate()
        .map(|(idx, f)| {
            if !f.iter().all(|v| v.is_finite()) {
                Err(PyValueError::new_err(format!(
                    "forces[{idx}] contains non-finite values: {f:?}"
                )))
            } else {
                Ok(Vector3::new(f[0], f[1], f[2]))
            }
        })
        .collect()
}

/// Parse and validate stress tensor, checking finiteness.
fn parse_stress(stress: &[[f64; 3]; 3]) -> PyResult<Matrix3<f64>> {
    if !stress.iter().flatten().all(|v| v.is_finite()) {
        return Err(PyValueError::new_err(format!(
            "stress contains non-finite values: {stress:?}"
        )));
    }
    Ok(super::helpers::array_to_mat3(*stress))
}

/// FIRE optimizer configuration.
#[pyclass(name = "FireConfig")]
#[derive(Clone)]
pub struct PyFireConfig {
    pub(crate) inner: optimizers::FireConfig,
}

#[pymethods]
impl PyFireConfig {
    /// Create a new FIRE configuration with default parameters.
    #[new]
    #[pyo3(signature = (dt_start=None, dt_max=None, n_min=None, max_step=None))]
    fn new(
        dt_start: Option<f64>,
        dt_max: Option<f64>,
        n_min: Option<usize>,
        max_step: Option<f64>,
    ) -> PyResult<Self> {
        validate_opt(dt_start, "dt_start", "positive", |v| v > 0.0)?;
        validate_opt(dt_max, "dt_max", "positive", |v| v > 0.0)?;
        if n_min == Some(0) {
            return Err(PyValueError::new_err("n_min must be greater than 0"));
        }
        validate_opt(max_step, "max_step", "positive", |v| v > 0.0)?;

        let mut config = optimizers::FireConfig::default();
        config.dt_start = dt_start.unwrap_or(config.dt_start);
        config.dt_max = dt_max.unwrap_or(config.dt_max);
        config.n_min = n_min.unwrap_or(config.n_min);
        config.max_step = max_step.unwrap_or(config.max_step);

        if config.dt_max < config.dt_start {
            return Err(PyValueError::new_err(format!(
                "dt_max ({}) must be >= dt_start ({})",
                config.dt_max, config.dt_start
            )));
        }
        Ok(PyFireConfig { inner: config })
    }

    #[getter]
    fn dt_start(&self) -> f64 {
        self.inner.dt_start
    }

    #[setter]
    fn set_dt_start(&mut self, val: f64) -> PyResult<()> {
        validate_positive_f64(val, "dt_start")?;
        if val > self.inner.dt_max {
            return Err(PyValueError::new_err(format!(
                "dt_start ({val}) must be <= dt_max ({})",
                self.inner.dt_max
            )));
        }
        self.inner.dt_start = val;
        Ok(())
    }

    #[getter]
    fn dt_max(&self) -> f64 {
        self.inner.dt_max
    }

    #[setter]
    fn set_dt_max(&mut self, val: f64) -> PyResult<()> {
        validate_positive_f64(val, "dt_max")?;
        if val < self.inner.dt_start {
            return Err(PyValueError::new_err(format!(
                "dt_max ({val}) must be >= dt_start ({})",
                self.inner.dt_start
            )));
        }
        self.inner.dt_max = val;
        Ok(())
    }

    #[getter]
    fn n_min(&self) -> usize {
        self.inner.n_min
    }

    #[setter]
    fn set_n_min(&mut self, val: usize) -> PyResult<()> {
        if val == 0 {
            return Err(PyValueError::new_err("n_min must be greater than 0"));
        }
        self.inner.n_min = val;
        Ok(())
    }

    #[getter]
    fn max_step(&self) -> f64 {
        self.inner.max_step
    }

    #[setter]
    fn set_max_step(&mut self, val: f64) -> PyResult<()> {
        validate_positive_f64(val, "max_step")?;
        self.inner.max_step = val;
        Ok(())
    }
}

/// FIRE optimizer state.
#[pyclass(name = "FireState")]
pub struct PyFireState {
    inner: optimizers::FireState,
    config: optimizers::FireConfig,
}

#[pymethods]
impl PyFireState {
    /// Create a new FIRE state.
    ///
    /// Args:
    ///     positions: List of [x, y, z] positions in Angstrom
    ///     config: Optional FIRE configuration
    #[new]
    #[pyo3(signature = (positions, config=None))]
    fn new(positions: Vec<[f64; 3]>, config: Option<PyFireConfig>) -> PyResult<Self> {
        let pos_vec: Vec<Vector3<f64>> = positions
            .iter()
            .map(|p| Vector3::new(p[0], p[1], p[2]))
            .collect();
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let state = optimizers::FireState::new(pos_vec, &fire_config);
        Ok(PyFireState {
            inner: state,
            config: fire_config,
        })
    }

    /// Get positions.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get velocities.
    #[getter]
    fn velocities(&self) -> Vec<[f64; 3]> {
        self.inner
            .velocities
            .iter()
            .map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Get maximum force component.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64) -> PyResult<bool> {
        if !fmax.is_finite() || fmax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "fmax must be positive and finite",
            ));
        }
        Ok(self.inner.is_converged(fmax))
    }

    /// Number of atoms.
    #[getter]
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Current timestep.
    #[getter]
    fn dt(&self) -> f64 {
        self.inner.dt
    }

    /// Perform one FIRE step with provided forces.
    fn step(&mut self, forces: Vec<[f64; 3]>) -> PyResult<()> {
        let force_vec = parse_forces(&forces, self.inner.num_atoms())?;
        self.inner
            .step(|_positions| force_vec.clone(), &self.config);
        Ok(())
    }
}

/// CellFIRE optimizer state (optimizes both positions and cell).
#[pyclass(name = "CellFireState")]
pub struct PyCellFireState {
    inner: optimizers::CellFireState,
    config: optimizers::FireConfig,
}

#[pymethods]
impl PyCellFireState {
    /// Create a new CellFIRE state.
    ///
    /// Args:
    ///     positions: List of [x, y, z] positions in Angstrom
    ///     cell: 3x3 cell matrix (row vectors)
    ///     config: Optional FIRE configuration
    ///     cell_factor: Scaling factor for cell DOF (default: 1.0)
    #[new]
    #[pyo3(signature = (positions, cell, config=None, cell_factor=1.0))]
    fn new(
        positions: Vec<[f64; 3]>,
        cell: [[f64; 3]; 3],
        config: Option<PyFireConfig>,
        cell_factor: f64,
    ) -> PyResult<Self> {
        if !cell_factor.is_finite() || cell_factor <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "cell_factor must be positive and finite",
            ));
        }
        let pos_vec: Vec<Vector3<f64>> = positions
            .iter()
            .map(|p| Vector3::new(p[0], p[1], p[2]))
            .collect();
        let cell_mat = Matrix3::new(
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        );
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        Ok(PyCellFireState {
            inner: optimizers::CellFireState::new(pos_vec, cell_mat, &fire_config, cell_factor),
            config: fire_config,
        })
    }

    /// Get positions.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get cell matrix.
    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        mat3_to_array(&self.inner.cell)
    }

    /// Get maximum force component.
    fn max_force(&self) -> f64 {
        optimizers::cell_max_force(&self.inner)
    }

    /// Get maximum stress component.
    fn max_stress(&self) -> f64 {
        optimizers::cell_max_stress(&self.inner)
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64, smax: f64) -> PyResult<bool> {
        if !fmax.is_finite() || fmax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "fmax must be positive and finite",
            ));
        }
        if !smax.is_finite() || smax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "smax must be positive and finite",
            ));
        }
        Ok(optimizers::cell_is_converged(&self.inner, fmax, smax))
    }

    /// Number of atoms.
    #[getter]
    fn num_atoms(&self) -> usize {
        self.inner.positions.len()
    }

    /// Perform one CellFIRE step with provided forces and stress.
    fn step(&mut self, forces: Vec<[f64; 3]>, stress: [[f64; 3]; 3]) -> PyResult<()> {
        let force_vec = parse_forces(&forces, self.inner.positions.len())?;
        let stress_mat = parse_stress(&stress)?;
        self.inner
            .step(|_, _| (force_vec.clone(), stress_mat), &self.config);
        Ok(())
    }
}

/// Register the optimizers submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "optimizers")?;
    submod.add_class::<PyFireConfig>()?;
    submod.add_class::<PyFireState>()?;
    submod.add_class::<PyCellFireState>()?;
    parent.add_submodule(&submod)?;
    Ok(())
}
