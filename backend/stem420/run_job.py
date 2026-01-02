import json
import os
import shutil
import threading
import time
import traceback
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


def _run_demucs(mp3_path: Path, output_dir: Path) -> Path:
    _STATE.log(f"run_job.demucs.start input={mp3_path} output_dir={output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(  # noqa: S603
        [
            "demucs",
            "--out",
            str(output_dir),
            # compact stems:
            "--mp3",
            "--mp3-bitrate",
            "64",  # try 48/64/96; 64 is usually fine for “just stems”
            str(mp3_path),
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


def _write_metadata(output_dir: Path, duration_s: float) -> Path:
    metadata_path = output_dir / "metadata.json"
    metadata = {"duration_s": duration_s}
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata))
    _STATE.log(f"run_job.metadata.written path={metadata_path} duration_s={duration_s}")
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
            demucs_output_dir = tmp_dir_path / "demucs_output"
            _run_demucs(mp3_path, demucs_output_dir)
            duration_s = time.perf_counter() - start_time
            _write_metadata(demucs_output_dir, duration_s)

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
