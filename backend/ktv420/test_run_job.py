import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


def _install_google_stubs_if_needed() -> None:
    try:
        has_google_storage = importlib.util.find_spec("google.cloud.storage") is not None
    except ModuleNotFoundError:
        has_google_storage = False

    if has_google_storage:
        return

    class _AnonymousCredentials:
        pass

    class _DefaultCredentialsError(Exception):
        pass

    class _StorageClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

    google_module = types.ModuleType("google")
    auth_module = types.ModuleType("google.auth")
    credentials_module = types.ModuleType("google.auth.credentials")
    exceptions_module = types.ModuleType("google.auth.exceptions")
    cloud_module = types.ModuleType("google.cloud")
    storage_module = types.ModuleType("google.cloud.storage")

    setattr(credentials_module, "AnonymousCredentials", _AnonymousCredentials)
    setattr(exceptions_module, "DefaultCredentialsError", _DefaultCredentialsError)
    setattr(storage_module, "Client", _StorageClient)
    setattr(cloud_module, "storage", storage_module)

    sys.modules.setdefault("google", google_module)
    sys.modules.setdefault("google.auth", auth_module)
    sys.modules.setdefault("google.auth.credentials", credentials_module)
    sys.modules.setdefault("google.auth.exceptions", exceptions_module)
    sys.modules.setdefault("google.cloud", cloud_module)
    sys.modules.setdefault("google.cloud.storage", storage_module)


_install_google_stubs_if_needed()


def _install_pydantic_stubs_if_needed() -> None:
    try:
        has_pydantic = importlib.util.find_spec("pydantic") is not None
    except ModuleNotFoundError:
        has_pydantic = False

    if has_pydantic:
        return

    class _BaseModel:
        def __init__(self, **kwargs: object) -> None:
            annotations = getattr(self, "__annotations__", {})
            for key in annotations:
                if key in kwargs:
                    setattr(self, key, kwargs[key])
                elif hasattr(type(self), key):
                    setattr(self, key, getattr(type(self), key))
            for key, value in kwargs.items():
                if key not in annotations:
                    setattr(self, key, value)

        def model_dump(self) -> dict[str, object]:
            annotations = getattr(self, "__annotations__", {})
            return {key: _dump_value(getattr(self, key)) for key in annotations if hasattr(self, key)}

    def _dump_value(value: object) -> object:
        if hasattr(value, "model_dump"):
            return value.model_dump()  # type: ignore[no-any-return, no-untyped-call]
        if isinstance(value, dict):
            return {key: _dump_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [_dump_value(item) for item in value]
        return value

    pydantic_module = types.ModuleType("pydantic")
    setattr(pydantic_module, "BaseModel", _BaseModel)
    sys.modules.setdefault("pydantic", pydantic_module)


_install_pydantic_stubs_if_needed()

from . import run_job


class FakeBlob:
    def __init__(self, bucket: "FakeBucket", name: str) -> None:
        self.bucket = bucket
        self.name = name

    def exists(self) -> bool:
        return self.name in self.bucket.objects

    def download_as_text(self) -> str:
        return self.bucket.objects[self.name]

    def upload_from_string(self, value: str, **kwargs: object) -> None:
        self.bucket.objects[self.name] = value

    def upload_from_filename(self, file_path: str | os.PathLike[str]) -> None:
        with open(file_path, "rb") as fh:
            self.bucket.objects[self.name] = fh.read().decode("utf-8", errors="replace")

    def download_to_filename(self, file_path: str | os.PathLike[str]) -> None:
        with open(file_path, "w") as fh:
            fh.write(self.bucket.objects[self.name])

    def delete(self) -> None:
        self.bucket.objects.pop(self.name, None)


class FakeBucket:
    def __init__(self) -> None:
        self.objects: dict[str, str] = {}

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)


class FakeStorageClient:
    def __init__(self) -> None:
        self.buckets: dict[str, FakeBucket] = {}

    def bucket(self, name: str) -> FakeBucket:
        self.buckets.setdefault(name, FakeBucket())
        return self.buckets[name]

    def list_blobs(self, bucket_name: str, prefix: str) -> list[FakeBlob]:
        bucket = self.bucket(bucket_name)
        return [FakeBlob(bucket, name) for name in bucket.objects if name.startswith(prefix)]


class RunJobStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        run_job._STATE = run_job._RunJobState()

    def _prepare_payload(self) -> run_job.PrepareJobRequest:
        return run_job.PrepareJobRequest(
            pcm_path="gs://stem420-bucket/pcm/track-1/abc123.pcm",
            metadata={
                "trackId": "track-1",
                "trackName": "Song One",
                "audioSampleRate": 44100,
                "audioChannelCount": 2,
            },
        )

    def _request(self) -> run_job.Request:
        return run_job.Request(
            mp3_path="gs://stem420-bucket/stems/track-1/input/Song-One.mp3",
            output_path="gs://stem420-bucket/stems/track-1/output/",
        )

    def test_prepare_job_existing_mp3_reports_status_and_request(self) -> None:
        client = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=True),
            patch.object(run_job.threading, "Thread") as thread_class,
        ):
            response = run_job.prepare_job(self._prepare_payload())

        self.assertEqual(response.status, "already_exists")
        self.assertIsNotNone(response.request)
        self.assertEqual(
            response.request.mp3_path if response.request else "",
            "gs://stem420-bucket/stems/track-1/input/Song-One.mp3",
        )
        thread_class.assert_not_called()

    def test_prepare_job_new_mp3_reports_started(self) -> None:
        client = MagicMock()
        thread = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=False),
            patch.object(run_job.threading, "Thread", return_value=thread),
        ):
            response = run_job.prepare_job(self._prepare_payload())

        self.assertEqual(response.status, "started")
        self.assertIsNone(response.request)
        thread.start.assert_called_once_with()
        self.assertEqual(
            run_job._STATE.state()["preparing_mp3_paths"],
            ["gs://stem420-bucket/stems/track-1/input/Song-One.mp3"],
        )

    def test_prepare_job_active_mp3_reports_already_running(self) -> None:
        payload = self._prepare_payload()
        request = run_job._prepare_job_request(payload)
        run_job._STATE.mark_prepare_started(request.mp3_path)
        client = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=False),
            patch.object(run_job.threading, "Thread") as thread_class,
        ):
            response = run_job.prepare_job(payload)

        self.assertEqual(response.status, "already_running")
        self.assertIsNone(response.request)
        thread_class.assert_not_called()

    def test_run_job_existing_metadata_reports_status_without_thread(self) -> None:
        client = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=True),
            patch.object(run_job.threading, "Thread") as thread_class,
        ):
            response = run_job.run_job(self._request())

        self.assertEqual(response.status, "already_exists")
        self.assertEqual(run_job._STATE.state()["started_jobs"], 0)
        thread_class.assert_not_called()

    def test_run_job_new_output_reports_started(self) -> None:
        client = MagicMock()
        thread = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=False),
            patch.object(run_job.threading, "Thread", return_value=thread),
        ):
            response = run_job.run_job(self._request())

        self.assertEqual(response.status, "started")
        thread.start.assert_called_once_with()
        state = run_job._STATE.state()
        self.assertEqual(state["started_jobs"], 1)
        self.assertEqual(
            state["running_output_paths"],
            ["gs://stem420-bucket/stems/track-1/output/"],
        )

    def test_run_job_active_output_reports_already_running(self) -> None:
        request = self._request()
        run_job._STATE.mark_run_started(request.output_path)
        client = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", return_value=False),
            patch.object(run_job.threading, "Thread") as thread_class,
        ):
            response = run_job.run_job(request)

        self.assertEqual(response.status, "already_running")
        self.assertEqual(run_job._STATE.state()["started_jobs"], 0)
        thread_class.assert_not_called()

    def test_process_request_clears_running_marker_after_failure(self) -> None:
        request = self._request()
        run_job._STATE.mark_run_started(request.output_path)

        with patch.object(run_job, "_make_storage_client", side_effect=RuntimeError("boom")):
            run_job._process_request(request)

        state = run_job._STATE.state()
        self.assertEqual(state["finished_jobs"], 1)
        self.assertEqual(state["running_output_paths"], [])

    def test_process_prepare_job_downloads_pcm_and_deletes_staged_pcm(self) -> None:
        payload = self._prepare_payload()
        request = self._request()
        client = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_download_file") as download_file,
            patch.object(run_job, "_encode_pcm_s16le_to_mp3") as encode_pcm,
            patch.object(run_job, "_upload_file") as upload_file,
            patch.object(run_job, "_delete_gcs_object") as delete_gcs_object,
        ):
            run_job._process_prepare_job(payload, request)

        download_file.assert_called_once()
        self.assertEqual(download_file.call_args.args[0], client)
        self.assertEqual(download_file.call_args.args[1], payload.pcm_path)
        encode_pcm.assert_called_once()
        upload_file.assert_called_once()
        self.assertEqual(upload_file.call_args.args[0], client)
        self.assertEqual(upload_file.call_args.args[2], request.mp3_path)
        delete_gcs_object.assert_called_once_with(client, payload.pcm_path)
        self.assertEqual(run_job._STATE.state()["preparing_mp3_paths"], [])

    def test_list_pending_queue_blobs_sorts_unix_timestamp_filenames(self) -> None:
        client = FakeStorageClient()
        bucket = client.bucket("stem420-bucket")
        bucket.objects["queue/pending/2000.json"] = "{}"
        bucket.objects["queue/pending/1000.json"] = "{}"
        bucket.objects["queue/pending/not-a-job.txt"] = "{}"

        pending = run_job._list_pending_queue_blobs(client)  # type: ignore[arg-type]

        self.assertEqual(
            [blob.name for blob in pending],
            ["queue/pending/1000.json", "queue/pending/2000.json"],
        )

    def test_process_queue_empty_writes_empty_head_state(self) -> None:
        client = FakeStorageClient()

        with patch.object(run_job, "_make_storage_client", return_value=client):
            response = run_job.process_queue()

        self.assertEqual(response.status, "empty")
        state = json.loads(client.bucket("stem420-bucket").objects["queue/state/head.json"])
        self.assertEqual(state["head_state"], "empty")
        self.assertIsNone(state["head_track_id"])

    def test_process_queue_starts_worker_once(self) -> None:
        client = FakeStorageClient()
        bucket = client.bucket("stem420-bucket")
        bucket.objects["queue/pending/1000.json"] = json.dumps(self._queue_item())
        thread = MagicMock()

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job.threading, "Thread", return_value=thread),
        ):
            response = run_job.process_queue()
            second_response = run_job.process_queue()

        self.assertEqual(response.status, "started")
        self.assertEqual(second_response.status, "already_running")
        thread.start.assert_called_once_with()

    def test_queue_worker_processes_item_and_updates_head_state(self) -> None:
        client = FakeStorageClient()
        bucket = client.bucket("stem420-bucket")
        bucket.objects["queue/pending/1000.json"] = json.dumps(self._queue_item())

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", side_effect=[False, False]),
            patch.object(run_job, "_prepare_mp3_from_pcm") as prepare_mp3,
            patch.object(run_job, "_run_request_sync") as run_request,
            patch.object(run_job, "_delete_gcs_object_if_exists") as delete_if_exists,
        ):
            run_job._process_queue_worker("worker-1")

        prepare_mp3.assert_called_once()
        run_request.assert_called_once()
        delete_if_exists.assert_called_once()
        self.assertNotIn("queue/pending/1000.json", bucket.objects)
        state = json.loads(bucket.objects["queue/state/head.json"])
        self.assertEqual(state["head_state"], "empty")
        self.assertEqual(state["last_changed_track_id"], "track-1")
        self.assertEqual(state["last_changed_status"], "completed")
        self.assertIn("track-1", state["changed_track_ids"])

    def test_queue_worker_writes_error_and_moves_failed_item(self) -> None:
        client = FakeStorageClient()
        bucket = client.bucket("stem420-bucket")
        bucket.objects["queue/pending/1000.json"] = json.dumps(self._queue_item())

        with (
            patch.object(run_job, "_make_storage_client", return_value=client),
            patch.object(run_job, "_gcs_object_exists", side_effect=[False, True]),
            patch.object(run_job, "_run_request_sync", side_effect=RuntimeError("boom")),
        ):
            run_job._process_queue_worker("worker-1")

        self.assertNotIn("queue/pending/1000.json", bucket.objects)
        self.assertIn("queue/failed/1000.json", bucket.objects)
        self.assertIn("stems/track-1/output/_error.json", bucket.objects)
        state = json.loads(bucket.objects["queue/state/head.json"])
        self.assertEqual(state["last_changed_track_id"], "track-1")
        self.assertEqual(state["last_changed_status"], "failed")

    def _queue_item(self) -> dict[str, object]:
        return {
            "version": 1,
            "created_at_ms": 1000,
            "track_id": "track-1",
            "pcm_path": "gs://stem420-bucket/pcm/track-1/abc123.pcm",
            "metadata": {
                "trackId": "track-1",
                "trackName": "Song One",
                "audioSampleRate": 44100,
                "audioChannelCount": 2,
            },
        }


if __name__ == "__main__":
    unittest.main()
