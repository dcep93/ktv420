import json
import os
import re
import shutil
import threading
import time
import traceback
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Dict, List, Literal, Optional, Set, Tuple

import subprocess  # noqa: S404
from google.auth.credentials import AnonymousCredentials  # type: ignore
from google.auth.exceptions import DefaultCredentialsError  # type: ignore
from google.cloud import storage  # type: ignore
from pydantic import BaseModel

from . import logger, manager


class Request(BaseModel):
    mp3_path: str
    output_path: str


class PrepareJobRequest(BaseModel):
    pcm_path: str
    metadata: Dict[str, Any]


class PrepareJobResponse(BaseModel):
    status: Literal["started", "already_running", "already_exists"]
    request: Optional[Request] = None


class RunJobResponse(BaseModel):
    status: Literal["started", "already_running", "already_exists"]


Manager = manager.Manager[Request, RunJobResponse]


class _RunJobState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.logs: List[str] = []
        self.started_jobs = 0
        self.finished_jobs = 0
        self.preparing_mp3_paths: Set[str] = set()
        self.running_output_paths: Set[str] = set()

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

    def mark_prepare_started(self, mp3_path: str) -> bool:
        with self._lock:
            if mp3_path in self.preparing_mp3_paths:
                return False
            self.preparing_mp3_paths.add(mp3_path)
            return True

    def mark_prepare_finished(self, mp3_path: str) -> None:
        with self._lock:
            self.preparing_mp3_paths.discard(mp3_path)

    def mark_run_started(self, output_path: str) -> bool:
        with self._lock:
            if output_path in self.running_output_paths:
                return False
            self.running_output_paths.add(output_path)
            return True

    def mark_run_finished(self, output_path: str) -> None:
        with self._lock:
            self.running_output_paths.discard(output_path)

    def state(self) -> Dict[str, object]:
        with self._lock:
            return {
                "logs": list(self.logs),
                "started_jobs": self.started_jobs,
                "finished_jobs": self.finished_jobs,
                "preparing_mp3_paths": sorted(self.preparing_mp3_paths),
                "running_output_paths": sorted(self.running_output_paths),
            }


_STATE = _RunJobState()


def _make_storage_client() -> storage.Client:
    """
    Prefer Application Default Credentials.
    If unavailable, fall back to anonymous credentials.
    This only works for publicly accessible buckets.
    """
    try:
        return storage.Client()
    except DefaultCredentialsError:
        project = (
            os.getenv("GOOGLE_CLOUD_PROJECT")
            or os.getenv("GCP_PROJECT")
            or os.getenv("GCLOUD_PROJECT")
            or "anonymous"
        )
        _STATE.log("run_job.gcs.auth.anonymous adc_missing=1")
        return storage.Client(
            project=project,
            credentials=AnonymousCredentials(),
        )


def _run_command(command: list[str], success_message: str, failure_message: str) -> None:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _STATE.log(
            f"{failure_message} "
            f"returncode={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )

    _STATE.log(success_message)


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


def _download_file(client: storage.Client, gcs_path: str, dest: Path) -> None:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    _STATE.log(
        f"run_job.download.start bucket={bucket_name} blob={blob_path} -> {dest}"
    )
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(dest)  # type: ignore[call-arg]
    _STATE.log(f"run_job.download.done path={dest}")


def _download_mp3(client: storage.Client, gcs_path: str, dest: Path) -> None:
    _download_file(client, gcs_path, dest)


def _decode_to_wav(mp3_path: Path, wav_path: Path) -> Path:
    _STATE.log(f"run_job.decode.start input={mp3_path} output={wav_path}")
    _run_command(
        ["ffmpeg", "-y", "-i", str(mp3_path), str(wav_path)],
        "run_job.decode.done",
        "run_job.decode.failed",
    )
    return wav_path


def _wav_info(wav_path: Path) -> Tuple[int, int]:
    with wave.open(str(wav_path), "rb") as f:
        sample_rate = f.getframerate()
        nframes = f.getnframes()
    return sample_rate, nframes


def _force_length_samples(
    input_wav: Path, output_wav: Path, ref_samples: int, ref_sample_rate: int
) -> None:
    filter_chain = (
        "aresample="
        f"{ref_sample_rate}:resampler=soxr,"
        f"apad=pad_len={ref_samples},"
        f"atrim=end_sample={ref_samples}"
    )
    _run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_wav),
            "-af",
            filter_chain,
            str(output_wav),
        ],
        "run_job.align.done",
        "run_job.align.failed",
    )


def _encode_mp3(input_wav: Path, mp3_path: Path) -> None:
    _run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_wav),
            "-codec:a",
            "libmp3lame",
            "-qscale:a",
            "2",
            str(mp3_path),
        ],
        "run_job.encode_mp3.done",
        "run_job.encode_mp3.failed",
    )


