import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class Vars:
    all_logs: list[str] = []


def log(msg: str) -> None:
    Vars.all_logs.append(msg)
    logger.info(msg)
