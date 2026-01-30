//! Structure transformation internals and tests.
//!
//! The public API is exposed via methods on `Structure`:
//!
//! - One-to-one: `structure.rotate()`, `structure.substitute()`, etc.
//! - One-to-many: `structure.order_disordered()`, `structure.partial_remove()`, etc.
//!
//! Config structs are re-exported from the crate root:
//! - `OrderDisorderedConfig` - for `order_disordered()`
//! - `PartialRemoveConfig` - for `partial_remove()`
//! - `EnumConfig` - for `enumerate_derivatives()`

use crate::error::Result;
use crate::structure::Structure;

// Internal ordering transform implementations
pub mod ordering;
// Test modules for site and standard transforms
#[cfg(test)]
pub mod site;
#[cfg(test)]
pub mod standard;

// Re-export config types (these are the public API)
pub use ordering::{OrderDisorderedConfig, PartialRemoveConfig};

// Re-export internal transform types used by Structure methods
pub(crate) use ordering::{
    DiscretizeOccupanciesTransform, OrderDisorderedTransform, PartialRemoveTransform,
};

/// One-to-one structure transformation.
///
/// Transforms that take a structure and produce exactly one output structure.
/// These can be applied in-place or return a new structure.
///
/// # Design Philosophy
///
/// - `apply(&self, &mut Structure)` mutates in place (efficient, matches existing APIs)
/// - `applied(&self, &Structure)` returns new structure (convenient, pure)
/// - Errors are returned for invalid state, not for "nothing to do" (no-op is fine)
///
/// # Example
///
/// ```rust,ignore
/// // Apply in place
/// transform.apply(&mut structure)?;
///
/// // Create new structure
/// let new_struct = transform.applied(&structure)?;
/// ```
pub trait Transform {
    /// Apply the transformation in place.
    ///
    /// # Errors
    ///
    /// Returns an error if the transformation cannot be applied due to invalid
    /// structure state (e.g., incompatible lattice for a supercell operation).
    fn apply(&self, structure: &mut Structure) -> Result<()>;

    /// Apply the transformation and return a new structure.
    ///
    /// This is a convenience method that clones the structure, applies the
    /// transformation, and returns the result.
    ///
    /// # Errors
    ///
    /// Returns an error if the transformation cannot be applied.
    fn applied(&self, structure: &Structure) -> Result<Structure> {
        let mut copy = structure.clone();
        self.apply(&mut copy)?;
        Ok(copy)
    }
}

/// One-to-many structure transformation.
///
/// Transforms that take a structure and produce zero or more output structures.
/// Common examples include:
///
/// - Enumeration of derivative structures
/// - Ordering of disordered structures
/// - Partial removal of species
///
/// # Design Philosophy
///
/// - Returns a lazy iterator for memory efficiency with large enumerations
/// - Supports parallel iteration via Rayon for performance
/// - `apply_all()` collects all results (convenience, eager)
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::{TransformMany, OrderDisorderedTransform};
///
/// let transform = OrderDisorderedTransform::default();
///
/// // Lazy iteration
/// for result in transform.iter_apply(&structure) {
///     let ordered = result?;
///     println!("Energy: {}", ordered.properties.get("ewald_energy"));
/// }
///
/// // Collect all
/// let all_orderings = transform.apply_all(&structure)?;
/// ```
pub trait TransformMany {
    /// The iterator type returned by `iter_apply`.
    type Iter: Iterator<Item = Result<Structure>>;

    /// Return a lazy iterator over transformed structures.
    ///
    /// Each item in the iterator is a `Result<Structure>` to allow for
    /// per-structure errors without halting the entire enumeration.
    fn iter_apply(&self, structure: &Structure) -> Self::Iter;

    /// Collect all transformed structures.
    ///
    /// This is a convenience method that collects all iterator results.
    ///
    /// # Errors
    ///
    /// Returns an error if any transformation fails. For partial results
    /// even on error, use `iter_apply()` directly.
    fn apply_all(&self, structure: &Structure) -> Result<Vec<Structure>> {
        self.iter_apply(structure).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use nalgebra::{Matrix3, Vector3};

    /// Create a simple cubic NaCl structure for testing.
    fn nacl_structure() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(5.64, 5.64, 5.64)));
        let na = Species::new(Element::Na, Some(1));
        let cl = Species::new(Element::Cl, Some(-1));

        Structure::new(
            lattice,
            vec![na, cl],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    #[test]
    fn test_transform_trait_default_impl() {
        // Test that the default `applied` implementation works correctly
        struct IdentityTransform;
        impl Transform for IdentityTransform {
            fn apply(&self, _structure: &mut Structure) -> Result<()> {
                Ok(())
            }
        }

        let structure = nacl_structure();
        let transform = IdentityTransform;
        let result = transform.applied(&structure).unwrap();

        assert_eq!(result.num_sites(), structure.num_sites());
    }

    #[test]
    fn test_transform_many_trait_default_impl() {
        // Test that the default `apply_all` implementation works correctly
        struct EmptyTransform;
        impl TransformMany for EmptyTransform {
            type Iter = std::iter::Empty<Result<Structure>>;
            fn iter_apply(&self, _structure: &Structure) -> Self::Iter {
                std::iter::empty()
            }
        }

        let structure = nacl_structure();
        let transform = EmptyTransform;
        let results = transform.apply_all(&structure).unwrap();

        assert!(results.is_empty());
    }
}
