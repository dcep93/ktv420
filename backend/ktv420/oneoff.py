import os
from typing import Dict, List, Set

from . import run_job


def _bucket_and_prefix() -> tuple[str, str]:
    bucket = os.getenv("ONEOFF_BUCKET", "stem420-bucket")
    prefix = os.getenv("ONEOFF_PREFIX", "_stem420/")
    return bucket, prefix


def _list_inputs_without_outputs(
    blob_names: List[str], base_prefix: str
) -> Dict[str, str]:
    inputs: Dict[str, str] = {}
    outputs: Set[str] = set()

    for name in blob_names:
        if not name.startswith(base_prefix):
            continue

        relative_path = name[len(base_prefix) :]
        segments = relative_path.split("/")
        if len(segments) < 3:
            continue

        job_id, category = segments[0], segments[1]
        if category == "input":
            inputs[job_id] = name
        elif category == "output":
            outputs.add(job_id)

    missing_outputs = {job_id: path for job_id, path in inputs.items() if job_id not in outputs}
    return missing_outputs


def main() -> None:
    bucket_name, base_prefix = _bucket_and_prefix()
    client = run_job._make_storage_client()
    blob_names = [blob.name for blob in client.list_blobs(bucket_name, prefix=base_prefix)]
    missing_outputs = _list_inputs_without_outputs(blob_names, base_prefix)

    for job_id, input_blob in missing_outputs.items():
        output_prefix = f"gs://{bucket_name}/{base_prefix}{job_id}/output/"
        request = run_job.Request(
            mp3_path=f"gs://{bucket_name}/{input_blob}",
            output_path=output_prefix,
        )
        run_job._process_request(request)

    print("oneoff complete")


if __name__ == "__main__":
    main()
