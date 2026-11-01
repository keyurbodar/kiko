#![cfg(target_os = "macos")]

mod act;
mod apps;
mod ax;
mod capture;
mod cf;
mod driver;
#[cfg(test)]
mod e2e;
mod input;
mod look;
mod menu;
mod permissions;
mod private;
mod window;
mod worker;

use kiko_driver::Native;

pub use driver::MacDriver;
pub use private::symbols as private_symbols;

pub fn driver() -> kiko_driver::Result<Box<dyn Native>> {
    Ok(Box::new(MacDriver::new()?))
}
