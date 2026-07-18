#
# Wide Thought Host (WTH) enterprise installer for PowerShell
# Same as install.ps1 but with enterprise-oriented defaults.

$env:WTH_INSTALL_DIR = if ($env:WTH_INSTALL_DIR) { $env:WTH_INSTALL_DIR } else { "$env:ProgramData\wth" }
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Wan-1230/Wide-Thought-Host/main/scripts/install.ps1)))
