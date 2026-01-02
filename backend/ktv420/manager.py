import queue
import threading
import typing

T = typing.TypeVar("T")
U = typing.TypeVar("U")


class Manager(typing.Generic[T, U]):

    init_lock = threading.Lock()

    def __init__(
        self,
        f: typing.Callable[[], typing.Callable[[T], U]],
        num: int,
    ):
        self.f = f
        self.num = num
        self.request_queue = queue.Queue(self.num)  # type: ignore
        self.response_queues = queue.Queue(self.num)  # type: ignore
        for _ in range(self.num):
            threading.Thread(target=self.init_runner, daemon=True).start()
        for _ in range(self.num):
            err = self.response_queues.get()
            if err is not None:
                raise err
        for _ in range(self.num):
            self.response_queues.put_nowait(queue.Queue(1))

    def close(self) -> None:
        for _ in range(self.num):
            self.request_queue.put_nowait((None, None))

    def init_runner(self) -> None:
        with self.init_lock:
            try:
                runner = self.f()
            except Exception as e:
                self.response_queues.put(e)
                return
        self.response_queues.put(None)
        while True:
            _request, register = self.request_queue.get()
            if register is None:
                break
            request: T = _request
            try:
                response: U = runner(request)
            except Exception as e:
                register.put((e, False))
                continue
            register.put((response, True))

    def run(self, request: T) -> U:
        register = self.response_queues.get()
        self.request_queue.put_nowait((request, register))
        (response, is_successful) = register.get()
        self.response_queues.put_nowait(register)
        if not is_successful:
            raise response
        return response
