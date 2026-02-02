//! # ferrox
//!
//! High-performance structure matching for crystallographic data.
//!
//! This crate provides a Rust implementation of structure matching algorithms,
//! compatible with pymatgen's StructureMatcher but optimized for batch processing.
//!
//! ## Features
//!
//! - **Fast single-pair matching**: Compare two structures for equivalence
//! - **Batch deduplication**: Find unique structures in large sets
//! - **Parallel processing**: Automatic parallelization via Rayon (native only)
//! - **Multiple comparators**: Species or Element-based matching
//! - **Python bindings**: Optional PyO3 bindings for use from Python
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
pub mod integrators;
pub mod neighbors;
pub mod optimizers;
pub mod order_params;
pub mod pbc;
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

// Python bindings (optional)
#[cfg(feature = "python")]
mod python;

#[cfg(feature = "python")]
use pyo3::prelude::*;

// WASM bindings (optional)
#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(feature = "wasm")]
pub mod wasm_types;

/// Python module entry point.
#[cfg(feature = "python")]
#[pymodule]
fn _ferrox(py_mod: &Bound<'_, PyModule>) -> PyResult<()> {
    py_mod.add("__version__", env!("CARGO_PKG_VERSION"))?;
    python::register(py_mod)?;
    Ok(())
}
