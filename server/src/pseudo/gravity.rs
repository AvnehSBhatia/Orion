//! Port of `src/pseudo/gravity.ts`. STUB. Tests: `src/pseudo/pseudo.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

#[derive(Debug, Clone, PartialEq)]
pub struct Gravity {
    /// Where this person sits in the org space. Unit length.
    pub center: Vec<f32>,
    /// Per-component pull strength in [0, MAX_PULL].
    pub g: Vec<f32>,
    /// Overall strength, grows with how much evidence we have about the person.
    pub mass: f32,
}

/// Mean component pull for a person with full evidence.
pub const STRENGTH: f64 = 0.45;
/// No component may move a vector more than this fraction toward the center.
pub const MAX_PULL: f64 = 0.9;
/// Softening radius squared.
pub const SOFTENING2: f64 = 1.0;
/// Evidence items (owned + touched) at which mass reaches 1.
pub const FULL_EVIDENCE: f64 = 10.0;
/// Mass floor for a person we only know by role.
pub const MIN_MASS: f64 = 0.5;

pub fn corpus_mean(vectors: &[&[f32]], dims: usize) -> Vec<f32> {
    todo!("port corpusMean from src/pseudo/gravity.ts")
}

pub fn fit_gravity(center: Vec<f32>, evidence: &[&[f32]], corpus: &[f32]) -> Gravity {
    todo!("port fitGravity from src/pseudo/gravity.ts")
}

/// Softened inverse-square pull of a query toward the person's center.
pub fn pull(z: &[f32], grav: &Gravity) -> Vec<f32> {
    todo!("port pull from src/pseudo/gravity.ts")
}

/// Cosine under the person's metric: component d counts (1 + g_d) times.
pub fn weighted_cosine(a: &[f32], b: &[f32], g: &[f32]) -> f64 {
    todo!("port weightedCosine from src/pseudo/gravity.ts")
}

pub fn gravity_score(q: &[f32], z: &[f32], grav: &Gravity) -> f64 {
    todo!("port gravityScore from src/pseudo/gravity.ts")
}

/// [mass, center..., g...]
pub fn pack_gravity(grav: &Gravity) -> Vec<f32> {
    todo!("port packGravity from src/pseudo/gravity.ts")
}

pub fn unpack_gravity(buf: &[f32]) -> Gravity {
    todo!("port unpackGravity from src/pseudo/gravity.ts")
}
