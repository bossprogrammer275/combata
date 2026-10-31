# Civilian 001 local generation pipeline

Run this from the game repository root:

    powershell -ExecutionPolicy Bypass -File .\tools\character-pipeline\run-civilian.ps1

The pipeline generates a young adult Nigerian male civilian through MakeHuman, uploads the exported FBX using the existing local Mixamo browser profile, downloads a rigged base model and animation FBXs, and writes a manifest and ZIP bundle.

Output location: data/models/npc/civilian_001/

The Adobe browser profile stays local in tools/mixamo-mcp/browser_profile/ and is never copied into the output. Do not run main.py and mcp_server.py alongside this script because they share the same profile.

If Mixamo requires manual marker placement, the current automation stops and reports that limitation rather than claiming success. Animation search names can vary; missing clips are listed in manifest.json. Existing player and NPC runtime code is not changed by this asset-generation step.
