# dev.ps1 - Windows equivalent of dev.sh
# Wrapper script for npm run dev that supports --user-data-dir argument
# Usage: .\scripts\dev.ps1 --user-data-dir=C:\path\to\dir
#        .\scripts\dev.ps1 --local-only

# Parse arguments for --user-data-dir / --local-only
foreach ($arg in $args) {
    if ($arg -match "^--user-data-dir=(.+)$") {
        $env:NIMBALYST_USER_DATA_DIR = $Matches[1]
        Write-Host "[dev.ps1] Using custom userData directory: $env:NIMBALYST_USER_DATA_DIR"
    }
    if ($arg -eq "--local-only") {
        # Same switch the Settings > Advanced toggle sets, applied before launch.
        $env:NIMBALYST_LOCAL_ONLY = "1"
        Write-Host "[dev.ps1] Starting in local-only mode: no account, no collab, no telemetry"
    }
}

# Run the actual dev command
npm run build:worker
if ($LASTEXITCODE -eq 0) {
    npx electron-vite dev
}
