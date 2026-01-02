service_name=ktv420
local_image_tag=$(service_name):latest

THIS_FILE := $(lastword $(MAKEFILE_LIST))

dockerbuild:
	docker buildx build --load --output=type=docker -t $(local_image_tag) .

# ARGS=test make dockerexec

dockerexecnotty: dockerbuild
	docker run \
		--rm \
		--name $(service_name) \
		$(local_image_tag) \
		make $(ARGS)

dockerexec: dockerbuild
	docker run \
		--rm \
		-it \
		--name $(service_name) \
		$(local_image_tag) \
		make $(ARGS)

server:
	uvicorn app:app --loop asyncio --host 0.0.0.0 --port $${PORT:-8080}

mypy:
	mypy ktv420 --disallow-untyped-defs

oneoff:
	python3 -u -m ktv420.oneoff

list:  # Meta target to list other targets.
	@$(MAKE) -pRrq -f $(THIS_FILE) : 2>/dev/null | awk -v RS= -F: '/^# File/,/^# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | egrep -v -e '^[^[:alnum:]]' -e '^$@$$' | xargs
