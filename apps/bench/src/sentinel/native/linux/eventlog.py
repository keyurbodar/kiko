import json
import time


class EventLog:
    def __init__(self, path):
        self.file = open(path, "a", buffering=1) if path else None

    def emit(self, event, **extra):
        if self.file is None:
            return
        line = {"ev": event, "t": time.time() * 1000}
        line.update(extra)
        self.file.write(json.dumps(line) + "\n")
