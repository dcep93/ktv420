from . import run_job

request = run_job.Request(
    mp3_path="gs://stem420-bucket/_stem420/f67750ba78151f96a973b4e490f4a9f4/input/honey.mp3",
    output_path="gs://stem420-bucket/_stem420/f67750ba78151f96a973b4e490f4a9f4/output/",
)

run_job._process_request(request)

print("oneoff complete")