def _encode_pcm_s16le_to_mp3(
    input_pcm: Path,
    mp3_path: Path,
    sample_rate: int,
    channel_count: int,
    crop: str,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        str(channel_count),
        "-i",
        str(input_pcm),
    ]
    audio_filter = _build_crop_filter(crop)
    if audio_filter:
        command.extend(["-af", audio_filter])
    command.extend(
        [
            "-codec:a",
            "libmp3lame",
            "-qscale:a",
            "2",
            str(mp3_path),
        ]
    )
    _run_command(
        command,
        "prepare_job.encode_mp3.done",
        "prepare_job.encode_mp3.failed",
    )


def _build_crop_filter(crop: str) -> str:
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)?)", crop)
    if not match:
        return ""

    start_trim = float(match.group(1))
    end_trim = float(match.group(2))
    filters = []
    if start_trim > 0:
        filters.append(f"atrim=start={start_trim:.6f}")
    if end_trim > 0:
        filters.extend(["areverse", f"atrim=start={end_trim:.6f}", "areverse"])
    if filters:
        filters.append("asetpts=PTS-STARTPTS")
    return ",".join(filters)


def _run_demucs(audio_path: Path, output_dir: Path) -> Path:
    _STATE.log(f"run_job.demucs.start input={audio_path} output_dir={output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    _run_command(
        ["demucs", "--out", str(output_dir), str(audio_path)],
        "run_job.demucs.done",
        "run_job.demucs.failed",
    )

    model_dirs = [p for p in output_dir.iterdir() if p.is_dir()]
    for model_dir in model_dirs:
        for track_dir in model_dir.iterdir():
            if not track_dir.is_dir():
                continue
            for stem_file in track_dir.iterdir():
                if stem_file.is_file():
                    stem_file.replace(output_dir / stem_file.name)
            shutil.rmtree(track_dir)
        shutil.rmtree(model_dir)

    return output_dir


def _align_and_encode_stems_to_mp3(
    output_dir: Path, ref_samples: int, ref_sample_rate: int
) -> None:
    for stem_file in list(output_dir.iterdir()):
        if stem_file.suffix.lower() != ".wav":
            continue
        aligned_wav = stem_file.with_name(stem_file.stem + ".aligned.wav")
        _force_length_samples(stem_file, aligned_wav, ref_samples, ref_sample_rate)
        mp3_path = stem_file.with_suffix(".mp3")
        _encode_mp3(aligned_wav, mp3_path)
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
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(file_path)  # type: ignore[call-arg]

    _STATE.log("run_job.upload.done")


def _upload_file(client: storage.Client, file_path: Path, gcs_path: str) -> None:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    _STATE.log(
        f"prepare_job.upload.start bucket={bucket_name} blob={blob_path} file={file_path}"
    )
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.upload_from_filename(file_path)  # type: ignore[call-arg]
    _STATE.log("prepare_job.upload.done")


def _delete_gcs_object(client: storage.Client, gcs_path: str) -> None:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    _STATE.log(f"gcs.delete.start bucket={bucket_name} blob={blob_path}")
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.delete()  # type: ignore[no-untyped-call]
    _STATE.log("gcs.delete.done")


def _gcs_object_exists(client: storage.Client, gcs_path: str) -> bool:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    exists = bool(blob.exists())  # type: ignore[no-untyped-call]
    _STATE.log(f"gcs.exists bucket={bucket_name} blob={blob_path} exists={exists}")
    return exists


def _write_metadata(
    output_dir: Path,
    processing_duration_s: float,
    ref_samples: int,
    ref_sample_rate: int,
) -> Path:
    metadata_path = output_dir / "_metadata.json"
    metadata = {
        "duration_s": processing_duration_s,
        "ref_samples": ref_samples,
        "ref_sample_rate": ref_sample_rate,
        "ref_duration_s": ref_samples / ref_sample_rate if ref_sample_rate else 0.0,
        "aligned_format": "mp3",
        "alignment_method": "aresample+apad+atrim end_sample",
    }
    metadata_path.write_text(json.dumps(metadata))
    return metadata_path


def _metadata_string(metadata: Dict[str, Any], key: str) -> str:
    value = metadata.get(key)
    return value if isinstance(value, str) else ""


def _metadata_int(metadata: Dict[str, Any], key: str) -> int:
    value = metadata.get(key)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return 0


