"""Offline protocol/error checks: no credentials or real provider calls."""
import contextlib
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location("deepseek_probe", Path(__file__).parents[1] / "test-deepseek.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def completion(content="Тест получен.", reason="stop"):
    return {"choices": [{"finish_reason": reason, "message": {"content": content}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}}


class DeepSeekProbeTest(unittest.TestCase):
    def test_missing_key_and_dry_run_never_connect(self):
        with patch.dict(module.os.environ, {}, clear=True), patch.object(module, "build_opener") as connect:
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                self.assertEqual(module.main([]), 1)
            self.assertIn("DEEPSEEK_API_KEY", errors.getvalue())
            with patch.object(module.getpass, "getpass") as ask, contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(module.main(["--dry-run", "--json", "--ask-key"]), 0)
                ask.assert_not_called()
                self.assertIn('"json_object"', output.getvalue())
            connect.assert_not_called()

    def test_request_and_success_output(self):
        response = MagicMock()
        response.status = 200
        response.headers = Message()
        response.headers["Content-Type"] = "application/json; charset=utf-8"
        response.read.return_value = json.dumps(completion('{"answer":"Получено."}')).encode()
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.dict(module.os.environ, {"DEEPSEEK_API_KEY": "test-only-key"}, clear=True), \
                patch.object(module, "build_opener", return_value=opener), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(module.main(["--json", "--prompt", "Привет", "--timeout", "7"]), 0)
        request = opener.open.call_args.args[0]
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(request.full_url, "https://api.deepseek.com/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-key")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 7)
        body = json.loads(request.data)
        self.assertEqual(body["messages"][1]["content"], "Привет")
        self.assertEqual(body["thinking"], {"type": "disabled"})
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertEqual(body["max_tokens"], 256)
        self.assertIn("всего: 25", output.getvalue())
        self.assertNotIn("test-only-key", output.getvalue())

    def test_provider_errors_are_safe_and_not_retried(self):
        for code in (301, 401, 402, 429, 503):
            with self.subTest(code=code):
                opener = MagicMock()
                opener.open.side_effect = HTTPError(module.ENDPOINT, code, "secret", {}, io.BytesIO(b"secret"))
                with patch.object(module, "build_opener", return_value=opener):
                    with self.assertRaises(module.ApiTestError) as caught:
                        module.request_completion({}, "secret", 2)
                self.assertIn(str(code), str(caught.exception))
                self.assertNotIn("secret", str(caught.exception))
                self.assertEqual(opener.open.call_count, 1)
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.org"))

    def test_network_failure(self):
        with patch.object(module, "build_opener") as build:
            build.return_value.open.side_effect = URLError("private diagnostic")
            with self.assertRaises(module.ApiTestError) as caught:
                module.request_completion({}, "test-only-key", 1)
        self.assertNotIn("private diagnostic", str(caught.exception))

    def test_rejects_bad_http_body(self):
        for content_type, body in (("text/html", b"<html>bad gateway</html>"),
                                   ("application/json", b"not JSON"),
                                   ("application/json", b"[]"),
                                   ("application/json", b" " * (module.MAX_RESPONSE_BYTES + 1))):
            with self.subTest(content_type=content_type, size=len(body)):
                response = MagicMock(status=200)
                response.headers = Message()
                response.headers["Content-Type"] = content_type
                response.read.return_value = body
                with patch.object(module, "build_opener") as build:
                    build.return_value.open.return_value.__enter__.return_value = response
                    with self.assertRaises(module.ApiTestError):
                        module.request_completion({}, "test-only-key", 1)

    def test_answer_validation(self):
        self.assertEqual(module.validate_answer(completion(), False), "Тест получен.")
        self.assertEqual(json.loads(module.validate_answer(completion('{"answer":"Да"}'), True)), {"answer": "Да"})
        invalid = [({}, False), ({"choices": None}, False), (completion("", "stop"), False),
                   (completion("x", "content_filter"), False), (completion(None), False)]
        invalid += [(completion(content), True) for content in (
            "not json", "[]", '{"answer":null}', '{"answer":""}', '{"answer":"Да","extra":1}')]
        for result, json_mode in invalid:
            with self.subTest(result=result), self.assertRaises(module.ApiTestError):
                module.validate_answer(result, json_mode)

    def test_truncated_answer_fails_but_reports_usage(self):
        with patch.dict(module.os.environ, {"DEEPSEEK_API_KEY": "test-only-key"}, clear=True), \
                patch.object(module, "request_completion", return_value=completion("partial", "length")), \
                contextlib.redirect_stdout(io.StringIO()) as output, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(module.main([]), 1)
        self.assertIn("всего: 25", output.getvalue())
        self.assertIn("--max-tokens", errors.getvalue())
        self.assertNotIn("пройдена", output.getvalue())

    def test_unknown_usage_is_not_zero(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            module.show_usage({"usage": {"prompt_tokens": True, "completion_tokens": -1}})
        self.assertEqual(output.getvalue().count("неизвестно"), 3)

    def test_cli_rejects_unbounded_input(self):
        for args in (["--timeout", "0"], ["--max-tokens", "5000"], ["--prompt", " "], ["--model", ""]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                module.arguments(args)
            self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
