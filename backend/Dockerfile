FROM debian:12

WORKDIR /var/www

RUN apt-get update

RUN apt install -y curl git python-is-python3 python3-pip python3.11-venv

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --upgrade pip

# Prefer lightweight CPU wheels for PyTorch to reduce image size and memory usage
ENV PIP_EXTRA_INDEX_URL="https://download.pytorch.org/whl/cpu"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./
