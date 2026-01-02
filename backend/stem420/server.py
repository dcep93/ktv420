import json
import os
import time
import traceback
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Response  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from . import logger
from . import run_job

NUM_WORKERS = 1


@dataclass
class ServerState:
    start_time: float = field(default_factory=time.time)
    manager: run_job.Manager | None = None
    health: int = 0
    sha: Any | None = None

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self.start_time


state = ServerState()


def _load_sha_metadata() -> Any:
    sha_path = os.path.join(os.path.dirname(__file__), "sha.json")
    with open(sha_path) as fh:
        return json.load(fh)


def _build_manager() -> run_job.Manager:
    return run_job.Manager(lambda: run_job.run_job, NUM_WORKERS)


def init() -> None:
    state.sha = _load_sha_metadata()
    state.manager = _build_manager()


web_app = FastAPI()
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@web_app.on_event("shutdown")
def shutdown() -> None:
    if state.manager:
        state.manager.close()


@web_app.get("/")
def get_root() -> JSONResponse:
    uptime_seconds = state.uptime_seconds
    status_code = 200
    content = {
        "health_count": state.health,
        "alive_age_s": uptime_seconds,
        "alive_age_h": uptime_seconds / 3600,
        "status_code": status_code,
        "sha": state.sha,
        "run_job": run_job.get_state(),
    }
    return JSONResponse(status_code=status_code, content=content)


@web_app.get("/health")
def get_health() -> JSONResponse:
    state.health += 1
    rval = get_root()
    logger.log(bytes(rval.body).decode("utf-8"))
    return rval


@web_app.get("/start_time")
def get_start_time() -> Response:
    return Response(str(state.start_time))


@web_app.post("/run_job")
def post_run_job(payload: run_job.Request) -> JSONResponse:
    logger.log("server.receive")
    try:
        if not state.manager:
            raise RuntimeError("server not initialized")

        screenshot_response = state.manager.run(payload)
        resp = screenshot_response.model_dump()
        logger.log("server.respond")
        return JSONResponse(resp)
    except Exception:
        err = traceback.format_exc()
        return JSONResponse({"err": err}, 500)
