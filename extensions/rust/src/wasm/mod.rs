//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! Structure, and StructureMatcher types via wasm-bindgen.
//!
//! All structure functions use strongly-typed `JsCrystal` inputs/outputs.
//! Results are returned as `WasmResult<T>` = `{ ok: T }` | `{ error: string }`.

// Submodules
pub mod cell;
pub mod composition;
pub mod coordination;
pub mod defects;
pub mod elastic;
pub mod element;
pub mod helpers;
pub mod io;
pub mod lattice;
pub mod md;
pub mod neighbors;
pub mod optimizers;
pub mod order_params;
pub mod potentials;
pub mod properties;
pub mod rdf;
pub mod species;
pub mod structure;
pub mod surfaces;
pub mod symmetry;
pub mod trajectory;
pub mod transformations;
pub mod xrd;

// Re-export all public items from submodules for backward compatibility
pub use cell::*;
pub use composition::*;
pub use coordination::{
    get_average_coordination_number, get_coordination_number, get_coordination_numbers,
};
pub use defects::*;
pub use elastic::*;
pub use element::*;
pub use io::*;
pub use lattice::*;
pub use md::*;
pub use neighbors::*;
pub use optimizers::*;
pub use order_params::*;
pub use potentials::*;
pub use properties::*;
pub use rdf::{JsRdfResult, compute_element_rdf, compute_rdf_wasm};
pub use species::*;
pub use structure::*;
pub use surfaces::*;
pub use symmetry::*;
pub use trajectory::*;
pub use transformations::*;
pub use xrd::*;

// Re-export helpers for internal use
pub(crate) use helpers::{mat3_to_array, parse_flat_cell, parse_flat_vec3};
