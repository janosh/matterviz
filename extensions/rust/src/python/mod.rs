//! Python bindings for ferrox.
//!
//! This module provides PyO3 bindings organized into submodules:
//! - `ferrox.io` - File I/O and format conversion
//! - `ferrox.structure` - Structure manipulation and matching
//! - `ferrox.lattice` - Lattice operations
//! - `ferrox.neighbors` - Distance and neighbor calculations
//! - `ferrox.coordination` - Coordination number analysis
//! - `ferrox.composition` - Formula parsing and composition analysis
//! - `ferrox.symmetry` - Space group and symmetry operations
//! - `ferrox.defects` - Point defect generation
//! - `ferrox.surfaces` - Surface and slab operations
//! - `ferrox.cell` - Cell reduction and transformations
//! - `ferrox.elastic` - Elastic tensor calculations
//! - `ferrox.rdf` - Radial distribution functions
//! - `ferrox.xrd` - X-ray diffraction
//! - `ferrox.oxidation` - Oxidation state analysis
//! - `ferrox.order_params` - Order parameters (Steinhardt Q)
//! - `ferrox.trajectory` - Trajectory analysis
//! - `ferrox.md` - Molecular dynamics integrators
//! - `ferrox.potentials` - Classical interatomic potentials

// PyO3 proc macros generate code that triggers false positive clippy warnings
#![allow(clippy::useless_conversion)]

use pyo3::prelude::*;

// Shared helpers
pub mod helpers;

// Submodules
pub mod cell;
pub mod composition;
pub mod coordination;
pub mod defects;
pub mod elastic;
pub mod element;
pub mod io;
pub mod lattice;
pub mod md;
pub mod neighbors;
pub mod order_params;
pub mod oxidation;
pub mod potentials;
pub mod rdf;
pub mod structure;
pub mod surfaces;
pub mod symmetry;
pub mod trajectory;
pub mod xrd;

/// Register all Python submodules.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    // Top-level Element class
    parent.add_class::<element::Element>()?;

    // Register all submodules
    io::register(parent)?;
    structure::register(parent)?;
    lattice::register(parent)?;
    neighbors::register(parent)?;
    coordination::register(parent)?;
    composition::register(parent)?;
    symmetry::register(parent)?;
    defects::register(parent)?;
    surfaces::register(parent)?;
    cell::register(parent)?;
    elastic::register(parent)?;
    rdf::register(parent)?;
    xrd::register(parent)?;
    oxidation::register(parent)?;
    order_params::register(parent)?;
    trajectory::register(parent)?;
    md::register(parent)?;
    potentials::register(parent)?;

    Ok(())
}
