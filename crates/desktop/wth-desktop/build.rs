fn main() {
    tauri_build::build();

    // Windows GNU toolchain doesn't auto-bundle WebView2Loader.dll.
    // Copy it alongside the binary so the NSIS installer can include it.
    #[cfg(target_os = "windows")]
    {
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());

        // Find webview2-com-sys build dir (contains the platform DLLs)
        let build_root = out_dir.parent().unwrap().parent().unwrap();
        if let Ok(entries) = build_root.read_dir() {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("webview2-com-sys-") {
                    let src = entry.path().join("out").join("x64").join("WebView2Loader.dll");
                    if src.exists() {
                        // Copy to project root so Tauri sees it for bundling
                        let manifest = std::path::PathBuf::from(
                            std::env::var("CARGO_MANIFEST_DIR").unwrap(),
                        );
                        let dst = manifest.join("WebView2Loader.dll");
                        std::fs::copy(&src, &dst).ok();
                        println!("cargo:warning=Copied WebView2Loader.dll to manifest dir");

                        // Also copy to target directory for direct execution
                        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
                        let target_dir = manifest
                            .parent()
                            .unwrap()
                            .parent()
                            .unwrap()
                            .join("target")
                            .join(&profile);
                        let target_dst = target_dir.join("WebView2Loader.dll");
                        std::fs::copy(&src, &target_dst).ok();
                        println!(
                            "cargo:warning=Copied WebView2Loader.dll to {}",
                            target_dir.display()
                        );
                    }
                }
            }
        }
    }
}
