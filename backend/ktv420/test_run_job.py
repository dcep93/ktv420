import importlib.util
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

from . import run_job


class RunJobStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        run_job._STATE = run_job._RunJobState()

    def _prepare_payload(self) -> run_job.PrepareJobRequest:
        return run_job.PrepareJobRequest(
            pcm_s16le_b64="",
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


if __name__ == "__main__":
    unittest.main()
