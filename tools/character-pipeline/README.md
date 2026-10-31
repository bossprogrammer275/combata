# MakeHuman + Mixamo NPC asset pipeline

The production civilian currently used by STRIKE COMMAND is \`civilian_002\`. Do not regenerate or overwrite it during ordinary NPC development.

Generate the next character into a new folder by default:

\`\`\`powershell
.\tools\character-pipeline\generate-civilian.bat -Age 21 -Gender male -Weight 0.54 -Muscle 0.62 -Height 0.60 -Skin "african,dark,brown,black" -Hair "short,fade,buzz" -Top "t shirt,polo,tee" -Bottom "jeans,denim" -Shoes "sneakers,trainers" -Animations "idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,wave,fall_death,get_up" -Fps 30
\`\`\`

The default output ID is \`civilian_003\`; use \`-Id\` and \`-Output\` to choose another unused ID. Never pass \`-Overwrite\` for the active production character unless its replacement has been separately reviewed and approved.

Generate only the MakeHuman source with \`-BuildOnly\`. Resume the Mixamo stage from an existing saved project with \`-AnimateOnly\`. Use \`-NoCommit\` to keep local results uncommitted or \`-NoPush\` to commit without pushing.

MakeHuman produces the native project and the Y-up OBJ/MTL/texture bundle for Mixamo. Mixamo creates the common humanoid rig and the approved FBX animation clips. The browser profile remains local under \`tools/mixamo-mcp/\` and must never be committed.

Only register clips that were successfully downloaded, inspected on the same skeleton and recorded in the character manifest. Download walk, run, sprint and crouch-walk in-place. The game owns the NPC's world motion and collision.

The installed MakeHuman asset pack contains complete outfit proxies rather than separate T-shirts and jeans; the selected clothing is recorded in the generated manifest. Check every source asset's licence before shipping.
