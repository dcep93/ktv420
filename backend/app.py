import sys

from ktv420 import logger, server

logger.log(f"app.init {sys.argv}")

server.init()

app = server.web_app
