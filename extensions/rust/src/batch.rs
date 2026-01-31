//! Batch processing for structure matching.
//!
//! This module provides batch processing capabilities for deduplicating and
//! grouping large sets of structures. When the `rayon` feature is enabled,
//! operations are parallelized for better performance on multi-core systems.

use crate::error::{FerroxError, Result};
use crate::io::parse_structure_json;
use crate::matcher::StructureMatcher;
use crate::structure::Structure;
use indexmap::IndexMap;
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(feature = "rayon")]
use rayon::prelude::*;

// Union-Find Data Structure

/// Thread-safe Union-Find (Disjoint Set) data structure.
///
/// Uses lock-free CAS operations for safe concurrent access.
/// Path compression uses CAS to avoid races, and union uses
/// index-based ordering (smaller always points to larger) to prevent cycles.
pub struct UnionFind {
    /// Parent pointers (atomic for thread safety)
    parent: Vec<AtomicUsize>,
}

impl UnionFind {
    /// Create a new UnionFind with `n` elements, each in its own set.
    pub fn new(n: usize) -> Self {
        let parent = (0..n).map(AtomicUsize::new).collect();
        Self { parent }
    }

    /// Find the representative of the set containing `x`.
    ///
    /// Uses CAS-based path compression for thread safety.
    pub fn find(&self, x: usize) -> usize {
        let mut current = x;

        // Find root (no writes in this phase)
        loop {
            let parent = self.parent[current].load(Ordering::Acquire);
            if parent == current {
                break;
            }
            current = parent;
        }
        let root = current;

        // Path compression using CAS (safe for concurrent access)
        // We compress the path from x to root
        current = x;
        while current != root {
            let parent = self.parent[current].load(Ordering::Acquire);
            if parent == root {
                break;
            }
            // Try to point current directly to root
            // If CAS fails, another thread already updated it - that's fine
            let _ = self.parent[current].compare_exchange(
                parent,
                root,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            current = parent;
        }

        root
    }

    /// Union the sets containing `x` and `y`.
    ///
    /// Uses CAS to atomically update parent pointers with retry logic.
    /// Always makes the smaller root point to the larger root to prevent cycles.
    ///
    /// Returns true if they were in different sets (union performed).
    pub fn union(&self, x: usize, y: usize) -> bool {
        loop {
            let root_x = self.find(x);
            let root_y = self.find(y);

            if root_x == root_y {
                return false; // Already in same set
            }

            // Always make smaller root point to larger root
            // This ordering prevents cycles and ensures deterministic behavior
            let (small, large) = if root_x < root_y {
                (root_x, root_y)
            } else {
                (root_y, root_x)
            };

            // Atomically try to make small point to large
            // Expected: small is still its own root (parent[small] == small)
            // Desired: small points to large
            if self.parent[small]
                .compare_exchange(small, large, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return true; // Successfully united
            }
            // CAS failed: another thread modified parent[small], retry
        }
    }

    /// Check if `x` and `y` are in the same set.
    pub fn connected(&self, x: usize, y: usize) -> bool {
        // Note: This is a point-in-time check. In concurrent scenarios,
        // the result may be stale by the time it's used.
        self.find(x) == self.find(y)
    }

    /// Get all equivalence classes as a map from representative to members.
    pub fn get_groups(&self) -> IndexMap<usize, Vec<usize>> {
        let mut groups: IndexMap<usize, Vec<usize>> = IndexMap::new();

        for idx in 0..self.parent.len() {
            let root = self.find(idx);
            groups.entry(root).or_default().push(idx);
        }

        groups
    }
}

// Helper Functions

/// Parse JSON strings into Structures with improved error context.
fn parse_json_structures(json_strings: &[&str]) -> Result<Vec<Structure>> {
    json_strings
        .iter()
        .enumerate()
        .map(|(idx, json)| {
            parse_structure_json(json).map_err(|err| match err {
                FerroxError::JsonError { reason, .. } => FerroxError::JsonError {
                    path: format!("structure[{idx}]"),
                    reason,
                },
                other => other,
            })
        })
        .collect()
}

// Helper macro to reduce cfg-gated code duplication between parallel and sequential paths
macro_rules! maybe_par_iter {
    ($collection:expr, $body:expr) => {{
        #[cfg(feature = "rayon")]
        {
            $collection.par_iter().for_each($body);
        }
        #[cfg(not(feature = "rayon"))]
        {
            $collection.iter().for_each($body);
        }
    }};
}

macro_rules! maybe_par_map {
    ($collection:expr, $body:expr) => {{
        #[cfg(feature = "rayon")]
        {
            $collection.par_iter().enumerate().map($body).collect()
        }
        #[cfg(not(feature = "rayon"))]
        {
            $collection.iter().enumerate().map($body).collect()
        }
    }};
}

// Simpler variant without enumerate for cases where index isn't needed
macro_rules! maybe_par_map_ref {
    ($collection:expr, $body:expr) => {{
        #[cfg(feature = "rayon")]
        {
            $collection.par_iter().map($body).collect()
        }
        #[cfg(not(feature = "rayon"))]
        {
            $collection.iter().map($body).collect()
        }
    }};
}

// Batch Processing Methods

impl StructureMatcher {
    /// Deduplicate a set of structures.
    ///
    /// Returns a vector where `result[i]` is the index of the first structure
    /// that matches structure `i`. If structure `i` is unique (first occurrence),
    /// then `result[i] = i`.
    ///
    /// # Algorithm
    ///
    /// 1. Group structures by composition hash (fast pre-filter)
    /// 2. Within each group, compare pairwise using union-find
    /// 3. Parallelize comparisons with Rayon (when available)
    ///
    /// # Example
    ///
    /// For structures `[A, B, A', C, B']` where `A'≈A` and `B'≈B`:
    /// - Returns `[0, 1, 0, 3, 1]`
    ///
    /// # Arguments
    ///
    /// * `structures` - The structures to deduplicate
    pub fn deduplicate(&self, structures: &[Structure]) -> Result<Vec<usize>> {
        if structures.is_empty() {
            return Ok(vec![]);
        }

        let len = structures.len();
        let uf = UnionFind::new(len);

        // Step 1: Reduce all structures (parallel when rayon enabled), then group by composition hash.
        // Reducing first ensures supercells are properly grouped with their primitive cells.
        let reduced: Vec<_> = maybe_par_map!(structures, |(idx, s)| {
            let reduced = self.reduce_structure(s);
            let hash = self.composition_hash(&reduced);
            (idx, hash, reduced)
        });

        let mut comp_groups: IndexMap<u64, Vec<(usize, Structure)>> = IndexMap::new();
        for (idx, hash, reduced) in reduced {
            comp_groups.entry(hash).or_default().push((idx, reduced));
        }

        // Step 2: Within each composition group, compare pairwise (parallel when rayon enabled)
        let groups_vec: Vec<_> = comp_groups.values().collect();
        maybe_par_iter!(groups_vec, |group| {
            // Generate all pairs within this group
            for idx in 0..group.len() {
                for jdx in (idx + 1)..group.len() {
                    let (idx_i, reduced_i) = &group[idx];
                    let (idx_j, reduced_j) = &group[jdx];

                    // Compare pre-reduced structures (avoids redundant reduction)
                    if self.fit_preprocessed(reduced_i, reduced_j) {
                        uf.union(*idx_i, *idx_j);
                    }
                }
            }
        });

        // Step 3: Build result - for each structure, find the minimum index in its group
        let groups = uf.get_groups();
        let mut result = vec![0; len];

        for members in groups.values() {
            // UnionFind groups always have at least one member, so unwrap is safe
            let min_idx = members.iter().min().copied().unwrap();
            for &idx in members {
                result[idx] = min_idx;
            }
        }

        Ok(result)
    }

