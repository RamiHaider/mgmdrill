"""Transcribe a voice memo (m4a / mp4 / mp3 / wav) locally with faster-whisper.

Usage:  python -I tools/transcribe.py "<audio file>" [--model small|medium] [--out file.md]
Writes <audio>.md next to the audio (or --out) and prints the text. Runs on CPU, no upload.
"""
import sys, argparse, time
from pathlib import Path
from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("audio"); ap.add_argument("--model", default="small"); ap.add_argument("--out")
a = ap.parse_args()
src = Path(a.audio); out = Path(a.out) if a.out else src.with_suffix(".md")
t0 = time.time()
model = WhisperModel(a.model, device="cpu", compute_type="int8")
segments, info = model.transcribe(str(src), language="en", vad_filter=True, beam_size=5)
lines = []
for s in segments:
    m, sec = divmod(int(s.start), 60)
    lines.append(f"[{m:02d}:{sec:02d}] {s.text.strip()}")
text = "\n".join(lines)
out.write_text(f"# Transcript: {src.name}\n\nDuration {info.duration:.0f}s, model {a.model}\n\n{text}\n", encoding="utf-8")
print(text)
print(f"\n-- wrote {out} ({time.time() - t0:.0f}s)", file=sys.stderr)
