"""Optional local-model transport. No remote-provider mode or API credentials."""

from __future__ import annotations

import ipaddress
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


class AdvisorError(Exception):
    """Safe user-facing failure, without provider response bodies or credentials."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def usage_count(value) -> int:
    """Provider metadata is advisory; invalid values must not break the Java contract."""
    return value if type(value) is int and 0 <= value <= 10_000_000 else -1


@dataclass(frozen=True)
class Settings:
    mode: str
    model: str = ""
    endpoint: str = ""

    @classmethod
    def for_mode(cls, mode: str, env=None):
        env = os.environ if env is None else env
        if mode == "rules":
            return cls(mode)
        if mode != "local":
            raise AdvisorError("Поддерживаются только бесплатные режимы: правила и локальная модель.")
        model = env.get("ADVISOR_LOCAL_MODEL", "").strip()
        base = env.get("ADVISOR_LOCAL_BASE_URL", "http://127.0.0.1:11434/v1").strip()
        if not model or "cloud" in model.lower():
            raise AdvisorError("Задайте локальную модель ADVISOR_LOCAL_MODEL без cloud.")
        try:
            url = urllib.parse.urlsplit(base)
            if url.hostname not in ("127.0.0.1", "localhost", "::1") or url.scheme not in ("http", "https"):
                raise ValueError()
            if url.username or url.password or url.query or url.fragment:
                raise ValueError()
            port = url.port or (443 if url.scheme == "https" else 80)
            addresses = socket.getaddrinfo(url.hostname, port, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(address[4][0]).is_loopback for address in addresses):
                raise ValueError()
        except (ValueError, OSError):
            raise AdvisorError("Локальная модель должна быть доступна только по loopback-адресу.") from None
        return cls(mode, model, base.rstrip("/") + "/chat/completions")


class ModelClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def call(self, role: str, data: dict, schema: dict) -> tuple[dict, int, int]:
        content = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(content) > 24_000:
            raise AdvisorError("Превышен лимит контекста локальной модели.")
        payload = {
            "model": self.settings.model, "stream": False, "max_tokens": 1200,
            "temperature": 0,
            "messages": [{"role": "system", "content": role}, {"role": "user", "content": content}],
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "advisor_result", "strict": True, "schema": schema,
            }},
        }
        request = urllib.request.Request(self.settings.endpoint,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            {"Content-Type": "application/json"}, method="POST")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(request, timeout=180) as response:
                raw = response.read(128 * 1024 + 1)
                if len(raw) > 128 * 1024:
                    raise AdvisorError("Ответ локальной модели превышает допустимый размер.")
                result = json.loads(raw)
            choice = result["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise AdvisorError("Локальная модель не завершила структурированный ответ.")
            answer = json.loads(choice["message"]["content"])
            if not isinstance(answer, dict):
                raise ValueError()
            usage = result.get("usage", {})
            if not isinstance(usage, dict):
                usage = {}
            incoming = usage_count(usage.get("prompt_tokens"))
            outgoing = usage_count(usage.get("completion_tokens"))
            return answer, incoming, outgoing
        except urllib.error.HTTPError as error:
            raise AdvisorError(f"Локальная модель вернула HTTP {error.code}.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise AdvisorError("Локальная модель недоступна или превышено время ожидания.") from None
        except (ValueError, UnicodeError, TypeError, KeyError, IndexError, AttributeError):
            raise AdvisorError("Ответ локальной модели не соответствует контракту.") from None
