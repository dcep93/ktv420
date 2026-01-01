from pydantic import BaseModel

from . import manager


class Request(BaseModel):
    mp3_path: str
    output_path: str


class Response(BaseModel):
    pass


Manager = manager.Manager[Request, Response]


def run_job(request: Request) -> Response:
    return Response()
