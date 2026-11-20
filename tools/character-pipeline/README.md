# npc_core_001 character pipeline

`npc_core_001` is the only active humanoid model for Open World. The former `civilian_001`, `civilian_002` and `npc1` model folders have been removed. Do not use the old civilian-generation workflow to create another model folder.

## Generate or resume the active character

From the repository root:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1
```

Build only the MakeHuman source:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1 -BuildOnly
```

Resume Mixamo rigging/animation search using the saved `npc_core_001.mhm`:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1 -Resume
```

The launcher writes only into `data/models/npc/npc_core_001/` and uses `-NoCommit -NoPush`. Inspect the generated FBX files and manifest before committing any newly generated assets.

## Current runtime inventory

The current approved runtime inventory is the 28 FBXs listed in:

`data/models/npc/npc_core_001/manifest.json`

That file is the source of truth for stable animation keys, file names, measured first-pass motion data, experimental actions and missing clips. Do not use the launcher's historical search wishlist as proof that an animation exists. A skipped or unavailable Mixamo search result is missing, not a placeholder.

## Local dependencies

The existing local pipeline submodules and virtual environments are required:

- `tools/makehuman-core`
- `tools/mixamo-mcp`
- `tools/makehuman-core/.venv/Scripts/python.exe`
- `tools/mixamo-mcp/.venv/Scripts/python.exe`

Do not rebuild or replace these environments unnecessarily. The PowerShell launcher reports the exact missing path if a dependency is unavailable.

## Implementation notes

The underlying Python helpers retain historical filenames (`build_civilian.py` and `animate_civilian.py`) but accept an explicit character ID and output directory. The active launcher passes `npc_core_001`; their defaults now point to that same ID. `generate-civilian.bat` is deprecated and only redirects to the NPC-core launcher.

MakeHuman supplies the editable source project, OBJ/MTL and textures. Mixamo supplies the common humanoid rig and downloaded FBX actions. The game's runtime validates the base candidate and caches the shared rig and animation clips.
