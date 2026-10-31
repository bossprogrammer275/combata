# Civilian 001 local generation pipeline

Run this from the combata repository root:

    .\tools\character-pipeline\generate-civilian.bat -Age 21 -Gender male -Weight 0.54 -Muscle 0.62 -Height 0.60 -Skin "african,dark,brown,black" -Hair "short,fade,buzz" -Top "t shirt,polo,tee" -Bottom "jeans,denim" -Shoes "sneakers,trainers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up" -Fps 30

Print usage:

    .\tools\character-pipeline\generate-civilian.bat -Help

Generate only the MakeHuman model:

    .\tools\character-pipeline\generate-civilian.bat -BuildOnly

Rerun only the Mixamo animation stage against an existing MakeHuman FBX:

    .\tools\character-pipeline\generate-civilian.bat -AnimateOnly

Body values use MakeHuman's 0.0–1.0 range. Skin, hair and clothing options are comma-separated search terms matched against locally installed MakeHuman assets.

Animation keys:
- idle
- walk
- run
- sprint
- jump
- crouch_idle
- crouch_walk
- talk
- phone
- sit_idle
- hit_reaction
- fall_death
- get_up
- look_around
- work_idle
- wave
- sit_down
- stand_up
- fear_reaction
- flee_run

Aliases:
- crouch = crouch_idle + crouch_walk
- sit = sit_idle
- death or fall = fall_death
- getup = get_up

The default run builds an unrigged character mesh (so Mixamo Auto-Rigger can create the skeleton), uploads it through the saved local Mixamo browser profile, submits Mixamo's automatically positioned landmark markers, downloads the selected animation FBXs, writes manifest.json and civilian_001_bundle.zip, then commits and pushes only the generated output directory. Gender-specific skins/outfits are filtered to the selected gender; universal assets such as shoes remain eligible.

The installed MakeHuman data pack currently contains complete casual-suit outfits rather than separate T-shirts and jeans, so the generator chooses a matching casual outfit proxy plus a separate shoe proxy. The manifest records this limitation.

Use -NoCommit to keep generated results local, or -NoPush to commit without pushing. The script refuses auto-commit if the Git index already contains staged changes. Use -Output to change the output directory while keeping it inside the repository.

Output: data/models/npc/civilian_001/

The Adobe profile remains local in tools/mixamo-mcp/browser_profile/ and is never committed. Do not run main.py or mcp_server.py alongside this generator because they share the browser profile.

If Mixamo's default landmark placement is rejected, the automation saves mixamo_marker_debug.html and mixamo_marker_debug.png in the character output folder and exits with a non-zero code. Failed or missing animation downloads are listed in manifest.json. The existing NPC/player runtime is not changed by this asset-generation pipeline.
