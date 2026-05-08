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
SERVICE_NAME="stem420"

export GOOGLE_APPLICATION_CREDENTIALS="gac.json"
echo "$SA_KEY" >"$GOOGLE_APPLICATION_CREDENTIALS"
npm install google-auth-library
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"
GOOGLE_CLOUD_PROJECT="$(jq -r .project_id < "$GOOGLE_APPLICATION_CREDENTIALS")"
IMG_PATH=us.gcr.io/"${GOOGLE_CLOUD_PROJECT}"/stem420/backend

DEPLOYED_IMG_URL="$(
  gcloud run services describe "$SERVICE_NAME" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --region "${REGION}" \
    --platform managed \
    --format='value(spec.template.spec.containers[0].image)' \
    2>/dev/null || true
)"

if [[ -z "$DEPLOYED_IMG_URL" ]]; then
  echo "No existing Cloud Run service image found; deploying backend."
else
  DEPLOYED_SHA="${DEPLOYED_IMG_URL##*:}"

  if [[ "$DEPLOYED_IMG_URL" != "$IMG_PATH":* || ! "$DEPLOYED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Existing Cloud Run image '$DEPLOYED_IMG_URL' does not match expected tagged backend image; deploying backend."
  else
    if ! git cat-file -e "$DEPLOYED_SHA^{commit}" 2>/dev/null; then
      echo "Fetching deployed commit $DEPLOYED_SHA for backend diff check."
      if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
        git fetch --unshallow origin || true
      else
        git fetch origin "$DEPLOYED_SHA" || true
      fi
    fi

    if ! git cat-file -e "$DEPLOYED_SHA^{commit}" 2>/dev/null; then
      echo "Could not find deployed commit $DEPLOYED_SHA locally; deploying backend."
    elif git diff --quiet "$DEPLOYED_SHA" HEAD -- backend; then
      echo "No committed backend changes since deployed commit $DEPLOYED_SHA; skipping Cloud Run deploy."
      exit 0
    else
      echo "Committed backend changes found since deployed commit $DEPLOYED_SHA; deploying backend."
    fi
  fi
fi

cd backend

docker buildx build \
    --cache-to=type=local,dest=/tmp/github-cache/backend \
    --cache-from=type=local,src=/tmp/github-cache/backend \
    .

ARGS=mypy make dockerexecnotty

echo 'ENTRYPOINT [ "make", "server" ]' >>Dockerfile

gcloud config set builds/use_kaniko True
gcloud config set builds/kaniko_cache_ttl 24
IMG_URL="$IMG_PATH":"$(git log -1 --format=format:%H)"
gcloud builds submit --project "${GOOGLE_CLOUD_PROJECT}" --tag "${IMG_URL}"

echo deploy_to_cloud_run $GOOGLE_CLOUD_PROJECT

gcloud beta run deploy "$SERVICE_NAME" \
  --project "${GOOGLE_CLOUD_PROJECT}" \
  --region "${REGION}" \
  --image "${IMG_URL}" \
  --platform managed \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --cpu 2 \
  --memory 3Gi \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 300 \
  --liveness-probe httpGet.path=/health


gcloud container images list-tags "$IMG_PATH" \
  --sort-by=TIMESTAMP \
  --format='get(digest)' \
| head -n -1 \
| xargs -r -I{} \
  gcloud container images delete \
    "$IMG_PATH@{}" \
    --quiet \
    --force-delete-tags

# gsutil -m rm -r "gs://us.artifacts.${GOOGLE_CLOUD_PROJECT}.appspot.com"
# # gcloud beta app repair
