#!/usr/bin/env python3
"""Import user-supplied Grouch v2 assets locally; never access the network."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import wave
import zlib

SOURCE_REPOSITORY = "https://github.com/charlierobin/oscar-the-grouch-version-2"
REFERENCE_COMMIT = "0d588d7f37fd7a58a2bd972d9ad2c68f97036858"
FRAME_NAMES = [f"{index:02d}.png" for index in range(33)]
AUDIO_PAIRS = {
    "i-love-trash.wav": (
        "i love trash [vocals].mp3", "i love trash [music].mp3"),
    "because-trash.wav": (
        "i love it because it's trash [vocals].mp3",
        "i love it because it's trash [music].mp3"),
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_png(path):
    """Check PNG structure, chunk CRCs, expected dimensions and RGBA pixels."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG file: {path}")
    position = 8
    chunks = []
    compressed_pixels = bytearray()
    while position + 12 <= len(data):
        length = struct.unpack_from(">I", data, position)[0]
        end = position + 12 + length
        if end > len(data):
            raise ValueError(f"Truncated PNG chunk: {path}")
        kind = data[position + 4:position + 8]
        payload = data[position + 8:position + 8 + length]
        expected_crc = struct.unpack_from(">I", data, position + 8 + length)[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"PNG CRC mismatch: {path}")
        if not chunks:
            if kind != b"IHDR" or length != 13:
                raise ValueError(f"Invalid PNG header: {path}")
            header = struct.unpack(">IIBBBBB", payload)
            if header != (256, 260, 8, 6, 0, 0, 0):
                raise ValueError(f"Expected 256x260, 8-bit RGBA PNG: {path}")
        if kind == b"IDAT":
            compressed_pixels.extend(payload)
        chunks.append(kind)
        position = end
        if kind == b"IEND":
            if length != 0 or position != len(data):
                raise ValueError(f"Invalid PNG ending: {path}")
            break
    if not chunks or chunks[-1] != b"IEND" or not compressed_pixels:
        raise ValueError(f"Incomplete PNG: {path}")
    # Decode at most the expected scanline bytes plus one, avoiding an
    # unbounded decompression of an invalid locally supplied file.
    expected_length = (256 * 4 + 1) * 260
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(compressed_pixels, expected_length + 1)
    if len(pixels) != expected_length or not decoder.eof or decoder.unused_data:
        raise ValueError(f"Invalid PNG pixel data: {path}")
    if any(pixels[row * 1025] > 4 for row in range(260)):
        raise ValueError(f"Invalid PNG scanline filter: {path}")


def mix_audio(ffmpeg, source, target, vocals, music):
    subprocess.run([
        ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source / "audio" / vocals),
        "-i", str(source / "audio" / music),
        "-filter_complex",
        "[0:a]volume=0.5[v];[1:a]volume=0.1[m];"
        "[v][m]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[out]",
        "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
        str(target),
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    with wave.open(str(target), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (2, 2, 44100):
            raise ValueError(f"Unexpected output audio format: {target.name}")
        if audio.getnframes() == 0:
            raise ValueError(f"Empty output audio: {target.name}")


def import_assets(source, output):
    if not source.is_dir():
        raise ValueError(f"Source directory does not exist: {source}")
    if output == source or source in output.parents:
        raise ValueError("Output must be outside the supplied source tree")
    actual_names = {path.name for path in (source / "frames").glob("*.png")}
    if actual_names != set(FRAME_NAMES):
        raise ValueError("Expected frames/00.png through frames/32.png, exactly 33 PNGs")
    for name in FRAME_NAMES:
        validate_png(source / "frames" / name)
    for pair in AUDIO_PAIRS.values():
        for name in pair:
            if not (source / "audio" / name).is_file():
                raise ValueError(f"Missing original audio stem: audio/{name}")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("FFmpeg is required to mix the local MP3 stems")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".grouch-import-", dir=output.parent) as temporary:
        stage = Path(temporary)
        (stage / "frames").mkdir()
        (stage / "audio").mkdir()
        source_hashes = {}
        for name in FRAME_NAMES:
            original = source / "frames" / name
            copied = stage / "frames" / name
            shutil.copyfile(original, copied)
            digest = sha256(original)
            if sha256(copied) != digest:
                raise ValueError(f"Frame copy verification failed: {name}")
            source_hashes[f"frames/{name}"] = digest
        for name, (vocals, music) in AUDIO_PAIRS.items():
            mix_audio(ffmpeg, source, stage / "audio" / name, vocals, music)
            for stem in (vocals, music):
                source_hashes[f"audio/{stem}"] = sha256(source / "audio" / stem)
        metadata = {
            "source_repository": SOURCE_REPOSITORY,
            "reference_commit": REFERENCE_COMMIT,
            "source_supplied_locally": True,
            "reference_commit_verified": False,
            "frames": {"count": 33, "width": 256, "height": 260,
                       "format": "8-bit RGBA PNG", "modified": False,
                       "frame_interval_ms": 80},
            "audio": {"mix": "vocals 0.5 + music 0.1; no normalization",
                      "sample_rate": 44100, "channels": 2, "encoding": "PCM16"},
            "source_sha256": dict(sorted(source_hashes.items())),
            "imported_sha256": {
                path.relative_to(stage).as_posix(): sha256(path)
                for path in sorted(stage.rglob("*")) if path.is_file()
            },
        }
        (stage / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                destination = output / path.relative_to(stage)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
    print(f"Imported 33 unchanged PNG frames and 2 mixed WAV files into {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Local v2 directory containing frames/ and audio/")
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "assets",
                        help="Local asset directory (default: repository assets/)")
    arguments = parser.parse_args()
    try:
        import_assets(arguments.source.resolve(), arguments.output_dir.resolve())
    except (OSError, ValueError, zlib.error) as error:
        parser.exit(1, f"Asset import failed: {error}\n")
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"FFmpeg failed: {error.stderr.strip()}\n")


if __name__ == "__main__":
    main()
