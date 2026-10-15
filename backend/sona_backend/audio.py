"""Audio decode/encode through PyAV (bundled FFmpeg libraries, no system install)."""
from __future__ import annotations

from pathlib import Path

import av

CODECS = {".mp3": ("libmp3lame", "s16p"), ".flac": ("flac", "s16"), ".wav": ("pcm_s16le", "s16")}


def convert(src: Path, dst: Path, *, max_seconds: float | None = None, mono: bool = False,
            rate: int | None = None) -> float:
    """Transcode src to the format implied by dst's suffix; returns output seconds."""
    codec, fmt = CODECS[dst.suffix.lower()]
    with av.open(str(src)) as inp, av.open(str(dst), "w") as out:
        stream_in = inp.streams.audio[0]
        out_rate = rate or stream_in.rate
        if codec == "libmp3lame" and out_rate not in (32000, 44100, 48000):
            out_rate = 44100
        layout = "mono" if mono or stream_in.channels == 1 else "stereo"
        stream = out.add_stream(codec, rate=out_rate, layout=layout)
        if codec == "libmp3lame":
            stream.bit_rate = 192000
        resampler = av.AudioResampler(format=fmt, layout=layout, rate=out_rate)
        limit = int(max_seconds * out_rate) if max_seconds else None
        written = 0

        def emit(frames):
            nonlocal written
            for frame in frames:
                if limit is not None and written + frame.samples > limit:
                    keep = limit - written
                    if keep <= 0:
                        return False
                    array = frame.to_ndarray()
                    array = array[:, :keep] if frame.format.is_planar else array[:, :keep * len(frame.layout.channels)]
                    trimmed = av.AudioFrame.from_ndarray(array, format=frame.format.name, layout=frame.layout.name)
                    trimmed.sample_rate = frame.sample_rate
                    frame = trimmed
                frame.pts = None
                written += frame.samples
                for packet in stream.encode(frame):
                    out.mux(packet)
            return limit is None or written < limit

        for frame in inp.decode(stream_in):
            if not emit(resampler.resample(frame)):
                break
        else:
            emit(resampler.resample(None))
        for packet in stream.encode(None):
            out.mux(packet)
    return written / out_rate


def duration(path: Path) -> float:
    with av.open(str(path)) as inp:
        stream = inp.streams.audio[0]
        if stream.duration is not None and stream.time_base:
            return float(stream.duration * stream.time_base)
        if inp.duration:
            return inp.duration / av.time_base
        return sum(frame.samples for frame in inp.decode(stream)) / stream.rate


def readable(path: Path) -> bool:
    try:
        with av.open(str(path)) as inp:
            return bool(inp.streams.audio)
    except av.FFmpegError:
        return False
