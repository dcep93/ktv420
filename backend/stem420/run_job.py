import json
import os
import shutil
import threading
import time
import traceback
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Dict, List, Tuple

import subprocess  # noqa: S404
from google.cloud import storage  # type: ignore
from pydantic import BaseModel

from . import logger, manager


class Request(BaseModel):
    mp3_path: str
    output_path: str


class Response(BaseModel):
    pass


Manager = manager.Manager[Request, Response]


class _RunJobState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.logs: List[str] = []
        self.started_jobs = 0
        self.finished_jobs = 0

    def log(self, msg: str) -> None:
        logger.log(msg)
        with self._lock:
            self.logs.append(msg)

    def mark_started(self) -> None:
        with self._lock:
            self.started_jobs += 1

    def mark_finished(self) -> None:
        with self._lock:
            self.finished_jobs += 1

    def state(self) -> Dict[str, object]:
        with self._lock:
            return {
                "logs": list(self.logs),
                "started_jobs": self.started_jobs,
                "finished_jobs": self.finished_jobs,
            }


_STATE = _RunJobState()


def _parse_gcs_path(gcs_path: str) -> Tuple[str, str]:
    if not gcs_path.startswith("gs://"):
        msg = f"Invalid GCS path: {gcs_path}"
        _STATE.log(msg)
        raise ValueError(msg)
    _, path = gcs_path.split("gs://", 1)
    bucket_name, *blob_parts = path.split("/", 1)
    blob_path = blob_parts[0] if blob_parts else ""
    if not bucket_name or not blob_path:
        msg = f"Invalid GCS path: {gcs_path}"
        _STATE.log(msg)
        raise ValueError(msg)
    return bucket_name, blob_path


def _download_mp3(client: storage.Client, gcs_path: str, dest: Path) -> None:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    _STATE.log(
        f"run_job.download.start bucket={bucket_name} blob={blob_path} -> {dest}"
    )
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(dest)  # type: ignore[call-arg]
    _STATE.log(f"run_job.download.done path={dest}")


