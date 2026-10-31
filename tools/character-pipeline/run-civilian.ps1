param(
    [string]$Id = "civilian_001",
    [string]$DisplayName = "Ilorin Civilian 001",
    [double]$Age = 21,
    [ValidateSet("male", "female")][string]$Gender = "male",
    [double]$Weight = 0.54,
    [double]$Muscle = 0.62,
    [double]$Height = 0.60,
    [string]$Skin = "african,dark,brown,black,deep",
    [string]$Hair = "short,fade,buzz,afro",
    [string]$Top = "t shirt,tshirt,tee,polo,hoodie,casual shirt,shirt",
    [string]$Bottom = "jeans,trousers,pants,denim",
    [string]$Shoes = "sneaker,trainers,shoes,footwear",
    [string]$Animations = "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up",
    [ValidateSet(24, 25, 30, 48, 50, 60)][int]$Fps = 30,
    [string]$Output = "data/models/npc/civilian_001",
    [switch]$Help,
    [switch]$BuildOnly,
    [switch]$AnimateOnly,
    [switch]$NoCommit,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Open World civilian generator"
    Write-Host ""
    Write-Host '.\tools\character-pipeline\generate-civilian.bat -Age 21 -Skin "african,dark,brown" -Hair "short,fade" -Top "t shirt,polo" -Bottom "jeans" -Shoes "sneakers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,hit_reaction,fall_death,get_up" -Fps 30'
    Write-Host ""
    Write-Host "Options: -Id -DisplayName -Age -Gender -Weight -Muscle -Height -Skin -Hair -Top -Bottom -Shoes -Animations -Fps -Output -BuildOnly -AnimateOnly -NoCommit -NoPush"
    Write-Host "Animation keys: idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up"
    exit 0
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$makeHumanPython = Join-Path $root "tools\makehuman-core\.venv\Scripts\python.exe"
$mixamoPython = Join-Path $root "tools\mixamo-mcp\.venv\Scripts\python.exe"
$buildScript = Join-Path $PSScriptRoot "build_civilian.py"
$mixamoScript = Join-Path $PSScriptRoot "animate_civilian.py"
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $root $Output))
if ($BuildOnly -and $AnimateOnly) {
    throw "Choose either -BuildOnly or -AnimateOnly, not both."
}

if (-not $outputPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output must stay inside the combata repository."
}
$bundlePath = Join-Path $outputPath "civilian_001_bundle.zip"
if (Test-Path $bundlePath) {
    Remove-Item $bundlePath -Force
}
if (!(Test-Path $makeHumanPython)) {
    throw "MakeHuman Python environment not found: $makeHumanPython"
}
if (!(Test-Path $mixamoPython)) {
    throw "Mixamo Python environment not found: $mixamoPython"
}

Write-Host ""
Write-Host "=== OPEN WORLD: CIVILIAN GENERATION ===" -ForegroundColor Cyan
Write-Host "Age: $Age | Gender: $Gender | FPS: $Fps" -ForegroundColor Gray
Write-Host "Body: weight=$Weight muscle=$Muscle height=$Height" -ForegroundColor Gray
Write-Host "Skin: $Skin | Hair: $Hair" -ForegroundColor Gray
Write-Host "Top: $Top | Bottom: $Bottom | Shoes: $Shoes" -ForegroundColor Gray
Write-Host "Animations: $Animations" -ForegroundColor Gray
Write-Host ""

$buildArgs = @(
    $buildScript, "--id", $Id, "--display-name", $DisplayName,
    "--age", "$Age", "--gender", "$Gender",
    "--weight", "$Weight", "--muscle", "$Muscle", "--height", "$Height",
    "--skin", "$Skin", "--hair", "$Hair", "--top", "$Top",
    "--bottom", "$Bottom", "--shoes", "$Shoes", "--output", $Output
)
$animationArgs = @($mixamoScript, "--animations", $Animations, "--fps", "$Fps", "--output", $Output)
$mixamoExitCode = 0

