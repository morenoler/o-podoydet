"""One explicit DeepSeek API request; Python 3.11+, standard library only.

Run: python -X utf8 scripts/test-deepseek.py --ask-key
Docs: https://api-docs.deepseek.com/api/create-chat-completion/
No application data, .env files, or conversation history are loaded.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ENDPOINT = "https://api.deepseek.com/chat/completions"
MAX_RESPONSE_BYTES = 1024 * 1024
HTTP_HINTS = {
    400: "Проверьте формат запроса и название модели.",
    401: "Ключ API не принят. Проверьте DEEPSEEK_API_KEY.",
    402: "Недостаточно средств на балансе DeepSeek API.",
    403: "Доступ к API запрещён.",
    404: "Не найден endpoint или указанная модель.",
    422: "Проверьте параметры запроса.",
    429: "Достигнут лимит запросов. Повторите запуск позже.",
    500: "Ошибка сервера DeepSeek. Повторите запуск позже.",
    503: "DeepSeek перегружен. Повторите запуск позже.",
}


class ApiTestError(Exception):
    """Safe diagnostic that never contains credentials or raw error bodies."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def bounded_int(minimum, maximum):
    def parse(value):
        try:
            number = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError("Нужно целое число.") from None
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"Допустимо от {minimum} до {maximum}.")
        return number
    return parse


def arguments(argv=None):
    parser = argparse.ArgumentParser(description="Один тестовый запрос к DeepSeek API.")
    parser.add_argument("--model", default=os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
                        help="Модель (по умолчанию DEEPSEEK_MODEL или deepseek-flash).")
    parser.add_argument("--prompt", default="Коротко по-русски подтверди, что тестовый запрос получен.")
    parser.add_argument("--json", action="store_true", help="Запросить и проверить JSON с полем answer.")
    parser.add_argument("--ask-key", action="store_true", help="Ввести ключ скрыто вместо переменной окружения.")
    parser.add_argument("--dry-run", action="store_true", help="Показать запрос без сети и без ключа.")
    parser.add_argument("--timeout", type=bounded_int(1, 180), default=60,
                        help="Тайм-аут сетевых операций в секундах (по умолчанию 60).")
    parser.add_argument("--max-tokens", type=bounded_int(1, 4096), default=256,
                        help="Лимит выходных токенов (по умолчанию 256).")
    args = parser.parse_args(argv)
    if not args.model.strip() or len(args.model) > 128:
        parser.error("Название модели должно содержать от 1 до 128 символов.")
    if not args.prompt.strip() or len(args.prompt) > 8000:
        parser.error("Запрос должен содержать от 1 до 8000 символов.")
    return args


def make_payload(args):
    system = "Отвечай кратко по-русски. Это техническая проверка API."
    if args.json:
        system += ' Верни только JSON вида {"answer":"твой ответ"}, без других полей и Markdown.'
    return {
        "model": args.model.strip(),
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": args.prompt}],
        "thinking": {"type": "disabled"},
        "temperature": 0,
        "stream": False,
        "max_tokens": args.max_tokens,
        "response_format": {"type": "json_object" if args.json else "text"},
    }


def request_completion(payload, api_key, timeout):
    request = Request(ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                      headers={"Content-Type": "application/json", "Accept": "application/json",
                               "Authorization": "Bearer " + api_key}, method="POST")
    try:
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            if response.status != 200:
                raise ApiTestError(f"Неожиданный HTTP-статус: {response.status}.")
            if response.headers.get_content_type() != "application/json":
                raise ApiTestError("Сервер вернул не JSON.")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ApiTestError("Ответ превышает лимит 1 МиБ.")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ApiTestError("Ответ API должен быть JSON-объектом.")
        return result
    except HTTPError as error:
        code = error.code
        error.close()
        raise ApiTestError(f"HTTP {code}: {HTTP_HINTS.get(code, 'Запрос отклонён; повторов нет.')}") from None
    except (URLError, TimeoutError, OSError):
        raise ApiTestError("Ошибка соединения, TLS или тайм-аут. Проверьте интернет и настройки прокси.") from None
    except (ValueError, UnicodeError):
        raise ApiTestError("Сервер вернул некорректный JSON.") from None


def validate_answer(result, json_mode):
    try:
        choice = result["choices"][0]
        reason = choice["finish_reason"]
        if reason == "length":
            raise ApiTestError("Ответ обрезан лимитом токенов. Увеличьте --max-tokens.")
        if reason != "stop":
            raise ApiTestError("API не завершил обычный ответ (finish_reason отличается от stop).")
        content = choice["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ApiTestError("API вернул пустой или нетекстовый ответ.")
        if json_mode:
            parsed = json.loads(content)
            if (not isinstance(parsed, dict) or set(parsed) != {"answer"}
                    or not isinstance(parsed["answer"], str) or not parsed["answer"].strip()):
                raise ApiTestError('Ожидался JSON с единственным непустым строковым полем "answer".')
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        return content
    except (KeyError, IndexError, TypeError, ValueError):
        raise ApiTestError("Ответ не соответствует контракту Chat Completions или запрошенному JSON.") from None


def show_usage(result):
    usage = result.get("usage")
    usage = usage if isinstance(usage, dict) else {}
    parts = []
    for key, label in (("prompt_tokens", "вход"), ("completion_tokens", "выход"), ("total_tokens", "всего")):
        count = usage.get(key)
        parts.append(f"{label}: {count if type(count) is int and count >= 0 else 'неизвестно'}")
    print("Токены по данным API: " + ", ".join(parts))


def main(argv=None):
    args = arguments(argv)
    payload = make_payload(args)
    if args.dry_run:
        print(f"POST {ENDPOINT}\n" + json.dumps(payload, ensure_ascii=False, indent=2))
        print("Проверка без сети: запрос не отправлен, ключ не читался.")
        return 0
    try:
        api_key = (getpass.getpass("DeepSeek API key (ввод скрыт): ") if args.ask_key
                   else os.environ.get("DEEPSEEK_API_KEY", "")).strip()
        if not api_key:
            raise ApiTestError("Задайте DEEPSEEK_API_KEY или запустите с --ask-key. Файл .env не читается.")
        if any(not 33 <= ord(char) <= 126 for char in api_key):
            raise ApiTestError("Ключ содержит пробелы или недопустимые символы.")
        print(f"Модель: {payload['model']}. Один запрос, лимит выхода: {args.max_tokens} токенов.", flush=True)
        started = time.perf_counter()
        result = request_completion(payload, api_key, args.timeout)
        print(f"Время запроса: {time.perf_counter() - started:.2f} с")
        show_usage(result)
        answer = validate_answer(result, args.json)
        print("Ответ:\n" + answer.replace(api_key, "[ключ скрыт]"))
        print("Проверка формата ответа пройдена.")
        return 0
    except (ApiTestError, EOFError) as error:
        print(f"Ошибка: {error or 'Не удалось прочитать ключ.'}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nПроверка прервана.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