def _decode_to_wav(mp3_path: Path, wav_path: Path) -> Path:
    _STATE.log(f"run_job.decode.start input={mp3_path} output={wav_path}")
    result = subprocess.run(  # noqa: S603
        ["ffmpeg", "-y", "-i", str(mp3_path), str(wav_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _STATE.log(
            "run_job.decode.failed "
            f"returncode={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )
    _STATE.log("run_job.decode.done")
    return wav_path


def _wav_info(wav_path: Path) -> Tuple[int, int]:
    with wave.open(str(wav_path), "rb") as f:
        sample_rate = f.getframerate()
        nframes = f.getnframes()
    return sample_rate, nframes


def _force_length_samples(input_wav: Path, output_wav: Path, ref_samples: int) -> None:
    result = subprocess.run(  # noqa: S603
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_wav),
            "-af",
            f"apad,atrim=end_sample={ref_samples}",
            str(output_wav),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _STATE.log(
            "run_job.align.failed "
            f"returncode={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )


def _encode_flac(input_wav: Path, flac_path: Path) -> None:
    result = subprocess.run(  # noqa: S603
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_wav),
            "-compression_level",
            "8",
            str(flac_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _STATE.log(
            "run_job.encode_flac.failed "
            f"returncode={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )


def _run_demucs(audio_path: Path, output_dir: Path) -> Path:
    _STATE.log(f"run_job.demucs.start input={audio_path} output_dir={output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(  # noqa: S603
        [
            "demucs",
            "--out",
            str(output_dir),
            str(audio_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _STATE.log(
            "run_job.demucs.failed "
            f"returncode={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )
    _STATE.log("run_job.demucs.done")

    model_dirs = [path for path in output_dir.iterdir() if path.is_dir()]
    for model_dir in model_dirs:
        for track_dir in model_dir.iterdir():
            if not track_dir.is_dir():
                continue
            for stem_file in track_dir.iterdir():
                if stem_file.is_file():
                    destination = output_dir / stem_file.name
                    stem_file.replace(destination)
            shutil.rmtree(track_dir)
        shutil.rmtree(model_dir)

    return output_dir


def _align_and_encode_stems_to_flac(output_dir: Path, ref_samples: int) -> None:
    for stem_file in list(output_dir.iterdir()):
        if stem_file.suffix.lower() != ".wav" or not stem_file.is_file():
            continue
        aligned_wav = stem_file.with_name(stem_file.stem + ".aligned.wav")
        _force_length_samples(stem_file, aligned_wav, ref_samples)
        flac_path = stem_file.with_suffix(".flac")
        _encode_flac(aligned_wav, flac_path)
        stem_file.unlink(missing_ok=True)
        aligned_wav.unlink(missing_ok=True)


def _upload_directory(client: storage.Client, directory: Path, gcs_path: str) -> None:
    bucket_name, base_blob_path = _parse_gcs_path(gcs_path)
    bucket = client.bucket(bucket_name)
    _STATE.log(
        "run_job.upload.start "
        f"bucket={bucket_name} base_blob_path={base_blob_path} directory={directory}"
    )
    for file_path in directory.rglob("*"):
        if not file_path.is_file():
            continue
        relative_path = file_path.relative_to(directory)
        blob_path = os.path.join(base_blob_path, str(relative_path))
        _STATE.log(f"run_job.upload.file {file_path} -> gs://{bucket_name}/{blob_path}")
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(file_path)  # type: ignore[call-arg]
    _STATE.log("run_job.upload.done")


def _write_metadata(
    output_dir: Path,
    processing_duration_s: float,
    ref_samples: int,
    ref_sample_rate: int,
) -> Path:
    metadata_path = output_dir / "_metadata.json"
    ref_duration_s = ref_samples / ref_sample_rate if ref_sample_rate else 0.0
    metadata = {
        "duration_s": processing_duration_s,
        "ref_samples": ref_samples,
        "ref_sample_rate": ref_sample_rate,
        "ref_duration_s": ref_duration_s,
        "aligned_format": "flac",
        "alignment_method": "apad+atrim end_sample",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata))
    _STATE.log(
        "run_job.metadata.written "
        f"path={metadata_path} processing_duration_s={processing_duration_s} "
        f"ref_samples={ref_samples} ref_sample_rate={ref_sample_rate}"
    )
    return metadata_path


def _process_request(request: Request) -> None:
    _STATE.log(
        f"run_job.process.start mp3_path={request.mp3_path} output_path={request.output_path}"
    )
    start_time = time.perf_counter()
    try:
        client = storage.Client()
        with TemporaryDirectory() as tmp_dir:
            tmp_dir_path = Path(tmp_dir)
            mp3_path = tmp_dir_path / "input.mp3"
            _download_mp3(client, request.mp3_path, mp3_path)
            reference_wav = tmp_dir_path / "reference.wav"
            _decode_to_wav(mp3_path, reference_wav)
            ref_sample_rate, ref_samples = _wav_info(reference_wav)
            demucs_output_dir = tmp_dir_path / "demucs_output"
            _run_demucs(reference_wav, demucs_output_dir)
            _align_and_encode_stems_to_flac(demucs_output_dir, ref_samples)
            duration_s = time.perf_counter() - start_time
            _write_metadata(
                demucs_output_dir, duration_s, ref_samples, ref_sample_rate
            )

            # demucs output is typically nested, upload all generated stems
            _upload_directory(client, demucs_output_dir, request.output_path)
    except Exception:
        _STATE.log("run_job.process.error")
        _STATE.log(traceback.format_exc())
    else:
        _STATE.log("run_job.process.success")
    finally:
        _STATE.mark_finished()


def run_job(request: Request) -> Response:
    _STATE.mark_started()
    _STATE.log("run_job.start")
    thread = threading.Thread(target=_process_request, args=(request,), daemon=True)
    thread.start()
    _STATE.log("run_job.spawned_background_thread")
    return Response()


def get_state() -> Dict[str, object]:
    return _STATE.state()
