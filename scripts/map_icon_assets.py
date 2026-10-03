"""List map badge resources inside local Valve VPKs (no extra dependencies)."""
import argparse
import struct
from pathlib import Path


def entries(path):
    with path.open("rb") as f:
        signature, version, size = struct.unpack("<III", f.read(12))
        if signature != 0x55AA1234:
            raise ValueError("Not a VPK")
        if version not in (1, 2):
            raise ValueError(f"Unsupported VPK version: {version}")
        header = 28 if version == 2 else 12
        f.seek(header)
        tree = f.read(size)
    offset = 0
    def string():
        nonlocal offset
        end = tree.index(b"\0", offset)
        value = tree[offset:end].decode("utf-8")
        offset = end + 1
        return value
    while ext := string():
        while directory := string():
            while name := string():
                crc, preload, archive, start, length, terminator = struct.unpack_from("<IHHIIH", tree, offset)
                offset += 18
                prefix = tree[offset:offset + preload]
                offset += preload
                yield f"{directory}/{name}.{ext}", archive, start if archive != 32767 else header + size + start, length, prefix


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vpk", type=Path)
    parser.add_argument("--contains", default="cache")
    parser.add_argument("--extract-svg", type=Path, help="Extract the matching compiled SVG's DATA block")
    args = parser.parse_args()
    for resource, archive, offset, length, prefix in entries(args.vpk):
        if args.contains.lower() in resource.lower():
            print(resource, archive, length)
            if args.extract_svg:
                archive_path = args.vpk if archive == 32767 else args.vpk.with_name(args.vpk.name.replace("_dir.vpk", f"_{archive:03}.vpk"))
                with archive_path.open("rb") as f:
                    f.seek(offset)
                    data = prefix + f.read(length)
                # Resource offsets are relative to each offset field. RED2 may
                # include dependency SVGs: only export the resource DATA block.
                block_offset, block_count = struct.unpack_from("<II", data, 8)
                for block in range(block_count):
                    position = 8 + block_offset + block * 12
                    if data[position:position + 4] == b"DATA":
                        relative, block_size = struct.unpack_from("<II", data, position + 4)
                        data = data[position + 4 + relative:position + 4 + relative + block_size]
                        break
                else:
                    raise ValueError("Compiled resource has no DATA block")
                svg_start = data.find(b"<svg")
                svg_end = data.find(b"</svg>", svg_start)
                if svg_start < 0 or svg_end < 0:
                    raise ValueError("Resource does not contain an SVG; use ValveResourceFormat to decompile it")
                args.extract_svg.parent.mkdir(parents=True, exist_ok=True)
                args.extract_svg.write_bytes(data[svg_start:svg_end + 6])
                print("Extracted", args.extract_svg)
