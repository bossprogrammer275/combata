#!/usr/bin/env python3
"""Generate civilian_001 using the local headless MakeHuman core."""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "models" / "npc" / "civilian_001"

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()

def choose(paths: list[str], terms: list[str], reject: list[str] | None = None) -> str | None:
    reject = reject or []
    ranked = []
    for raw in paths:
        name = norm(Path(raw).as_posix())
        if any(term in name for term in reject):
            continue
        score = sum((len(term.split()) + 1) * 10 for term in terms if term in name)
        if score:
            ranked.append((score, raw))
    ranked.sort(key=lambda item: (-item[0], norm(Path(item[1]).name)))
    return ranked[0][1] if ranked else None

def copy_material_textures(material_path: str, texture_dir: Path) -> list[str]:
    import shutil
    source = Path(material_path)
    copied = []
    try:
        content = source.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return copied
    texture_dir.mkdir(parents=True, exist_ok=True)
    for line in content.splitlines():
        bits = line.strip().split(None, 1)
        if len(bits) != 2:
            continue
        key, value = bits
        if "texture" not in key.lower() and "map" not in key.lower():
            continue
        rel = value.strip().strip('"')
        if not rel or rel.startswith(("http://", "https://")):
            continue
        candidates = [(source.parent / rel).resolve(), (source.parent / Path(rel).name).resolve()]
        src = next((p for p in candidates if p.is_file()), None)
        if src is None:
            continue
        dst = texture_dir / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
        copied.append(str(dst.relative_to(OUT)).replace("\\", "/"))
    return sorted(set(copied))

def main() -> int:
    try:
        import mhcore
    except Exception as exc:
        print(f"ERROR: MakeHuman core import failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("Run this through tools/character-pipeline/run-civilian.ps1.", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    texture_dir = OUT / "textures"
    texture_dir.mkdir(parents=True, exist_ok=True)
    print("[MakeHuman] Creating civilian_001...")
    human = mhcore.new_human()

    # A Nigerian male young adult: the MakeHuman age macro is about 25 at 0.5.
    human.set_gender(1.0)
    human.set_age(0.42)
    human.set_weight(0.54)
    human.set_muscle(0.62)
    human.set_height(0.60)

    selected = {}
    available = {}
    for kind in ("skins", "hair", "eyes", "eyebrows", "eyelashes", "teeth", "clothes"):
        try:
            available[kind] = list(human.list_available(kind))
        except Exception as exc:
            available[kind] = []
            print(f"[MakeHuman] Warning: could not list {kind}: {exc}")

    skin = choose(available["skins"], ["african", "dark", "brown", "black", "deep"])
    if skin is None and available["skins"]:
        skin = choose(available["skins"], ["young", "adult"], ["old", "elder", "fantasy"])
    if skin:
        human.set_skin(skin)
        selected["skin"] = skin
        print(f"[MakeHuman] Skin: {Path(skin).name}")
    else:
        selected["skin"] = None
        print("[MakeHuman] WARNING: no skin materials found; using default material.")

    hair = choose(available["hair"], ["short", "fade", "buzz", "afro"], ["long", "ponytail", "female"])
    if hair:
        human.equip_hair(hair)
        selected["hair"] = hair
        print(f"[MakeHuman] Hair: {Path(hair).name}")
    else:
        selected["hair"] = None
        print("[MakeHuman] WARNING: no short-hair asset matched; default hair retained.")

    for kind, method in (("eyes", "equip_eyes"), ("eyebrows", "equip_eyebrows"),
                         ("eyelashes", "equip_eyelashes"), ("teeth", "equip_teeth")):
        if available[kind]:
            try:
                getattr(human, method)(available[kind][0])
                selected[kind] = available[kind][0]
            except Exception as exc:
                print(f"[MakeHuman] Warning: {kind} not equipped: {exc}")

    clothes = available["clothes"]
    clothing_roles = {
        "top": (["t shirt", "tshirt", "tee", "polo", "hoodie", "casual shirt", "shirt"], ["dress", "suit", "uniform", "armor", "bikini"]),
        "bottom": (["jeans", "trousers", "pants", "denim"], ["dress", "skirt", "shorts"]),
        "shoes": (["sneaker", "trainers", "shoes", "footwear"], ["heels", "boots"]),
    }
    used = set()
    for role, (terms, reject) in clothing_roles.items():
        match = choose([p for p in clothes if p not in used], terms, reject)
        if match:
            try:
                human.equip_clothes(match)
                used.add(match)
                selected[role] = match
                print(f"[MakeHuman] {role}: {Path(match).name}")
            except Exception as exc:
                print(f"[MakeHuman] Warning: {role} clothing failed: {exc}")
    if not used and clothes:
        casual = choose(clothes, ["casual", "everyday", "street", "male"], ["dress", "bikini", "armor", "fantasy"])
        fallback = casual or sorted(clothes, key=lambda p: norm(Path(p).name))[0]
        try:
            human.equip_clothes(fallback)
            used.add(fallback)
            selected["outfit"] = fallback
            print(f"[MakeHuman] Outfit fallback: {Path(fallback).name}")
        except Exception as exc:
            print(f"[MakeHuman] WARNING: no clothing could be equipped: {exc}")

    native_path = OUT / "civilian_001.mhm"
    fbx_path = OUT / "civilian_001_source.fbx"
    saved = human.save_mhm(str(native_path))
    exported = human.export(str(fbx_path), format="fbx", rig="deform", feet_on_ground=True)

    copied_textures = []
    if selected.get("skin"):
        copied_textures.extend(copy_material_textures(selected["skin"], texture_dir))

    manifest = {
        "id": "civilian_001",
        "displayName": "Ilorin Civilian 001",
        "description": "Nigerian male civilian, early twenties, everyday casual streetwear.",
        "ageTarget": 21,
        "body": {"gender": "male", "weight": 0.54, "muscle": 0.62, "heightMacro": 0.60},
        "source": "MakeHuman core",
        "skeleton": "MakeHuman deform export; Mixamo stage pending",
        "sourceModel": str(Path(exported).resolve().relative_to(ROOT)).replace("\\", "/"),
        "nativeProject": str(Path(saved).resolve().relative_to(ROOT)).replace("\\", "/"),
        "selectedAssets": selected,
        "availableAssetCounts": {key: len(value) for key, value in available.items()},
        "availableClothing": [str(Path(p)) for p in clothes],
        "copiedTextures": copied_textures,
        "animations": {},
        "status": "character-generated-awaiting-mixamo"
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[MakeHuman] Vertices: {human.vertex_count:,}")
    print(f"[MakeHuman] Exported: {exported}")
    print(f"[MakeHuman] Manifest: {OUT / 'manifest.json'}")
    print("[MakeHuman] CHARACTER GENERATION COMPLETE")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
