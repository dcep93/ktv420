import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def log(msg: str) -> None:
    logger.info(msg)