    /// Group structures into equivalence classes.
    ///
    /// Returns a map where:
    /// - Key: index of the canonical (first) structure in each class
    /// - Value: indices of all structures equivalent to the canonical
    ///
    /// # Example
    ///
    /// For structures `[A, B, A', C, B']` where `A'≈A` and `B'≈B`:
    /// - Returns `{0: [0, 2], 1: [1, 4], 3: [3]}`
    ///
    /// # Arguments
    ///
    /// * `structures` - The structures to group
    pub fn group(&self, structures: &[Structure]) -> Result<IndexMap<usize, Vec<usize>>> {
        let dedup_result = self.deduplicate(structures)?;

        let mut groups: IndexMap<usize, Vec<usize>> = IndexMap::new();
        for (idx, &canonical) in dedup_result.iter().enumerate() {
            groups.entry(canonical).or_default().push(idx);
        }

        // Sort by canonical index for deterministic output
        groups.sort_keys();

        Ok(groups)
    }

    /// Deduplicate structures from JSON strings.
    ///
    /// More efficient than parsing in Python first because everything
    /// happens in Rust.
    ///
    /// # Arguments
    ///
    /// * `json_strings` - JSON strings in pymatgen Structure.as_dict() format
    pub fn deduplicate_json(&self, json_strings: &[&str]) -> Result<Vec<usize>> {
        self.deduplicate(&parse_json_structures(json_strings)?)
    }

