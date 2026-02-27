//! # ferrox
//!
//! High-performance base layer for computational materials science.
//!
//! This crate provides fast implementations of common materials science operations
//! including I/O, structure matching, symmetry analysis, molecular dynamics, surface
//! science, defect engineering, and trajectory analysis.
//!
//! ## Features
//!
//! - **Structure I/O**: Parse CIF, POSCAR, extXYZ, LAMMPS, and more
//! - **Structure Matching**: Fast deduplication and grouping with parallel processing
//! - **Symmetry Analysis**: Space groups, Wyckoff positions, primitive/conventional cells
//! - **Molecular Dynamics**: NVE/NVT integrators, thermostats, classical potentials
//! - **Surface Science**: Slab generation, Miller indices, adsorption sites
//! - **Defect Engineering**: Vacancies, substitutions, interstitials, Voronoi sites
//! - **Trajectory Analysis**: RDF, MSD, diffusion coefficients, order parameters
//! - **Python bindings**: Optional PyO3 bindings, compatible with pymatgen dictionaries
//! - **WASM bindings**: Optional wasm-bindgen bindings for browser use
//!
//! ## Example
//!
//! ```rust,ignore
//! use ferrox::{Structure, StructureMatcher};
//!
//! let matcher = StructureMatcher::new()
//!     .with_latt_len_tol(0.2)
//!     .with_site_pos_tol(0.3)
//!     .with_angle_tol(5.0);
//!
//! let is_match = matcher.fit(&struct1, &struct2);
//! ```

#![warn(missing_docs)]
#![warn(clippy::all)]

pub mod error;

// Core types
pub mod composition;
pub mod element;
pub mod lattice;
pub mod species;
pub mod structure;

// Algorithms
pub mod algorithms;
pub mod batch;
pub mod cell_ops;
pub mod coordination;
pub mod defects;
pub mod distortions;
pub mod elastic;
pub mod md;
pub mod neighbors;
pub mod optimizers;
pub mod order_params;
pub mod pbc;
pub mod potentials;
pub mod rdf;
pub mod structure_matcher;
pub mod trajectory;

// Transformations (internal - public API is via Structure methods)
pub(crate) mod transformations;

// Re-export config structs for use with Structure transformation methods
pub use algorithms::EnumConfig;
pub use transformations::{OrderDisorderedConfig, PartialRemoveConfig};

// I/O
pub mod cif;
pub mod io;

// Analysis
pub mod oxidation;
pub mod surfaces;
pub mod xrd;

// Re-exports for convenience
pub use error::{FerroxError, OnError, Result};

// Python bindings (optional, enabled for both python extension and stub generation)
#[cfg(any(feature = "python", feature = "stub-gen"))]
pub mod python;

#[cfg(any(feature = "python", feature = "stub-gen"))]
use pyo3::prelude::*;

// WASM bindings (optional)
#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(feature = "wasm")]
pub mod wasm_types;

/// Python module entry point.
#[cfg(any(feature = "python", feature = "stub-gen"))]
#[pymodule]
fn _ferrox(py_mod: &Bound<'_, PyModule>) -> PyResult<()> {
    py_mod.add("__version__", env!("CARGO_PKG_VERSION"))?;
    python::register(py_mod)?;
    Ok(())
}
