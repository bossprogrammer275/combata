$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$makeHumanPython = Join-Path $root "tools\makehuman-core\.venv\Scripts\python.exe"
$mixamoPython = Join-Path $root "tools\mixamo-mcp\.venv\Scripts\python.exe"
$buildScript = Join-Path $PSScriptRoot "build_civilian.py"
$mixamoScript = Join-Path $PSScriptRoot "animate_civilian.py"

if (!(Test-Path $makeHumanPython)) {
    throw "MakeHuman Python environment not found: $makeHumanPython. Re-run the MakeHuman uv sync setup."
}
if (!(Test-Path $mixamoPython)) {
    throw "Mixamo Python environment not found: $mixamoPython. Re-run the Mixamo dependency installation."
}

Write-Host ""
Write-Host "=== OPEN WORLD: CIVILIAN 001 PIPELINE ===" -ForegroundColor Cyan
Write-Host "[1/2] Building the Nigerian civilian with MakeHuman..." -ForegroundColor Cyan
& $makeHumanPython $buildScript
if ($LASTEXITCODE -ne 0) {
    throw "MakeHuman generation failed with exit code $LASTEXITCODE."
}

Write-Host ""
Write-Host "[2/2] Uploading to Mixamo and downloading the animation set..." -ForegroundColor Cyan
Write-Host "A Chromium window will open using your saved local profile. If Adobe requests a sign-in, complete it in that window." -ForegroundColor Yellow
& $mixamoPython $mixamoScript
if ($LASTEXITCODE -ne 0) {
    throw "Mixamo stage failed with exit code $LASTEXITCODE. Read the messages above."
}

Write-Host ""
Write-Host "PIPELINE FINISHED." -ForegroundColor Green
Write-Host "Output: data\models\npc\civilian_001\" -ForegroundColor Green
Write-Host "Review manifest.json and civilian_001_bundle.zip before committing generated assets."