    /// Group structures from JSON strings.
    ///
    /// # Arguments
    ///
    /// * `json_strings` - JSON strings in pymatgen Structure.as_dict() format
    pub fn group_json(&self, json_strings: &[&str]) -> Result<IndexMap<usize, Vec<usize>>> {
        self.group(&parse_json_structures(json_strings)?)
    }

    /// Find matches for new structures against existing (already-deduplicated) structures.
    ///
    /// This is optimized for the common deduplication scenario where:
    /// - `existing` structures are already deduplicated (don't need to compare against each other)
    /// - `new` structures need to be matched against `existing` to find duplicates
    ///
    /// Returns a vector where `result[i]` is:
    /// - `Some(j)` if new structure `i` matches existing structure `j`
    /// - `None` if new structure `i` is unique (no match in existing)
    ///
    /// # Algorithm
    ///
    /// 1. Preprocess existing structures (Niggli reduction, composition hashing)
    /// 2. For each new structure (in parallel when available):
    ///    - Filter by composition hash
    ///    - Compare against matching existing structures until first match (early termination)
    ///
    /// # Performance
    ///
    /// This is O(new × existing_per_composition) instead of O((new + existing)²) because:
    /// - Existing structures aren't compared against each other
    /// - Composition hashing filters most comparisons
    /// - Early termination on first match
    ///
    /// # Arguments
    ///
    /// * `new_structures` - New structures to check for matches
    /// * `existing_structures` - Already-deduplicated structures to match against
    pub fn find_matches(
        &self,
        new_structures: &[Structure],
        existing_structures: &[Structure],
    ) -> Result<Vec<Option<usize>>> {
        if new_structures.is_empty() {
            return Ok(vec![]);
        }

        if existing_structures.is_empty() {
            return Ok(vec![None; new_structures.len()]);
        }

        // Step 1: Reduce existing structures (parallel when rayon enabled), then group by composition hash
        let existing_reduced: Vec<_> = maybe_par_map!(existing_structures, |(idx, s)| {
            let reduced = self.reduce_structure(s);
            let hash = self.composition_hash(&reduced);
            (idx, hash, reduced)
        });

        let mut existing_by_comp: IndexMap<u64, Vec<(usize, Structure)>> = IndexMap::new();
        for (idx, hash, reduced) in existing_reduced {
            existing_by_comp
                .entry(hash)
                .or_default()
                .push((idx, reduced));
        }

        // Step 2: For each new structure, find first matching existing structure
        let results: Vec<Option<usize>> = maybe_par_map_ref!(new_structures, |new_struct| {
            let reduced_new = self.reduce_structure(new_struct);
            let new_hash = self.composition_hash(&reduced_new);

            // Find first match among candidates with same composition (early termination)
            existing_by_comp.get(&new_hash).and_then(|candidates| {
                candidates
                    .iter()
                    .find(|(_, reduced_existing)| {
                        self.fit_preprocessed(&reduced_new, reduced_existing)
                    })
                    .map(|(idx, _)| *idx)
            })
        });

        Ok(results)
    }

