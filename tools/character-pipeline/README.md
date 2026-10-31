# Civilian 001 local generation pipeline

Run this from the combata repository root:

    .\tools\character-pipeline\generate-civilian.bat -Age 21 -Gender male -Weight 0.54 -Muscle 0.62 -Height 0.60 -Skin "african,dark,brown,black" -Hair "short,fade,buzz" -Top "t shirt,polo,tee" -Bottom "jeans,denim" -Shoes "sneakers,trainers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,hit_reaction,fall_death,get_up" -Fps 30

Print usage:

    .\tools\character-pipeline\generate-civilian.bat -Help

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

Aliases:
- crouch = crouch_idle + crouch_walk
- sit = sit_idle
- death or fall = fall_death
- getup = get_up

The default run builds the character, uploads it through the saved local Mixamo browser profile, downloads the selected animation FBXs, writes manifest.json and civilian_001_bundle.zip, then commits and pushes only the generated output directory.

Use -NoCommit to keep generated results local, or -NoPush to commit without pushing. The script refuses auto-commit if the Git index already contains staged changes. Use -Output to change the output directory while keeping it inside the repository.

Output: data/models/npc/civilian_001/

The Adobe profile remains local in tools/mixamo-mcp/browser_profile/ and is never committed. Do not run main.py or mcp_server.py alongside this generator because they share the browser profile.

If Mixamo requests manual marker placement, the automation stops and reports it. Failed or missing animation downloads are listed in manifest.json. The existing NPC/player runtime is not changed by this asset-generation pipeline.
