fn main() {
    println!("cargo:rerun-if-changed=resources/kiko.exe.manifest");
    println!("cargo:rerun-if-changed=resources/kiko.ico");

    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_manifest_file("resources/kiko.exe.manifest");
        resource.set_icon("resources/kiko.ico");
        resource.set("ProductName", "kiko");
        resource.set("FileDescription", "kiko");
        resource.set("CompanyName", "kiko");
        resource.compile().expect("compile the windows resources");
    }
}