def _prepare_job_request(payload: PrepareJobRequest) -> Request:
    metadata = payload.metadata
    track_id = _metadata_string(metadata, "trackId")
    track_name = _metadata_string(metadata, "trackName")
    if not track_id:
        raise ValueError("prepare_job metadata must include trackId")

    filename = _make_safe_path_part(track_name) or "input"
    bucket = os.getenv("PREPARE_JOB_BUCKET", os.getenv("ONEOFF_BUCKET", "stem420-bucket"))
    prefix = os.getenv("PREPARE_JOB_PREFIX", os.getenv("ONEOFF_PREFIX", "stems/")).strip("/")
    base_path = f"{prefix}/{track_id}" if prefix else track_id
    return Request(
        mp3_path=f"gs://{bucket}/{base_path}/input/{filename}.mp3",
        output_path=f"gs://{bucket}/{base_path}/output/",
    )


def _make_safe_path_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-")


def _output_metadata_path(output_path: str) -> str:
    return f"{output_path.rstrip('/')}/_metadata.json"


def _process_prepare_job(payload: PrepareJobRequest, request: Request) -> None:
    _STATE.log(
        f"prepare_job.process.start mp3_path={request.mp3_path} "
        f"output_path={request.output_path}"
    )

    client: storage.Client | None = None
    try:
        sample_rate = _metadata_int(payload.metadata, "audioSampleRate")
        channel_count = _metadata_int(payload.metadata, "audioChannelCount")
        if sample_rate <= 0:
            raise ValueError("prepare_job metadata must include audioSampleRate")
        if channel_count <= 0:
            raise ValueError("prepare_job metadata must include audioChannelCount")

        client = _make_storage_client()
        with TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            pcm_path = tmp / "input.pcm"
            mp3_path = tmp / "input.mp3"
            _download_file(client, payload.pcm_path, pcm_path)
            _encode_pcm_s16le_to_mp3(
                pcm_path,
                mp3_path,
                sample_rate,
                channel_count,
                _metadata_string(payload.metadata, "crop"),
            )
            _upload_file(client, mp3_path, request.mp3_path)

    except ValueError:
        _STATE.log("prepare_job.process.error")
        _STATE.log(traceback.format_exc())
    except Exception:
        _STATE.log("prepare_job.process.error")
        _STATE.log(traceback.format_exc())
    else:
        _STATE.log("prepare_job.process.success")
    finally:
        if client is not None:
            try:
                _delete_gcs_object(client, payload.pcm_path)
            except Exception:
                _STATE.log("prepare_job.pcm_delete.error")
                _STATE.log(traceback.format_exc())
        _STATE.mark_prepare_finished(request.mp3_path)


def prepare_job(payload: PrepareJobRequest) -> PrepareJobResponse:
    request = _prepare_job_request(payload)
    client = _make_storage_client()

    if _gcs_object_exists(client, request.mp3_path):
        return PrepareJobResponse(status="already_exists", request=request)

    if not _STATE.mark_prepare_started(request.mp3_path):
        _STATE.log(f"prepare_job.process.already_running mp3_path={request.mp3_path}")
        return PrepareJobResponse(status="already_running")

    thread = threading.Thread(
        target=_process_prepare_job,
        args=(payload, request),
        daemon=True,
    )
    thread.start()
    return PrepareJobResponse(status="started")


def _process_request(request: Request) -> None:
    _STATE.log(
        f"run_job.process.start mp3_path={request.mp3_path} "
        f"output_path={request.output_path}"
    )

    start_time = time.perf_counter()
    try:
        client = _make_storage_client()
        with TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            mp3_path = tmp / "input.mp3"
            _download_mp3(client, request.mp3_path, mp3_path)

            reference_wav = tmp / "reference.wav"
            _decode_to_wav(mp3_path, reference_wav)
            ref_sample_rate, ref_samples = _wav_info(reference_wav)

            demucs_output = tmp / "demucs_output"
            _run_demucs(reference_wav, demucs_output)
            _align_and_encode_stems_to_mp3(demucs_output, ref_samples, ref_sample_rate)

            duration_s = time.perf_counter() - start_time
            _write_metadata(demucs_output, duration_s, ref_samples, ref_sample_rate)

            _upload_directory(client, demucs_output, request.output_path)

    except Exception:
        _STATE.log("run_job.process.error")
        _STATE.log(traceback.format_exc())
    else:
        _STATE.log("run_job.process.success")
    finally:
        _STATE.mark_finished()
        _STATE.mark_run_finished(request.output_path)


def run_job(request: Request) -> RunJobResponse:
    client = _make_storage_client()
    metadata_path = _output_metadata_path(request.output_path)

    if _gcs_object_exists(client, metadata_path):
        return RunJobResponse(status="already_exists")

    if not _STATE.mark_run_started(request.output_path):
        _STATE.log(f"run_job.process.already_running output_path={request.output_path}")
        return RunJobResponse(status="already_running")

    _STATE.mark_started()
    thread = threading.Thread(target=_process_request, args=(request,), daemon=True)
    thread.start()
    return RunJobResponse(status="started")


def get_state() -> Dict[str, object]:
    return _STATE.state()
