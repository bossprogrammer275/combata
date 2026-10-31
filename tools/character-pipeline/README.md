# Civilian 001 local generation pipeline

Run this from the combata repository root:

    .\tools\character-pipeline\generate-civilian.bat -Age 21 -Gender male -Weight 0.54 -Muscle 0.62 -Height 0.60 -Skin "african,dark,brown,black" -Hair "short,fade,buzz" -Top "t shirt,polo,tee" -Bottom "jeans,denim" -Shoes "sneakers,trainers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up" -Fps 30

Print usage:

    .\tools\character-pipeline\generate-civilian.bat -Help

Generate only the MakeHuman model:

    .\tools\character-pipeline\generate-civilian.bat -BuildOnly

Rerun only the Mixamo stage from the saved MakeHuman project (the OBJ package is regenerated automatically):

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

The default run builds the character and exports a native Y-up OBJ with its MTL/textures as civilian_001_mixamo_source.zip. It uploads that package through the saved local Mixamo browser profile. When Mixamo asks for body landmarks, the browser stays open and the script prints an elapsed waiter. Place all eight markers and click Next in the Mixamo browser; the script detects the overlay disappearing and resumes automatically without requiring a console confirmation. It detects completion by inspecting the actual Mixamo editor DOM.

The rigged character is downloaded directly without selecting an animation, with skin attached; the pipeline no longer searches for a fake "T-pose" animation. For each requested animation, it shows Mixamo's actual result names and descriptions in the console. Enter a result number to preview it in the browser, then press Y/Enter to approve and download that exact clip, R to choose again, S to skip, or Q to stop. The script verifies each saved file is a real, non-empty FBX before reporting success and records the exact Mixamo IDs/names in manifest.json. Previous unverified clips for requested keys are removed so they cannot leak into the new bundle.

After the approved clips are downloaded, the pipeline writes manifest.json and civilian_001_bundle.zip, then commits and pushes only the generated output directory. The Y-up OBJ avoids the sideways orientation caused by the unrigged MakeHuman FBX export. Gender-specific skins/outfits are filtered to the selected gender; universal assets such as shoes remain eligible.

The installed MakeHuman data pack currently contains complete casual-suit outfits rather than separate T-shirts and jeans, so the generator chooses a matching casual outfit proxy plus a separate shoe proxy. The manifest records this limitation.

Use -NoCommit to keep generated results local, or -NoPush to commit without pushing. The script refuses auto-commit if the Git index already contains staged changes. Use -Output to change the output directory while keeping it inside the repository.

Output: data/models/npc/civilian_001/

The Adobe profile remains local in tools/mixamo-mcp/browser_profile/ and is never committed. Do not run main.py or mcp_server.py alongside this generator because they share the browser profile.

The manual marker wait saves mixamo_markers_manual_start.png and mixamo_markers_manual_done.png. After Next, the pipeline checks for Mixamo's actual character editor, preview and Download controls in the parsed DOM; it does not rely on raw HTML substring matches or an optional API status poll to recognise completion. If marker placement or rigging fails, it saves mixamo_upload_debug.html, mixamo_upload_debug.png and mixamo_upload_debug.txt in the character output folder and exits with a non-zero code. Failed or missing animation downloads are listed in manifest.json. The existing NPC/player runtime is not changed by this asset-generation pipeline.
