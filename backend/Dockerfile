FROM python:3.11-slim AS builder

WORKDIR /var/www

# Prefer lightweight CPU wheels for PyTorch to reduce image size and memory usage
ENV PIP_EXTRA_INDEX_URL="https://download.pytorch.org/whl/cpu"
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_NO_CACHE_DIR=1
ENV PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir --no-compile -r requirements.txt

FROM python:3.11-slim

WORKDIR /var/www

ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY . ./
