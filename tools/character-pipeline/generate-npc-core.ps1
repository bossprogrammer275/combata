[CmdletBinding()]
param(
    [string]$Id = "npc_core_001",
    [string]$DisplayName = "Open World NPC Core 001",
    [ValidateRange(18, 70)][int]$Age = 24,
    [ValidateSet("male", "female")][string]$Gender = "male",
    [ValidateRange(0.0, 1.0)][double]$Weight = 0.56,
    [ValidateRange(0.0, 1.0)][double]$Muscle = 0.62,
    [ValidateRange(0.0, 1.0)][double]$Height = 0.62,
    [ValidateSet("30", "24", "25", "48", "50", "60")][string]$Fps = "30",
    [switch]$BuildOnly,
    [switch]$Resume,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Generate the first new gameplay NPC rig and Mixamo animation library."
    Write-Host "Default: npc_core_001, age 24, African male, 30 FPS."
    Write-Host "Run from the repository root:"
    Write-Host "  .\tools\character-pipeline\generate-npc-core.ps1"
    Write-Host "Build the MakeHuman source only:"
    Write-Host "  .\tools\character-pipeline\generate-npc-core.ps1 -BuildOnly"
    Write-Host "Resume the Mixamo stage from the saved MakeHuman project:"
    Write-Host "  .\tools\character-pipeline\generate-npc-core.ps1 -Resume"
    Write-Host "Choose a different appearance:"
    Write-Host "  .\tools\character-pipeline\generate-npc-core.ps1 -Gender female -Age 26"
    exit 0
}

if ($BuildOnly -and $Resume) {
    throw "Use either -BuildOnly or -Resume, not both."
}
if ($Id -notmatch "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$") {
    throw "Id must contain only letters, numbers, underscores or hyphens."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pipeline = Join-Path $PSScriptRoot "run-civilian.ps1"
$makeHumanDir = Join-Path $root "tools\makehuman-core"
$mixamoDir = Join-Path $root "tools\mixamo-mcp"
$makeHumanPython = Join-Path $makeHumanDir ".venv\Scripts\python.exe"
$mixamoPython = Join-Path $mixamoDir ".venv\Scripts\python.exe"
$outputRelative = "data/models/npc/$Id"
$outputPath = Join-Path $root ($outputRelative.Replace("/", "\"))
$projectPath = Join-Path $outputPath "$Id.mhm"

if (!(Test-Path $pipeline)) {
    throw "Existing character pipeline is missing: $pipeline"
}
if (!(Test-Path $makeHumanDir)) {
    throw "MakeHuman submodule is missing. From the repository root run: git submodule update --init tools/makehuman-core"
}
if (!(Test-Path $mixamoDir)) {
    throw "Mixamo MCP submodule is missing. From the repository root run: git submodule update --init tools/mixamo-mcp"
}
if (!(Test-Path $makeHumanPython)) {
    throw "MakeHuman venv not found: $makeHumanPython. Use the existing character-pipeline setup on this PC."
}
if (!(Test-Path $mixamoPython)) {
    throw "Mixamo MCP venv not found: $mixamoPython. Use the existing character-pipeline setup on this PC."
}

if ($Resume) {
    if (!(Test-Path $projectPath)) {
        throw "Cannot resume: saved MakeHuman project not found at $projectPath. Run without -Resume first."
    }
} elseif ((Test-Path $outputPath) -and (Get-ChildItem -LiteralPath $outputPath -Force | Select-Object -First 1)) {
    throw "Output already exists: $outputPath. Use -Resume to continue an existing character; this script will not overwrite it."
}

# This is one shared base rig for gameplay testing. Behaviour profiles are switched
# in-game later; they are not separate story characters or separate skeletons.
$AnimationKeys = @(
    "idle", "walk", "run", "sprint",
    "crouch_idle", "crouch_walk", "crouch_run",
    "aim_idle", "aim_walk", "aim_shoot",
    "crouch_aim", "crouch_walk_aim", "crouch_run_aim",
    "weapon_draw", "weapon_holster", "reload_rifle", "reload_pistol",
    "jump_up", "jump_down", "land",
    "climb_mount", "climb_up", "climb_down", "climb_top_out",
    "vault_low", "vault_medium", "mantle_high",
    "sit_down", "sit_idle", "stand_up",
    "talk", "wave", "phone", "look_around", "work_idle",
    "punch", "kick", "block", "dodge",
    "hit_reaction", "fear_reaction", "flee_run", "fall_death", "get_up",
    "enter_vehicle", "exit_vehicle", "vehicle_idle"
) -join ","

Write-Host ""
Write-Host "=== OPEN WORLD | NPC CORE GENERATION ===" -ForegroundColor Cyan
Write-Host "Character: $DisplayName ($Id)" -ForegroundColor White
Write-Host "Appearance: $Gender | age $Age | weight $Weight | muscle $Muscle | height macro $Height" -ForegroundColor Gray
Write-Host "Animation requests: $($AnimationKeys.Split(',').Count)" -ForegroundColor Gray
Write-Host "Output: $outputPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Animation search, ranking, selection and FBX downloads are autonomous." -ForegroundColor Green
Write-Host "Only the initial Mixamo auto-rig marker placement remains interactive." -ForegroundColor Yellow
Write-Host "Missing or unsuitable clips are recorded in the manifest for later review." -ForegroundColor Yellow
Write-Host "npc_core_001 is the sole active humanoid model; generation writes only to its folder." -ForegroundColor Green
Write-Host ""

# Use a hashtable for named PowerShell parameters. Array splatting here can
# shift values when strings contain spaces (for example, the display name),
# causing Age to receive the literal "-DisplayName" token.
$runnerParams = @{
    Id = $Id
    DisplayName = $DisplayName
    Age = $Age
    Gender = $Gender
    Weight = $Weight
    Muscle = $Muscle
    Height = $Height
    Skin = "african,dark,brown,black,deep"
    Hair = "short,fade,buzz,afro"
    Top = "t shirt,tshirt,tee,polo,hoodie,casual shirt,shirt"
    Bottom = "jeans,trousers,pants,denim"
    Shoes = "sneaker,trainers,shoes,footwear"
    Animations = $AnimationKeys
    Fps = [int]$Fps
    Output = $outputRelative
    AutoAnimations = $true
    NoCommit = $true
    NoPush = $true
}

if ($BuildOnly) { $runnerParams.BuildOnly = $true }
if ($Resume) { $runnerParams.AnimateOnly = $true }

& $pipeline @runnerParams
if ($LASTEXITCODE -ne 0) {
    throw "NPC generation pipeline failed with exit code $LASTEXITCODE. Inspect $outputPath\manifest.json and the Mixamo diagnostics before resuming."
}

$manifestPath = Join-Path $outputPath "manifest.json"
if (Test-Path $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $clipNames = @()
    if ($manifest.animations) {
        $clipNames = @($manifest.animations.PSObject.Properties.Name | Where-Object { $_ -ne "riggedModel" })
    }
    Write-Host ""
    Write-Host "NPC CORE RESULT" -ForegroundColor Green
    Write-Host "Rig: $($manifest.riggedModel)"
    Write-Host "Verified clips in manifest: $($clipNames.Count)"
    Write-Host ($clipNames -join ", ")
    Write-Host "Review the manifest before connecting clips to the runtime profile system."
}
Write-Host ""
Write-Host "Generation files were left uncommitted and unpushed for review." -ForegroundColor Cyan
