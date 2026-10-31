#!/usr/bin/env python3
"""Generate civilian_001 using the local headless MakeHuman core."""
from __future__ import annotations
import argparse
import json
import re
import sys
import zipfile
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

def gender_candidates(paths: list[str], gender: str) -> list[str]:
    """Prefer matching gender-specific assets and never cross-select the opposite gender."""
    opposite = "female" if gender == "male" else "male"
    matching = []
    neutral = []
    for raw in paths:
        tokens = set(norm(Path(raw).as_posix()).split())
        if opposite in tokens:
            continue
        if gender in tokens:
            matching.append(raw)
        else:
            neutral.append(raw)
    # Keep gender-matched assets AND universal assets such as shoes.
    return matching + neutral

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
    parser.add_argument("--export-existing", action="store_true",
                        help="Export the saved .mhm project as a Y-up OBJ bundle without rebuilding the character.")
    return parser.parse_args()

def terms(value: str) -> list[str]:
    return [item.strip().lower() for item in value.split(",") if item.strip()]

def export_mixamo_obj(human) -> tuple[Path, Path]:
    """Export a Y-up OBJ and package its MTL/textures for Mixamo Auto-Rigger."""
    OUT.mkdir(parents=True, exist_ok=True)
    obj_path = OUT / "civilian_001_source.obj"
    mtl_path = OUT / "civilian_001_source.mtl"
    bundle_path = OUT / "civilian_001_mixamo_source.zip"

    # The MakeHuman OBJ exporter preserves its native Y-up coordinates.
    # Its unrigged FBX path declares Z-up but does not rotate the raw mesh,
    # which made the uploaded character appear laid on its side in Mixamo.
    exported = human.export(str(obj_path), format="obj", rig="none", feet_on_ground=True)

    required = [Path(exported), mtl_path]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("MakeHuman OBJ export did not create required files: " + ", ".join(missing))

    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(obj_path, obj_path.name)
        archive.write(mtl_path, mtl_path.name)
        texture_dir = OUT / "textures"
        if texture_dir.exists():
            for texture in sorted(texture_dir.rglob("*")):
                if texture.is_file():
                    archive.write(texture, texture.relative_to(OUT))

    print(f"[MakeHuman] Mixamo OBJ: {obj_path}")
    print(f"[MakeHuman] Mixamo source package: {bundle_path}")
    return obj_path, bundle_path


def main() -> int:
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
    if args.export_existing:
        native_path = OUT / "civilian_001.mhm"
    saved = human.save_mhm(str(native_path))
    obj_path, mixamo_bundle = export_mixamo_obj(human)

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
        "skeleton": "Unrigged MakeHuman mesh; submitted to Mixamo Auto-Rigger",
        "sourceModel": str(obj_path.resolve().relative_to(ROOT)).replace("\\", "/"),
        "mixamoSourceModel": str(obj_path.resolve().relative_to(ROOT)).replace("\\", "/"),
        "mixamoSourceBundle": str(mixamo_bundle.resolve().relative_to(ROOT)).replace("\\", "/"),
        "mixamoSourceFormat": "OBJ, native MakeHuman Y-up coordinates",
        "nativeProject": str(Path(saved).resolve().relative_to(ROOT)).replace("\\", "/"),
        "selectedAssets": selected,
        "availableAssetCounts": {key: len(value) for key, value in available.items()},
        "availableClothing": [str(Path(p)) for p in clothes],
        "wardrobeNote": "The installed MakeHuman asset pack supplies complete casual-suit proxies, not separate T-shirt and jeans pieces.",
        "copiedTextures": copied_textures,
        "animations": {},
        "status": "character-generated-awaiting-mixamo"
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[MakeHuman] Vertices: {human.vertex_count:,}")
    print(f"[MakeHuman] Exported OBJ: {obj_path}")
    print(f"[MakeHuman] Mixamo package: {mixamo_bundle}")
    print(f"[MakeHuman] Manifest: {OUT / 'manifest.json'}")
    print("[MakeHuman] CHARACTER GENERATION COMPLETE")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
