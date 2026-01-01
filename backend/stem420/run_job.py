import os
import threading
import traceback
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Tuple

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


def _parse_gcs_path(gcs_path: str) -> Tuple[str, str]:
    if not gcs_path.startswith("gs://"):
        msg = f"Invalid GCS path: {gcs_path}"
        logger.log(msg)
        raise ValueError(msg)
    _, path = gcs_path.split("gs://", 1)
    bucket_name, *blob_parts = path.split("/", 1)
    blob_path = blob_parts[0] if blob_parts else ""
    if not bucket_name or not blob_path:
        msg = f"Invalid GCS path: {gcs_path}"
        logger.log(msg)
        raise ValueError(msg)
    return bucket_name, blob_path


def _download_mp3(client: storage.Client, gcs_path: str, dest: Path) -> None:
    bucket_name, blob_path = _parse_gcs_path(gcs_path)
    logger.log(f"run_job.download.start bucket={bucket_name} blob={blob_path} -> {dest}")
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(dest)  # type: ignore[call-arg]
    logger.log(f"run_job.download.done path={dest}")


def _run_demucs(mp3_path: Path, output_dir: Path) -> Path:
    logger.log(f"run_job.demucs.start input={mp3_path} output_dir={output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(  # noqa: S603
        [
            "demucs",
            "--out",
            str(output_dir),
            str(mp3_path),
        ],
        check=True,
    )
    logger.log("run_job.demucs.done")
    return output_dir


def _upload_directory(client: storage.Client, directory: Path, gcs_path: str) -> None:
    bucket_name, base_blob_path = _parse_gcs_path(gcs_path)
    bucket = client.bucket(bucket_name)
    logger.log(
        "run_job.upload.start "
        f"bucket={bucket_name} base_blob_path={base_blob_path} directory={directory}"
    )
    for file_path in directory.rglob("*"):
        if not file_path.is_file():
            continue
        relative_path = file_path.relative_to(directory)
        blob_path = os.path.join(base_blob_path, str(relative_path))
        logger.log(f"run_job.upload.file {file_path} -> gs://{bucket_name}/{blob_path}")
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(file_path)  # type: ignore[call-arg]
    logger.log("run_job.upload.done")


def _process_request(request: Request) -> None:
    logger.log(f"run_job.process.start mp3_path={request.mp3_path} output_path={request.output_path}")
    try:
        client = storage.Client()
        with TemporaryDirectory() as tmp_dir:
            tmp_dir_path = Path(tmp_dir)
            mp3_path = tmp_dir_path / "input.mp3"
            _download_mp3(client, request.mp3_path, mp3_path)
            demucs_output_dir = tmp_dir_path / "demucs_output"
            _run_demucs(mp3_path, demucs_output_dir)

            # demucs output is typically nested, upload all generated stems
            _upload_directory(client, demucs_output_dir, request.output_path)
    except Exception:
        logger.log("run_job.process.error")
        logger.log(traceback.format_exc())
    else:
        logger.log("run_job.process.success")


def run_job(request: Request) -> Response:
    logger.log("run_job.start")
    thread = threading.Thread(target=_process_request, args=(request,), daemon=True)
    thread.start()
    logger.log("run_job.spawned_background_thread")
    return Response()
