"""JSONL subprocess boundary for the Java backend, without shell or network tools."""

import json
import sys

from .engine import AdvisorEngine
from .runtime import AdvisorError, Settings


def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        line = sys.stdin.buffer.readline(512 * 1024 + 1)
        if len(line) > 512 * 1024:
            raise AdvisorError("Контекст советника слишком большой.")
        request = json.loads(line)
        if not isinstance(request, dict):
            raise AdvisorError("Ожидается JSON-объект.")
        settings = Settings.for_mode(request.get("mode", "rules"))
        engine = AdvisorEngine(settings, progress=lambda data: emit("progress", data=data))
        emit("result", data=engine.execute(request.get("context")))
        return 0
    except AdvisorError as error:
        emit("error", message=str(error))
    except (ValueError, TypeError, KeyError):
        emit("error", message="Некорректные данные советника.")
    except Exception:
        emit("error", message="Не удалось выполнить разбор. Проверьте настройку локального советника.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