if (-not $AnimateOnly) {
    Write-Host "[1/2] Generating civilian with MakeHuman..." -ForegroundColor Cyan
    & $makeHumanPython @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "MakeHuman generation failed with exit code $LASTEXITCODE."
    }
} else {
    $existingSource = Join-Path $outputPath "civilian_001_source.fbx"
    if (!(Test-Path $existingSource)) {
        throw "Animate-only mode needs an existing source FBX at $existingSource."
    }
}

if (-not $BuildOnly) {
    Write-Host ""
    Write-Host "[2/2] Rigging civilian and downloading selected animation FBXs..." -ForegroundColor Cyan
    Write-Host "The saved local Mixamo profile will be used. Complete any Adobe prompt in the opened browser." -ForegroundColor Yellow
    & $mixamoPython @animationArgs
    $mixamoExitCode = $LASTEXITCODE

    if ($mixamoExitCode -ne 0) {
        Write-Warning "Mixamo finished with exit code $mixamoExitCode. Keeping and packaging the MakeHuman model plus any animation files already downloaded."
    }
} else {
    Write-Host "Build-only mode: skipping Mixamo animation downloads." -ForegroundColor Yellow
}

$bundlePath = Join-Path $outputPath "civilian_001_bundle.zip"
if (!(Test-Path $bundlePath)) {
    if (Test-Path $outputPath) {
        Compress-Archive -Path (Join-Path $outputPath "*") -DestinationPath $bundlePath -Force
        Write-Host "Created partial asset bundle: $bundlePath" -ForegroundColor Yellow
    }
}

if (-not $NoCommit) {
    $branch = (& git -C $root branch --show-current).Trim()
    if (-not $branch) { throw "Could not determine the current Git branch." }

    $alreadyStaged = @(& git -C $root diff --cached --name-only)
    if ($alreadyStaged.Count -gt 0) {
        throw "The Git index already contains staged changes. Commit or unstage them before auto-commit."
    }

    $relativeOutput = $Output.Replace("\", "/").TrimStart("/")
    & git -C $root add -- $relativeOutput
    if ($LASTEXITCODE -ne 0) { throw "Git could not stage generated assets." }

    $stagedAfterAdd = @(& git -C $root diff --cached --name-only)
    $unexpected = @($stagedAfterAdd | Where-Object { -not $_.StartsWith($relativeOutput, [System.StringComparison]::OrdinalIgnoreCase) })
    if ($unexpected.Count -gt 0) {
        throw "Unexpected staged paths detected: $($unexpected -join ', '). Nothing was committed."
    }

    & git -C $root diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        & git -C $root commit -m "assets: generate civilian character and animation set"
        if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
        Write-Host "Generated assets committed." -ForegroundColor Green

        if (-not $NoPush) {
            & git -C $root push origin $branch
            if ($LASTEXITCODE -ne 0) {
                throw "Commit succeeded, but push failed. Run git push origin $branch after resolving the error."
            }
            Write-Host "Generated assets pushed to origin/$branch." -ForegroundColor Green
        }
    } else {
        Write-Host "No generated asset changes to commit." -ForegroundColor Yellow
    }
} else {
    Write-Host "Auto-commit disabled by -NoCommit." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "GENERATION PIPELINE FINISHED." -ForegroundColor Green
Write-Host "Output: $outputPath" -ForegroundColor Green
Write-Host "Manifest: $(Join-Path $outputPath 'manifest.json')" -ForegroundColor Green
Write-Host "Bundle: $(Join-Path $outputPath 'civilian_001_bundle.zip')" -ForegroundColor Green
$generatedCommit = (& git -C $root rev-parse HEAD).Trim()
Write-Host "Generated asset commit: $generatedCommit" -ForegroundColor Cyan
if ($mixamoExitCode -ne 0) {
    Write-Warning "The MakeHuman source and partial bundle were saved. Check manifest.json for Mixamo failures before rerunning the animation stage."
}
