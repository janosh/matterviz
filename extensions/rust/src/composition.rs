//! Composition handling.
//!
//! This module provides the `Composition` type for representing chemical compositions
//! with support for reduced formulas and fast hashing for equality checks.

use crate::element::Element;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// A chemical composition mapping elements to amounts.
///
/// # Examples
///
/// ```
/// use ferrox::composition::Composition;
/// use ferrox::element::Element;
///
/// let comp = Composition::new([(Element::Fe, 2.0), (Element::O, 3.0)]);
/// assert_eq!(comp.reduced_formula(), "Fe2O3");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Composition {
    /// Elements and their amounts (preserved insertion order).
    elements: IndexMap<Element, f64>,
}

impl Composition {
    /// Create a new composition from element-amount pairs.
    pub fn new(elements: impl IntoIterator<Item = (Element, f64)>) -> Self {
        let elements: IndexMap<Element, f64> = elements
            .into_iter()
            .filter(|(_, amt)| *amt > 0.0)
            .collect();
        Self { elements }
    }

    /// Get the amount of an element in this composition.
    pub fn get(&self, element: Element) -> f64 {
        self.elements.get(&element).copied().unwrap_or(0.0)
    }

    /// Get the total number of atoms.
    pub fn num_atoms(&self) -> f64 {
        self.elements.values().sum()
    }

    /// Get the number of unique elements.
    pub fn num_elements(&self) -> usize {
        self.elements.len()
    }

    /// Check if composition is empty.
    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    /// Get the reduced formula string.
    pub fn reduced_formula(&self) -> String {
        // Find GCD of all amounts
        let gcd = self.gcd_of_amounts();
        if gcd == 0.0 {
            return String::new();
        }

        // Sort elements by electronegativity (most electropositive first)
        let mut sorted: Vec<_> = self.elements.iter().collect();
        sorted.sort_by(|(a, _), (b, _)| {
            let en_a = a.electronegativity().unwrap_or(f64::MAX);
            let en_b = b.electronegativity().unwrap_or(f64::MAX);
            en_a.partial_cmp(&en_b).unwrap()
        });

        let mut formula = String::new();
        for (elem, &amt) in sorted {
            let reduced_amt = amt / gcd;
            formula.push_str(elem.symbol());
            if (reduced_amt - 1.0).abs() > 1e-10 {
                // Format as integer if close to integer, else as float
                if (reduced_amt - reduced_amt.round()).abs() < 1e-10 {
                    formula.push_str(&(reduced_amt.round() as i64).to_string());
                } else {
                    formula.push_str(&format!("{reduced_amt:.2}"));
                }
            }
        }
        formula
    }

    /// Get a hash of the reduced formula for fast equality checks.
    ///
    /// Two compositions with the same reduced formula will have the same hash.
    pub fn hash(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.reduced_formula().hash(&mut hasher);
        hasher.finish()
    }

    /// Compute GCD of all amounts (treating them as approximate integers).
    fn gcd_of_amounts(&self) -> f64 {
        if self.elements.is_empty() {
            return 0.0;
        }

        let amounts: Vec<f64> = self.elements.values().copied().collect();
        let mut result = amounts[0];

        for &amt in &amounts[1..] {
            result = gcd_float(result, amt);
            if result < 1e-10 {
                return 1.0; // Fallback
            }
        }

        result
    }

    /// Iterate over (element, amount) pairs.
    pub fn iter(&self) -> impl Iterator<Item = (&Element, &f64)> {
        self.elements.iter()
    }
}

/// Compute GCD of two floating point numbers (treating as approximate integers).
fn gcd_float(mut a: f64, mut b: f64) -> f64 {
    const EPSILON: f64 = 1e-10;
    const MAX_ITER: usize = 100;

    a = a.abs();
    b = b.abs();

    for _ in 0..MAX_ITER {
        if b < EPSILON {
            return a;
        }
        let temp = b;
        b = a % b;
        a = temp;
    }

    1.0 // Fallback
}

impl PartialEq for Composition {
    fn eq(&self, other: &Self) -> bool {
        // Compare actual reduced formulas, not hashes (to avoid hash collision false positives)
        self.reduced_formula() == other.reduced_formula()
    }
}

impl Eq for Composition {}

