"""生成小程序音效（本地 WAV，不依赖网络）。

用法：python scripts/make-sounds.py
产物：assets/merge.wav、assets/win.wav、assets/over.wav
"""
from __future__ import annotations

import math
import os
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets")
SAMPLE_RATE = 16000


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in samples:
            clipped = max(-1.0, min(1.0, sample))
            frames += struct.pack("<h", int(clipped * 32767))
        handle.writeframes(bytes(frames))


def tone(frequency: float, duration: float, volume: float = 0.5) -> list[float]:
    count = int(SAMPLE_RATE * duration)
    samples = []
    for index in range(count):
        t = index / SAMPLE_RATE
        # 简单的指数衰减包络，避免爆音
        envelope = math.exp(-4.0 * t / max(duration, 1e-6))
        samples.append(math.sin(2 * math.pi * frequency * t) * volume * envelope)
    return samples


def silence(duration: float) -> list[float]:
    return [0.0] * int(SAMPLE_RATE * duration)


def concat(parts: list[list[float]]) -> list[float]:
    result: list[float] = []
    for part in parts:
        result.extend(part)
    return result


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    merge = concat([tone(880, 0.07, 0.5), tone(1320, 0.06, 0.3)])
    win = concat(
        [tone(f, 0.16, 0.45) + [0.0] * int(SAMPLE_RATE * 0.02) for f in (523, 659, 784, 1047)]  # type: ignore
    )
    over = concat(
        [tone(f, 0.18, 0.4) + [0.0] * int(SAMPLE_RATE * 0.03) for f in (392, 330, 262)]  # type: ignore
    )

    write_wav(os.path.join(OUT_DIR, "merge.wav"), merge)
    write_wav(os.path.join(OUT_DIR, "win.wav"), win)
    write_wav(os.path.join(OUT_DIR, "over.wav"), over)
    print("sounds written to", OUT_DIR)


if __name__ == "__main__":
    main()
