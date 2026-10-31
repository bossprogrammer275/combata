param(
    [string]$Id = "civilian_003",
    [string]$DisplayName = "Ilorin Civilian 003",
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
    [string]$Output = "",
    [switch]$Help,
    [switch]$BuildOnly,
    [switch]$AnimateOnly,
    [switch]$NoCommit,
    [switch]$NoPush,
    [switch]$Overwrite
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Open World civilian generator"
    Write-Host ""
    Write-Host '.\tools\character-pipeline\generate-civilian.bat -Age 21 -Skin "african,dark,brown" -Hair "short,fade" -Top "t shirt,polo" -Bottom "jeans" -Shoes "sneakers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,hit_reaction,fall_death,get_up" -Fps 30'
    Write-Host ""
    Write-Host "Options: -Id -DisplayName -Age -Gender -Weight -Muscle -Height -Skin -Hair -Top -Bottom -Shoes -Animations -Fps -Output -BuildOnly -AnimateOnly -NoCommit -NoPush -Overwrite"
    Write-Host "Animation keys: idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up"
    exit 0
}

if ($Id -notmatch "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$") {
    throw "Id must contain only letters, numbers, underscores or hyphens."
}
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = "data/models/npc/$Id"
}
$bundleName = "${Id}_bundle.zip"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$makeHumanPython = Join-Path $root "tools\makehuman-core\.venv\Scripts\python.exe"
$mixamoPython = Join-Path $root "tools\mixamo-mcp\.venv\Scripts\python.exe"
$buildScript = Join-Path $PSScriptRoot "build_civilian.py"
$mixamoScript = Join-Path $PSScriptRoot "animate_civilian.py"
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $root $Output))
if ($BuildOnly -and $AnimateOnly) {
    throw "Choose either -BuildOnly or -AnimateOnly, not both."
}

$rootPrefix = $root.TrimEnd('\') + '\'
if (-not ($outputPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or $outputPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Output must stay inside the combata repository."
}
if (-not $AnimateOnly -and (Test-Path $outputPath) -and -not $Overwrite) {
    $existingItems = @(Get-ChildItem -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue)
    if ($existingItems.Count -gt 0) {
        throw "Output folder already contains files: $outputPath. Use a new -Id, -AnimateOnly to resume, or -Overwrite to intentionally rebuild this character."
    }
}
$bundlePath = Join-Path $outputPath $bundleName
if (Test-Path $bundlePath) {
    Write-Host "Existing bundle will be preserved unless you explicitly approve a replacement." -ForegroundColor Yellow
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
$animationArgs = @($mixamoScript, "--id", $Id, "--animations", $Animations, "--fps", "$Fps", "--output", $Output)
$mixamoExitCode = 0

if (-not $AnimateOnly) {
    Write-Host "[1/2] Generating civilian with MakeHuman..." -ForegroundColor Cyan
    & $makeHumanPython @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "MakeHuman generation failed with exit code $LASTEXITCODE."
    }
} else {
    $existingProject = Join-Path $outputPath "${Id}.mhm"
    if (!(Test-Path $existingProject)) {
        throw "Animate-only mode needs the saved MakeHuman project at $existingProject."
    }
    Write-Host "[1/2] Preparing a correctly oriented Y-up OBJ for Mixamo from the saved project..." -ForegroundColor Cyan
    & $makeHumanPython $buildScript --export-existing --id $Id --output $Output
    if ($LASTEXITCODE -ne 0) {
        throw "Mixamo OBJ preparation failed with exit code $LASTEXITCODE."
    }
}

if (-not $BuildOnly) {
    Write-Host ""
    Write-Host "[2/2] Rigging civilian and downloading selected animation FBXs..." -ForegroundColor Cyan
    Write-Host "The saved Mixamo profile will open. Place all 8 rigging markers and click Next in the browser." -ForegroundColor Yellow
    Write-Host "Place all 8 markers and click Next yourself; then confirm Y in this console." -ForegroundColor Yellow
    Write-Host "Confirm Y again before accepting a rig or downloading the base model." -ForegroundColor Yellow
    Write-Host "Choose each animation in this console; press D to approve its FBX download." -ForegroundColor Yellow
    Write-Host "No response listener or automatic marker / Next click is used." -ForegroundColor Yellow
    & $mixamoPython @animationArgs
    $mixamoExitCode = $LASTEXITCODE

    if ($mixamoExitCode -ne 0) {
        Write-Warning "Mixamo finished with exit code $mixamoExitCode. Keeping and packaging the MakeHuman model plus any animation files already downloaded."
    }
} else {
    Write-Host "Build-only mode: skipping Mixamo animation downloads." -ForegroundColor Yellow
}

$bundlePath = Join-Path $outputPath $bundleName
if ($mixamoExitCode -ne 0) {
    Write-Host "Mixamo did not complete. No partial ZIP will be created automatically; any existing bundle is preserved." -ForegroundColor Yellow
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
        if ($mixamoExitCode -ne 0) {
            $commitMessage = "assets: $Id character generation partial (Mixamo failed)"
        } elseif ($BuildOnly) {
            $commitMessage = "assets: build $Id character source"
        } else {
            $commitMessage = "assets: generate $Id character and animation set"
        }
        & git -C $root commit -m $commitMessage
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
Write-Host "Output: $outputPath"
Write-Host "Manifest: $(Join-Path $outputPath 'manifest.json')"
Write-Host "Bundle: $(Join-Path $outputPath $bundleName)"
$generatedCommit = (& git -C $root rev-parse HEAD).Trim()
Write-Host "Generated asset commit: $generatedCommit" -ForegroundColor Cyan
if ($mixamoExitCode -ne 0) {
    Write-Host "PARTIAL GENERATION: the MakeHuman mesh and partial bundle were saved, but Mixamo did not complete." -ForegroundColor Yellow
    Write-Warning "Check manifest.json and any Mixamo diagnostics before considering this character ready."
    exit 1
}
if ($BuildOnly) {
    Write-Host "CHARACTER SOURCE BUILD COMPLETE (Mixamo intentionally skipped)." -ForegroundColor Green
} else {
    Write-Host "GENERATION PIPELINE COMPLETE." -ForegroundColor Green
}