impl std::hash::Hash for Composition {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.reduced_formula().hash(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_composition_basics() {
        let comp = Composition::new([(Element::Fe, 2.0), (Element::O, 3.0)]);

        // get() returns correct counts
        assert_eq!(comp.get(Element::Fe), 2.0);
        assert_eq!(comp.get(Element::O), 3.0);
        assert_eq!(comp.get(Element::H), 0.0); // missing element

        // num_atoms and num_elements
        assert!((comp.num_atoms() - 5.0).abs() < 1e-10);
        assert_eq!(comp.num_elements(), 2);
    }

    #[test]
    fn test_reduced_formula() {
        // Test various formula reductions
        let cases = [
            (vec![(Element::Fe, 2.0), (Element::O, 3.0)], "Fe2O3"),
            (vec![(Element::Na, 1.0), (Element::Cl, 1.0)], "NaCl"),
            (vec![(Element::H, 4.0), (Element::O, 2.0)], "H2O"),   // reduces 4:2 -> 2:1
            (vec![(Element::Fe, 4.0), (Element::O, 6.0)], "Fe2O3"), // reduces
            (vec![(Element::Cu, 1.0)], "Cu"),                       // single element
            (vec![(Element::Fe, 4.0)], "Fe"),                       // single element reduces
        ];

        for (elements, expected) in cases {
            let comp = Composition::new(elements);
            assert_eq!(comp.reduced_formula(), expected);
        }
    }

    #[test]
    fn test_hash_equality() {
        let fe2o3_a = Composition::new([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let fe2o3_b = Composition::new([(Element::Fe, 4.0), (Element::O, 6.0)]); // same reduced
        let feo = Composition::new([(Element::Fe, 1.0), (Element::O, 1.0)]);
        let nacl = Composition::new([(Element::Na, 1.0), (Element::Cl, 1.0)]);

        // Same reduced formula -> same hash
        assert_eq!(fe2o3_a.hash(), fe2o3_b.hash());

        // Different compositions -> different hash
        assert_ne!(fe2o3_a.hash(), feo.hash());
        assert_ne!(fe2o3_a.hash(), nacl.hash());
    }

    #[test]
    fn test_empty_composition() {
        let empty = Composition::new([]);
        assert!(empty.is_empty());
        assert_eq!(empty.num_atoms(), 0.0);
        assert_eq!(empty.num_elements(), 0);
        assert_eq!(empty.reduced_formula(), "");
    }

    #[test]
    fn test_zero_amounts_filtered() {
        // Zero amounts should be filtered out
        let comp = Composition::new([
            (Element::Fe, 2.0),
            (Element::O, 0.0), // should be filtered
            (Element::Cu, 3.0),
        ]);
        assert_eq!(comp.num_elements(), 2);
        assert_eq!(comp.get(Element::O), 0.0);
        assert_eq!(comp.get(Element::Fe), 2.0);
        assert_eq!(comp.get(Element::Cu), 3.0);

        // Negative amounts should also be filtered
        let comp2 = Composition::new([(Element::Fe, -1.0), (Element::O, 2.0)]);
        assert_eq!(comp2.num_elements(), 1);
        assert_eq!(comp2.get(Element::Fe), 0.0);
    }

    #[test]
    fn test_iter() {
        let comp = Composition::new([(Element::Na, 1.0), (Element::Cl, 1.0)]);

        let pairs: Vec<_> = comp.iter().collect();
        assert_eq!(pairs.len(), 2);

        // Check that iteration covers all elements
        let elements: Vec<_> = pairs.iter().map(|(e, _)| **e).collect();
        assert!(elements.contains(&Element::Na));
        assert!(elements.contains(&Element::Cl));
    }

    #[test]
    fn test_partial_eq() {
        let a = Composition::new([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let b = Composition::new([(Element::Fe, 4.0), (Element::O, 6.0)]); // same reduced
        let c = Composition::new([(Element::Fe, 1.0), (Element::O, 1.0)]); // different

        // Same reduced formula -> equal
        assert_eq!(a, b);

        // Different reduced formula -> not equal
        assert_ne!(a, c);

        // Empty compositions are equal
        let empty1 = Composition::new([]);
        let empty2 = Composition::new([(Element::Fe, 0.0)]); // filtered to empty
        assert_eq!(empty1, empty2);
    }

    #[test]
    fn test_reduced_formula_cases() {
        let cases: &[(&[(Element, f64)], &str)] = &[
            (&[(Element::Cu, 1.0)], "Cu"),
            (&[(Element::Cu, 4.0)], "Cu"),
            (&[(Element::Fe, 0.5), (Element::O, 0.75)], "Fe2O3"),
            (&[(Element::Fe, 1.0), (Element::O, 1.5)], "Fe2O3"),
        ];
        for (elements, expected) in cases {
            let comp = Composition::new(elements.iter().copied());
            assert_eq!(comp.reduced_formula(), *expected);
        }
    }
}
