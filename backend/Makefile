service_name=first2know
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

oneoff:
	python3 -u -m first2know.oneoff

server:
	uvicorn app:app --loop asyncio --host 0.0.0.0 --port $${PORT:-8080}

cron:
	python3 -u -m first2know.cron

mypy:
	mypy first2know --disallow-untyped-defs

test:
	python3 -m unittest first2know.test

test_single:
	python3 -m unittest first2know.test.TestFirst2Know.test_fetch_wrapped

list:  # Meta target to list other targets.
	@$(MAKE) -pRrq -f $(THIS_FILE) : 2>/dev/null | awk -v RS= -F: '/^# File/,/^# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | egrep -v -e '^[^[:alnum:]]' -e '^$@$$' | xargs
