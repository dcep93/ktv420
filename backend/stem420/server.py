import json
import os
import time
import traceback
import typing

from fastapi import FastAPI, Response  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from . import logger
from . import run_job

NUM_WORKERS = 1


class Vars:
    start_time = time.time()
    manager: run_job.Manager
    health = 0
    sha: typing.Any


def init() -> None:
    with open(
        os.path.join(
            os.path.dirname(__file__),
            "sha.json",
        )
    ) as fh:
        Vars.sha = json.load(fh)

    Vars.manager = run_job.Manager(
        lambda: run_job.run_job,
        NUM_WORKERS,
    )


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
    Vars.manager.close()


@web_app.get("/")
def get_() -> JSONResponse:
    now = time.time()
    alive_age_s = now - Vars.start_time
    status_code = 200
    content = {
        "health_count": Vars.health,
        "alive_age_s": alive_age_s,
        "alive_age_h": alive_age_s / 3600,
        "status_code": status_code,
        "sha": Vars.sha,
    }
    return JSONResponse(
        status_code=status_code,
        content=content,
    )


@web_app.get("/health")
def get_health() -> JSONResponse:
    Vars.health += 1
    rval = get_()
    logger.log(bytes(rval.body).decode("utf-8"))
    return rval


@web_app.get("/start_time")
def get_start_time() -> Response:
    return Response(Vars.start_time)


@web_app.post("/run_job")
def post_run_job(payload: run_job.Request) -> JSONResponse:
    logger.log("server.receive")
    try:
        screenshot_response = Vars.manager.run(payload)
        resp = screenshot_response.model_dump()
        logger.log("server.respond")
        return JSONResponse(resp)
    except Exception:
        err = traceback.format_exc()
        return JSONResponse({"err": err}, 500)
