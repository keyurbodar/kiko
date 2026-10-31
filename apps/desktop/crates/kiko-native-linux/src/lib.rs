#![cfg(target_os = "linux")]

mod a11y;
mod act;
mod capture;
mod error;
#[cfg(test)]
mod fake;
mod frames;
mod keys;
mod open;
mod pipewire;
mod session;
mod tree;
mod wayland;
mod x11;

pub use session::{Driver, driver, status};