    /// Find matches from JSON strings.
    ///
    /// # Arguments
    ///
    /// * `new_json` - JSON strings for new structures
    /// * `existing_json` - JSON strings for existing (already-deduplicated) structures
    pub fn find_matches_json(
        &self,
        new_json: &[&str],
        existing_json: &[&str],
    ) -> Result<Vec<Option<usize>>> {
        let new_structures = parse_json_structures(new_json)?;
        let existing_structures = parse_json_structures(existing_json)?;
        self.find_matches(&new_structures, &existing_structures)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use nalgebra::Vector3;

    // === Union-Find Tests ===

    #[test]
    fn test_union_find_basic() {
        let uf = UnionFind::new(5);

        // Initially all separate
        assert!(!uf.connected(0, 1));
        assert!(!uf.connected(1, 2));

        // Union 0 and 1
        assert!(uf.union(0, 1));
        assert!(uf.connected(0, 1));
        assert!(!uf.connected(0, 2));

        // Union 1 and 2 (transitively connects 0)
        assert!(uf.union(1, 2));
        assert!(uf.connected(0, 2));
    }

    #[test]
    fn test_union_find_already_connected() {
        let uf = UnionFind::new(3);
        uf.union(0, 1);

        // Unioning already-connected elements returns false
        assert!(!uf.union(0, 1));
    }

    #[test]
    fn test_union_find_groups() {
        let uf = UnionFind::new(5);
        uf.union(0, 2);
        uf.union(0, 4);
        uf.union(1, 3);

        let groups = uf.get_groups();

        // Should have 2 groups
        assert_eq!(groups.len(), 2);

        // Find group containing 0
        let group_0: Vec<_> = groups.values().find(|g| g.contains(&0)).unwrap().clone();
        assert!(group_0.contains(&0));
        assert!(group_0.contains(&2));
        assert!(group_0.contains(&4));
        assert_eq!(group_0.len(), 3);

        // Find group containing 1
        let group_1: Vec<_> = groups.values().find(|g| g.contains(&1)).unwrap().clone();
        assert!(group_1.contains(&1));
        assert!(group_1.contains(&3));
        assert_eq!(group_1.len(), 2);
    }

    // === Helper functions for batch tests ===

    fn make_nacl() -> Structure {
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    fn make_nacl_shifted() -> Structure {
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.01, 0.0, 0.0), Vector3::new(0.51, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    fn make_bcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(element), Species::neutral(element)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    fn make_fcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![
            Species::neutral(element),
            Species::neutral(element),
            Species::neutral(element),
            Species::neutral(element),
        ];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        Structure::new(lattice, species, coords)
    }

    // === Batch Processing Tests ===

    #[test]
    fn test_deduplicate_identical() {
        let s1 = make_nacl();
        let s2 = make_nacl(); // Identical
        let s3 = make_nacl_shifted(); // Slightly different but matches

        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate(&[s1, s2, s3]).unwrap();

        // All should map to 0 (the first structure)
        assert_eq!(result, vec![0, 0, 0]);
    }

    #[test]
    fn test_deduplicate_different() {
        let s1 = make_nacl();
        let s2 = make_bcc(Element::Fe, 2.87);
        let s3 = make_fcc(Element::Cu, 3.6);

        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate(&[s1, s2, s3]).unwrap();

        // Each is unique
        assert_eq!(result, vec![0, 1, 2]);
    }

    #[test]
    fn test_deduplicate_mixed() {
        let s1 = make_nacl();
        let s2 = make_bcc(Element::Fe, 2.87);
        let s3 = make_nacl(); // Matches s1
        let s4 = make_bcc(Element::Fe, 2.87); // Matches s2

        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate(&[s1, s2, s3, s4]).unwrap();

        assert_eq!(result, vec![0, 1, 0, 1]);
    }

    #[test]
    fn test_deduplicate_empty() {
        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate(&[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_deduplicate_single() {
        let s = make_nacl();
        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate(&[s]).unwrap();
        assert_eq!(result, vec![0]);
    }

    #[test]
    fn test_group() {
        let s1 = make_nacl();
        let s2 = make_bcc(Element::Fe, 2.87);
        let s3 = make_nacl();
        let s4 = make_bcc(Element::Fe, 2.87);

        let matcher = StructureMatcher::new();
        let groups = matcher.group(&[s1, s2, s3, s4]).unwrap();

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[&0], vec![0, 2]); // NaCl group
        assert_eq!(groups[&1], vec![1, 3]); // BCC Fe group
    }

    #[test]
    fn test_group_empty() {
        let matcher = StructureMatcher::new();
        let groups = matcher.group(&[]).unwrap();
        assert!(groups.is_empty());
    }

    #[test]
    fn test_deduplicate_json() {
        let json1 = r#"{"lattice":{"matrix":[[5.64,0,0],[0,5.64,0],[0,0,5.64]]},"sites":[{"species":[{"element":"Na"}],"abc":[0,0,0]},{"species":[{"element":"Cl"}],"abc":[0.5,0.5,0.5]}]}"#;
        let json2 = r#"{"lattice":{"matrix":[[5.64,0,0],[0,5.64,0],[0,0,5.64]]},"sites":[{"species":[{"element":"Na"}],"abc":[0.01,0,0]},{"species":[{"element":"Cl"}],"abc":[0.51,0.5,0.5]}]}"#;

        let matcher = StructureMatcher::new();
        let result = matcher.deduplicate_json(&[json1, json2]).unwrap();

        assert_eq!(result, vec![0, 0]); // Both should match
    }

    #[test]
    fn test_group_json() {
        let json1 = r#"{"lattice":{"matrix":[[5.64,0,0],[0,5.64,0],[0,0,5.64]]},"sites":[{"species":[{"element":"Na"}],"abc":[0,0,0]},{"species":[{"element":"Cl"}],"abc":[0.5,0.5,0.5]}]}"#;
        let json2 = r#"{"lattice":{"matrix":[[2.87,0,0],[0,2.87,0],[0,0,2.87]]},"sites":[{"species":[{"element":"Fe"}],"abc":[0,0,0]},{"species":[{"element":"Fe"}],"abc":[0.5,0.5,0.5]}]}"#;
        let json3 = r#"{"lattice":{"matrix":[[5.64,0,0],[0,5.64,0],[0,0,5.64]]},"sites":[{"species":[{"element":"Na"}],"abc":[0,0,0]},{"species":[{"element":"Cl"}],"abc":[0.5,0.5,0.5]}]}"#;

        let matcher = StructureMatcher::new();
        let groups = matcher.group_json(&[json1, json2, json3]).unwrap();

        assert_eq!(groups.len(), 2);
        assert!(groups[&0].contains(&0));
        assert!(groups[&0].contains(&2));
        assert!(groups[&1].contains(&1));
    }

    #[test]
    fn test_composition_prefilter() {
        // Structures with different compositions should never be compared
        let structures = vec![
            make_nacl(),
            make_bcc(Element::Fe, 2.87),
            make_nacl(),
            make_fcc(Element::Cu, 3.6),
            make_bcc(Element::Fe, 2.87),
        ];

        let matcher = StructureMatcher::new();
        let groups = matcher.group(&structures).unwrap();

        // Should have 3 groups: NaCl, Fe-BCC, Cu-FCC
        assert_eq!(groups.len(), 3);
    }

    // === find_matches Tests ===

    #[test]
    fn test_find_matches_basic() {
        // Existing structures (already deduplicated)
        let existing = vec![
            make_nacl(),
            make_bcc(Element::Fe, 2.87),
            make_fcc(Element::Cu, 3.6),
        ];

        // New structures: one matches NaCl, one matches Fe BCC, one is unique
        let new_si = make_fcc(Element::Si, 5.43); // Unique - different element
        let new_nacl = make_nacl_shifted(); // Matches existing[0]
        let new_fe = make_bcc(Element::Fe, 2.87); // Matches existing[1]

        let new = vec![new_si, new_nacl, new_fe];

        let matcher = StructureMatcher::new();
        let matches = matcher.find_matches(&new, &existing).unwrap();

        // Si unique, NaCl matches existing[0], Fe matches existing[1]
        assert_eq!(matches, vec![None, Some(0), Some(1)]);
    }

    #[test]
    fn test_find_matches_empty_new() {
        let existing = vec![make_nacl()];
        let matcher = StructureMatcher::new();
        let matches = matcher.find_matches(&[], &existing).unwrap();
        assert!(matches.is_empty());
    }

    #[test]
    fn test_find_matches_empty_existing() {
        let new = vec![make_nacl(), make_bcc(Element::Fe, 2.87)];
        let matcher = StructureMatcher::new();
        let matches = matcher.find_matches(&new, &[]).unwrap();

        // All should be None (no matches possible)
        assert_eq!(matches, vec![None, None]);
    }

    #[test]
    fn test_find_matches_all_unique() {
        let existing = vec![make_nacl()];
        let new = vec![make_bcc(Element::Fe, 2.87), make_fcc(Element::Cu, 3.6)];

        let matcher = StructureMatcher::new();
        let matches = matcher.find_matches(&new, &existing).unwrap();

        // All new structures are unique (different compositions)
        assert_eq!(matches, vec![None, None]);
    }

    #[test]
    fn test_find_matches_all_duplicates() {
        let existing = vec![make_nacl(), make_bcc(Element::Fe, 2.87)];
        let new = vec![
            make_nacl(),
            make_nacl_shifted(),
            make_bcc(Element::Fe, 2.87),
        ];

        let matcher = StructureMatcher::new();
        let matches = matcher.find_matches(&new, &existing).unwrap();

        // NaCl->existing[0], NaCl shifted->existing[0], Fe BCC->existing[1]
        assert_eq!(matches, vec![Some(0), Some(0), Some(1)]);
    }

    // === Concurrent Stress Tests ===

    #[test]
    fn test_union_find_concurrent_stress() {
        // Stress test: many threads performing unions concurrently
        // This tests that the CAS-based implementation is correct
        use std::sync::Arc;
        use std::thread;

        let n = 100;
        let uf = Arc::new(UnionFind::new(n));

        // Create threads that will union elements in parallel
        // Pattern: union (0,1), (1,2), (2,3), ... which should result in one big set
        let mut handles = vec![];

        for idx in 0..(n - 1) {
            let uf_clone = Arc::clone(&uf);
            let handle = thread::spawn(move || {
                uf_clone.union(idx, idx + 1);
            });
            handles.push(handle);
        }

        // Wait for all threads
        for handle in handles {
            handle.join().unwrap();
        }

        // All elements should be in the same set now
        let groups = uf.get_groups();
        assert_eq!(groups.len(), 1, "All {n} elements should be in one group");

        let group = groups.values().next().unwrap();
        assert_eq!(group.len(), n, "Group should contain all {n} elements");
    }

    #[test]
    fn test_union_find_concurrent_multiple_groups() {
        // Test concurrent unions that create multiple distinct groups
        use std::sync::Arc;
        use std::thread;

        let n = 100;
        let uf = Arc::new(UnionFind::new(n));

        // Create 10 groups: [0-9], [10-19], ..., [90-99]
        let mut handles = vec![];

        for group_idx in 0..10 {
            let base = group_idx * 10;
            for offset in 0..9 {
                let uf_clone = Arc::clone(&uf);
                let handle = thread::spawn(move || {
                    uf_clone.union(base + offset, base + offset + 1);
                });
                handles.push(handle);
            }
        }

        // Wait for all threads
        for handle in handles {
            handle.join().unwrap();
        }

        // Should have exactly 10 groups
        let groups = uf.get_groups();
        assert_eq!(groups.len(), 10, "Should have 10 distinct groups");

        // Each group should have 10 elements
        for group in groups.values() {
            assert_eq!(group.len(), 10, "Each group should have 10 elements");
        }

        // Elements from different groups should not be connected
        assert!(!uf.connected(0, 10));
        assert!(!uf.connected(5, 15));
        assert!(!uf.connected(90, 0));

        // Elements in same group should be connected
        assert!(uf.connected(0, 9));
        assert!(uf.connected(10, 19));
        assert!(uf.connected(90, 99));
    }

    #[test]
    fn test_union_find_concurrent_racing_unions() {
        // Test scenario where multiple threads try to union overlapping pairs
        // This is the most likely to trigger race conditions
        use std::sync::Arc;
        use std::thread;

        // Run multiple times to increase chance of catching races
        for _ in 0..10 {
            let uf = Arc::new(UnionFind::new(10));

            // Multiple threads trying to connect various pairs simultaneously
            let pairs = vec![
                (0, 1),
                (1, 2),
                (2, 3),
                (0, 2), // redundant
                (1, 3), // redundant
                (3, 4),
                (4, 5),
                (5, 6),
                (3, 5), // redundant
                (6, 7),
                (7, 8),
                (8, 9),
                (6, 8), // redundant
                (0, 9), // connects everything
            ];

            let mut handles = vec![];
            for (x, y) in pairs {
                let uf_clone = Arc::clone(&uf);
                let handle = thread::spawn(move || {
                    uf_clone.union(x, y);
                });
                handles.push(handle);
            }

            for handle in handles {
                handle.join().unwrap();
            }

            // All elements should be in one group
            let groups = uf.get_groups();
            assert_eq!(
                groups.len(),
                1,
                "All elements should be connected after racing unions"
            );
        }
    }
}
