#!/usr/bin/env python3
"""Generate civilian_001 using the local headless MakeHuman core."""
from __future__ import annotations
import argparse
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

def parse_args():
    parser = argparse.ArgumentParser(description="Generate the Open World civilian with MakeHuman.")
    parser.add_argument("--id", default="civilian_001")
    parser.add_argument("--display-name", default="Ilorin Civilian 001")
    parser.add_argument("--age", type=float, default=21)
    parser.add_argument("--gender", choices=("male", "female"), default="male")
    parser.add_argument("--weight", type=float, default=0.54)
    parser.add_argument("--muscle", type=float, default=0.62)
    parser.add_argument("--height", type=float, default=0.60)
    parser.add_argument("--skin", default="african,dark,brown,black,deep")
    parser.add_argument("--hair", default="short,fade,buzz,afro")
    parser.add_argument("--top", default="t shirt,tshirt,tee,polo,hoodie,casual shirt,shirt")
    parser.add_argument("--bottom", default="jeans,trousers,pants,denim")
    parser.add_argument("--shoes", default="sneaker,trainers,shoes,footwear")
    parser.add_argument("--output", default="data/models/npc/civilian_001")
    return parser.parse_args()

def terms(value: str) -> list[str]:
    return [item.strip().lower() for item in value.split(",") if item.strip()]

def main() -> int:
    global OUT
    args = parse_args()
    OUT = (ROOT / args.output).resolve()
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

    # MakeHuman maps age 10 to ~0.1875 and age 25 to 0.5.
    age = max(10.0, min(90.0, args.age))
    if age <= 25.0:
        age_macro = 0.1875 + (age - 10.0) * (0.5 - 0.1875) / 15.0
    else:
        age_macro = 0.5 + (age - 25.0) * 0.5 / 65.0
    human.set_gender(1.0 if args.gender == "male" else 0.0)
    human.set_age(max(0.0, min(1.0, age_macro)))
    human.set_weight(max(0.0, min(1.0, args.weight)))
    human.set_muscle(max(0.0, min(1.0, args.muscle)))
    human.set_height(max(0.0, min(1.0, args.height)))

    selected = {}
    available = {}
    for kind in ("skins", "hair", "eyes", "eyebrows", "eyelashes", "teeth", "clothes"):
        try:
            available[kind] = list(human.list_available(kind))
        except Exception as exc:
            available[kind] = []
            print(f"[MakeHuman] Warning: could not list {kind}: {exc}")

    skin_terms = terms(args.skin)
    skin = choose(available["skins"], skin_terms) if skin_terms else None
    if skin is None and available["skins"] and skin_terms:
        skin = choose(available["skins"], ["young", "adult"], ["old", "elder", "fantasy"])
    if skin:
        human.set_skin(skin)
        selected["skin"] = skin
        print(f"[MakeHuman] Skin: {Path(skin).name}")
    else:
        selected["skin"] = None
        print("[MakeHuman] WARNING: no skin materials found; using default material.")

    hair_terms = terms(args.hair)
    hair = choose(available["hair"], hair_terms, ["long", "ponytail", "female"]) if hair_terms else None
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
        "top": (terms(args.top), ["dress", "suit", "uniform", "armor", "bikini"]),
        "bottom": (terms(args.bottom), ["dress", "skirt", "shorts"]),
        "shoes": (terms(args.shoes), ["heels", "boots"]),
    }
    used = set()
    for role, (role_terms, reject) in clothing_roles.items():
        match = choose([p for p in clothes if p not in used], role_terms, reject)
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
        "id": args.id,
        "displayName": args.display_name,
        "description": f"Nigerian {args.gender} civilian, age {age:g}, everyday casual streetwear.",
        "ageTarget": age,
        "body": {"gender": args.gender, "weight": args.weight, "muscle": args.muscle, "heightMacro": args.height},
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
