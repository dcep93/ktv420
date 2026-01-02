#!/bin/bash

set -euo pipefail

# # requires billing!
# BILLING_ACCOUNT_ID="$(
#   gcloud billing accounts list \
#     --format="value(name)" \
#     | head -n 1
# )"
# set -e
# gcloud services enable compute
# gcloud services enable cloudbuild.googleapis.com
# gcloud services enable run.googleapis.com
# IAM=deployer-github-stem420
# gcloud iam service-accounts create $IAM
# sleep 1
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/run.admin"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/cloudbuild.builds.editor"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/storage.objectAdmin"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/storage.objectViewer"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/editor"
# gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com" --role="roles/viewer"
# gcloud iam service-accounts keys create stem420_gac.json --iam-account "$IAM@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com"
# cat stem420_gac.json

# BUCKET_NAME="stem420-bucket"
# LOCATION="us-east1"
# gcloud services enable storage.googleapis.com
# gcloud storage buckets create "gs://$BUCKET_NAME" \
#     --location="$LOCATION" \
#     --uniform-bucket-level-access
# gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_NAME" \
#   --member="allUsers" \
#   --role="roles/storage.objectAdmin"

SA_KEY="$1"

REGION="us-east1"

export GOOGLE_APPLICATION_CREDENTIALS="gac.json"
echo "$SA_KEY" >"$GOOGLE_APPLICATION_CREDENTIALS"
npm install google-auth-library
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"
GOOGLE_CLOUD_PROJECT="$(jq -r .project_id < "$GOOGLE_APPLICATION_CREDENTIALS")"

cd backend

docker buildx build \
    --cache-to=type=local,dest=/tmp/github-cache/backend \
    --cache-from=type=local,src=/tmp/github-cache/backend \
    .

ARGS=mypy make dockerexecnotty

echo 'ENTRYPOINT [ "make", "server" ]' >>Dockerfile

gcloud config set builds/use_kaniko True
gcloud config set builds/kaniko_cache_ttl 8760
IMG_URL=us.gcr.io/"${GOOGLE_CLOUD_PROJECT}"/stem420/backend:"$(git log -1 --format=format:%H)"
gcloud builds submit --project "${GOOGLE_CLOUD_PROJECT}" --tag "${IMG_URL}"

echo deploy_to_cloud_run $GOOGLE_CLOUD_PROJECT

gcloud beta run deploy "stem420" \
  --project "${GOOGLE_CLOUD_PROJECT}" \
  --region "${REGION}" \
  --image "${IMG_URL}" \
  --platform managed \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --cpu 2 \
  --memory 2Gi \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 300 \
  --liveness-probe httpGet.path=/health

# # gsutil -m rm -r "gs://us.artifacts.${GOOGLE_CLOUD_PROJECT}.appspot.com"
# # gcloud beta app repair
