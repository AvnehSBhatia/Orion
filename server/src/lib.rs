//! Rust port of the Orion backend. Mirrors the TypeScript module tree under `src/` one file per file;
//! see `MODULES.md` for which modules are ported and which are still stubs.

// Stub modules keep their full signatures with `todo!()` bodies until they are ported.
#![allow(clippy::too_many_arguments)]

pub mod auth;
pub mod config;
pub mod contract;
pub mod db;
pub mod graph;
pub mod ingest;
pub mod llm;
pub mod mcp;
pub mod pseudo;
pub mod routes;
pub mod server;
pub mod steer;
pub mod synth;
pub mod text;
pub mod time;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use server::deps::AppState;
pub use server::http::HttpError;
