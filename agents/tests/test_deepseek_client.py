"""Offline DeepSeek transport and existing advisor integration contract checks."""

import copy
from email.message import Message
import http.client
import io
import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from agents.deepseek import (DeepSeekClient, DeepSeekError, DeepSeekSettings, ENDPOINT,
                             MAX_RESPONSE_BYTES)
from agents.engine import AdvisorEngine, object_schema
from agents.runtime import AdvisorError, Settings, model_client
from agents.tests.test_advisor import context, evidence


KEY = "test-only-not-a-real-key"
SCHEMA = object_schema({"answer": {"type": "string", "enum": ["Да"]}})


def completion(answer=None, **changes):
    return {"choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": json.dumps(answer if answer is not None else {"answer": "Да"}),
    }}], "usage": {"prompt_tokens": 20, "completion_tokens": 5}, **changes}


def response(result=None, *, raw=None, status=200, content_type="application/json"):
    result = completion() if result is None else result
    raw = json.dumps(result).encode() if raw is None else raw
    fake = MagicMock(status=status)
    fake.headers = Message()
    fake.headers["Content-Type"] = content_type
    fake.read1.side_effect = io.BytesIO(raw).read1
    fake.__enter__.return_value = fake
    return fake


class DeepSeekClientTests(unittest.TestCase):
    def setUp(self):
        self.builder = patch("agents.deepseek.urllib.request.build_opener").start()
        self.addCleanup(patch.stopall)
        self.opener = self.builder.return_value
        self.opener.open.return_value = response()
        self.client = DeepSeekClient(DeepSeekSettings(KEY))

    def call(self, schema=SCHEMA, data=None, role="Ответь по данным."):
        return self.client.call(role, {"condition": "Тест"} if data is None else data, schema)

    def assert_error(self, code):
        with self.assertRaises(DeepSeekError) as caught:
            self.call()
        self.assertEqual(caught.exception.code, code)
        self.assertIsInstance(caught.exception, AdvisorError)
        self.assertNotIn(KEY, str(caught.exception))
        return caught.exception

    def test_construct_and_missing_key_never_connect(self):
        self.assertNotIn(KEY, repr(self.client.settings))
        self.assertNotIn(KEY, repr(self.client))
        self.assertEqual(DeepSeekClient.from_env({"DEEPSEEK_API_KEY": KEY}).settings.model, "deepseek-flash")
        with self.assertRaises(DeepSeekError):
            DeepSeekClient.from_env({"LLM_API_KEY": KEY})
        self.builder.assert_not_called()

    def test_explicit_mode_uses_deepseek_and_blocks_local(self):
        env = {"AI_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": KEY,
               "ADVISOR_LOCAL_MODEL": "must-not-use-local"}
        settings = Settings.for_mode("deepseek", env)
        self.assertIsInstance(model_client(settings), DeepSeekClient)
        self.assertNotIn(KEY, repr(settings))
        self.assertEqual(settings.model, "deepseek-flash")
        with self.assertRaises(AdvisorError):
            Settings.for_mode("local", env)
        with self.assertRaises(AdvisorError):
            Settings.for_mode("deepseek", {"DEEPSEEK_API_KEY": KEY})
        self.assertEqual(Settings.for_mode("rules", env).mode, "rules")
        self.builder.assert_not_called()

    def test_enabled_engine_reports_remote_execution_and_safe_fallback(self):
        settings = Settings.for_mode("deepseek", {"AI_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": KEY})
        self.opener.open.side_effect = [
            response(completion({"candidateIds": ["c1"], "scenarioIds": [], "questionId": None})),
            response(completion({"cautions": {"c1": []}})),
        ]
        result = AdvisorEngine(settings).execute(context())
        self.assertEqual(result["execution"], "deepseek")
        self.assertEqual(result["modelCalls"], 2)
        self.assertNotIn(KEY, json.dumps(result))
        self.opener.open.reset_mock()
        self.opener.open.side_effect = URLError("internal private details")
        result = AdvisorEngine(settings).execute(context())
        self.assertEqual(result["execution"], "rules_fallback")
        self.assertEqual(self.opener.open.call_count, 1)
        self.assertNotIn("internal private", json.dumps(result))

    def test_endpoint_is_official_or_explicit_loopback_fixture(self):
        for endpoint in ("https://example.org", "http://api.deepseek.com", "http://localhost:1234",
                         "https://api.deepseek.com@evil.test", "https://api.deepseek.com/?x=y"):
            with self.subTest(endpoint=endpoint), self.assertRaises(DeepSeekError):
                DeepSeekSettings(KEY, base_url=endpoint)
        settings = DeepSeekSettings.from_env({"DEEPSEEK_API_KEY": KEY, "DEEPSEEK_BASE_URL": "http://127.0.0.1:1234/v1/"})
        self.assertEqual(settings.endpoint, "http://127.0.0.1:1234/v1/chat/completions")
        self.builder.assert_not_called()

    def test_configuration_bounds(self):
        for change in ({"api_key": ""}, {"api_key": "x\ny"}, {"api_key": "секрет"},
                       {"api_key": "x y"}, {"model": ""}, {"model": "x\ny"},
                       {"timeout_seconds": True}, {"timeout_seconds": 0}, {"timeout_seconds": 181},
                       {"max_tokens": 0}, {"max_tokens": 4097}, {"max_tokens": 1.5}):
            with self.subTest(change=change), self.assertRaises(DeepSeekError):
                DeepSeekSettings(**{"api_key": KEY, **change})
        for key in ("DEEPSEEK_TIMEOUT_SECONDS", "DEEPSEEK_MAX_TOKENS"):
            for value in ("nan", "", "-1", "1.5"):
                with self.subTest(key=key, value=value), self.assertRaises(DeepSeekError):
                    DeepSeekSettings.from_env({"DEEPSEEK_API_KEY": KEY, key: value})
        self.builder.assert_not_called()

    def test_request_matches_deepseek_and_existing_call_contract(self):
        schema_before = copy.deepcopy(SCHEMA)
        answer, incoming, outgoing = self.call()
        self.assertEqual((answer, incoming, outgoing), ({"answer": "Да"}, 20, 5))
        request = self.opener.open.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, ENDPOINT)
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + KEY)
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertEqual(payload["max_tokens"], 1200)
        self.assertFalse(payload["stream"])
        self.assertIn("JSON schema", payload["messages"][0]["content"])
        self.assertIn("Да", payload["messages"][0]["content"])
        self.assertEqual(json.loads(payload["messages"][1]["content"]), {"condition": "Тест"})
        self.assertNotIn(KEY, request.data.decode())
        self.assertEqual(self.opener.open.call_args.kwargs["timeout"], 60)
        self.assertEqual(SCHEMA, schema_before)

    def test_http_errors_are_safe_and_never_retry(self):
        for status in (301, 302, 307, 308, 400, 401, 402, 403, 404, 422, 429, 500, 503):
            with self.subTest(status=status):
                self.opener.open.reset_mock()
                body = io.BytesIO(KEY.encode())
                self.opener.open.side_effect = HTTPError(ENDPOINT, status, KEY, {}, body)
                error = self.assert_error("http")
                self.assertEqual(error.http_status, status)
                self.assertEqual(self.opener.open.call_count, 1)
                self.assertTrue(body.closed)
                self.assertTrue(error.__suppress_context__)

    def test_redirect_handler_blocks_forwarding_credentials(self):
        self.call()
        handler = self.builder.call_args.args[0]
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://example.org"))

    def test_network_failures_are_safe_and_never_retry(self):
        for error in (URLError(KEY), TimeoutError(KEY), OSError(KEY),
                      http.client.IncompleteRead(KEY.encode(), 100), http.client.BadStatusLine(KEY)):
            with self.subTest(error=type(error).__name__):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = error
                self.assert_error("network")
                self.assertEqual(self.opener.open.call_count, 1)

    def test_bad_http_or_content_type(self):
        for status, kind, code in ((204, "application/json", "http"), (200, "text/html", "response_contract")):
            with self.subTest(status=status):
                fake = response(status=status, content_type=kind)
                self.opener.open.return_value = fake
                self.assert_error(code)
                fake.read1.assert_not_called()
                fake.__exit__.assert_called_once()

    def test_response_byte_limit(self):
        fake = response(raw=b" " * (MAX_RESPONSE_BYTES + 1))
        self.opener.open.return_value = fake
        self.assert_error("response_limit")
        self.assertEqual(sum(call.args[0] for call in fake.read1.call_args_list), MAX_RESPONSE_BYTES + 1)

    def test_blank_keepalive_and_elapsed_timeout(self):
        self.opener.open.return_value = response(raw=b"\n \n" + json.dumps(completion()).encode())
        self.assertEqual(self.call()[0], {"answer": "Да"})
        fake = response()
        fake.read1.side_effect = [b"\n", b"\n"]
        self.opener.open.return_value = fake
        with patch("agents.deepseek.time.monotonic", side_effect=[0, 1, 61]):
            self.assert_error("network")
        self.assertEqual(fake.read1.call_count, 1)
        fake.__exit__.assert_called_once()

    def test_invalid_envelopes(self):
        invalid = [b"not json", b"\xff", b"[]", b"null", b'{"choices":null}', b'{"choices":[]}',
                   json.dumps(completion(choices=[None])).encode(),
                   json.dumps(completion(choices=[{}, {}])).encode(),
                   b'{"choices":[],"choices":[]}']
        for raw in invalid:
            with self.subTest(raw=raw):
                self.opener.open.return_value = response(raw=raw)
                self.assert_error("response_contract")

    def test_incomplete_answers_are_not_accepted(self):
        for reason in ("length", "tool_calls", "content_filter", "insufficient_system_resource", "aborted", None):
            with self.subTest(reason=reason):
                result = completion()
                result["choices"][0]["finish_reason"] = reason
                self.opener.open.return_value = response(result)
                self.assert_error("incomplete")

    def test_content_must_be_a_complete_object_matching_schema(self):
        for content in (None, "", " ", "[]", "null", "```json\n{}\n```", "{}", '{"answer":null}',
                        '{"answer":"Unknown ID"}', '{"answer":"Да","extra":"private"}',
                        '{"answer":"Да","answer":"Да"}', '{"answer":NaN}'):
            with self.subTest(content=content):
                result = completion()
                result["choices"][0]["message"]["content"] = content
                self.opener.open.return_value = response(result)
                self.assert_error("response_contract")

    def test_response_role_and_tool_calls(self):
        for change in ({"role": "user"}, {"tool_calls": [{"id": "unexpected"}]}):
            with self.subTest(change=change):
                result = completion()
                result["choices"][0]["message"].update(change)
                self.opener.open.return_value = response(result)
                self.assert_error("response_contract")

    def test_answer_limit_and_reasoning_is_not_returned(self):
        self.opener.open.return_value = response(completion({"answer": "x" * 13_000}))
        self.assert_error("response_limit")
        result = completion()
        result["choices"][0]["message"]["reasoning_content"] = "not final answer"
        self.opener.open.return_value = response(result)
        self.assertEqual(self.call()[0], {"answer": "Да"})

    def test_invalid_usage_is_unknown_not_zero(self):
        for usage in (None, [], {}, {"prompt_tokens": True, "completion_tokens": -1},
                      {"prompt_tokens": "20", "completion_tokens": 10_000_001}):
            with self.subTest(usage=usage):
                self.opener.open.return_value = response(completion(usage=usage))
                self.assertEqual(self.call()[1:], (-1, -1))
        self.opener.open.return_value = response(completion(usage={"prompt_tokens": 0, "completion_tokens": 0}))
        self.assertEqual(self.call()[1:], (0, 0))

    def test_bad_input_is_rejected_before_network(self):
        for data in ([], {"value": float("nan")}, {"value": object()}, {"value": "\ud800"}):
            with self.subTest(data=data), self.assertRaises(DeepSeekError):
                self.call(data=data)
        with self.assertRaises(DeepSeekError):
            self.call(data={"value": "x" * 24_001})
        with self.assertRaises(DeepSeekError):
            self.call(role="x" * (64 * 1024))
        self.builder.assert_not_called()

    def test_unsupported_or_malformed_schema_fails_before_network(self):
        schemas = [{}, {"type": "object", "patternProperties": {}}, {"type": "array"},
                   {"type": "object", "required": ["missing"]}, {"type": "object", "additionalProperties": {}},
                   {"type": "string", "minLength": 1}, {"type": ["object", "null"]}]
        schemas += [object_schema({"field": s}) for s in (
            {"type": "array", "items": {"type": "string"}, "maxItems": None},
            {"type": "array", "items": {"type": "string"}, "minItems": True},
            {"type": "string", "enum": [1]}, {"anyOf": []},
            {"anyOf": [{"type": "null"}], "type": "object"}, {"type": "number"})]
        for schema in schemas:
            with self.subTest(schema=schema), self.assertRaises(DeepSeekError) as error:
                self.call(schema=schema)
            self.assertEqual(error.exception.code, "input_contract")
        self.builder.assert_not_called()

    def test_array_and_nullable_ids(self):
        schema = object_schema({"ids": {"type": "array", "items": {"type": "string", "enum": ["c1"]},
                                        "minItems": 1, "maxItems": 2},
                                "question": {"anyOf": [{"type": "null"}, {"type": "string", "enum": ["q1"]}]}})
        for answer in ({"ids": ["c1"], "question": None}, {"ids": ["c1"], "question": "q1"}):
            self.opener.open.return_value = response(completion(answer))
            self.assertEqual(self.call(schema=schema)[0], answer)
        for answer in ({"ids": [], "question": None}, {"ids": ["c2"], "question": None},
                       {"ids": ["c1"] * 3, "question": None}, {"ids": ["c1"], "question": 1}):
            self.opener.open.return_value = response(completion(answer))
            with self.assertRaises(DeepSeekError):
                self.call(schema=schema)

    def test_existing_selector_and_critic_schemas_with_dependency_injection(self):
        self.opener.open.side_effect = [
            response(completion({"candidateIds": ["c1"], "scenarioIds": [], "questionId": "q1"})),
            response(completion({"cautions": {"c1": ["e1"]}})),
        ]
        original = context()
        original["candidates"][0]["criteria"] = [evidence(evidenceStatus="unknown", assumed=True)]
        before = copy.deepcopy(original)
        # This explicitly injected test is not a production mode selector.
        engine = AdvisorEngine(Settings("local", self.client.settings.model), model=self.client)
        result = engine.execute(original)
        self.assertEqual(result["modelCalls"], 2)
        self.assertEqual((result["inputTokens"], result["outputTokens"]), (40, 10))
        self.assertEqual(result["execution"], "local")
        self.assertEqual(original, before)
        self.assertEqual([d["status"] for d in result["diagnostics"]], ["completed", "completed"])
        self.assertNotIn(KEY, json.dumps(result))

    def test_existing_engine_falls_back_without_retry(self):
        self.opener.open.return_value = response(completion({"candidateIds": ["invented"]}))
        result = AdvisorEngine(Settings("local", "test"), model=self.client).execute(context())
        self.assertEqual(result["execution"], "rules_fallback")
        self.assertEqual(result["modelCalls"], 1)
        self.assertEqual(self.opener.open.call_count, 1)

    def test_main_location_criteria_keep_unknown_status_and_original_reference(self):
        original = context()
        original["candidates"][0]["criteria"].append(evidence(
            identifier="room1::location-near-park", feature="location",
            status="mismatch", evidenceStatus="unknown", assumed=False, required=False,
        ))
        before = copy.deepcopy(original)
        self.opener.open.side_effect = [
            response(completion({"candidateIds": ["c1"], "scenarioIds": [], "questionId": None})),
            response(completion({"cautions": {"c1": ["e2"]}})),
        ]
        result = AdvisorEngine(Settings("local", "test"), model=self.client).execute(original)
        self.assertEqual(result["execution"], "local")
        self.assertEqual(result["modelCalls"], 2)
        selector = result["diagnostics"][0]
        location = selector["input"]["candidates"][0]["criteria"][1]
        self.assertEqual(location["feature"], "location")
        self.assertEqual(location["evidenceStatus"], "unknown")
        self.assertEqual(selector["references"]["evidence"]["e2"], ["c1", "room1::location-near-park"])
        self.assertEqual(result["diagnostics"][1]["output"], {"cautions": {"c1": ["e2"]}})
        self.assertEqual(result["diagnostics"][1]["status"], "completed")
        self.assertEqual(original, before)

    def test_rules_mode_with_injected_client_does_not_connect(self):
        result = AdvisorEngine(Settings("rules"), model=self.client).execute(context())
        self.assertEqual(result["modelCalls"], 0)
        self.builder.assert_not_called()


if __name__ == "__main__":
    unittest.main()
