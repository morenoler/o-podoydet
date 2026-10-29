"""Real PostgreSQL isolation for HTTP smoke scripts (stdlib, no SQLite fallback).

TEST_DATABASE_URL/USER/PASSWORD selects a pre-existing test server. Otherwise the
project Compose database is started. Each invocation uses an unguessable schema;
credentials are not written to reports. Schemas are retained for diagnosis, with
names recorded in the ignored run directory. No application schema is modified.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def isolated_postgres(label: str) -> dict[str, str]:
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,24}", label):
        raise ValueError("Invalid test schema label")
    supplied = os.environ.get("TEST_DATABASE_URL")
    if supplied:
        url = supplied
        user = os.environ.get("TEST_DATABASE_USER", "test")
        password = os.environ.get("TEST_DATABASE_PASSWORD", "test")
    else:
        subprocess.run(["docker", "compose", "up", "-d", "--wait", "db"],
                       cwd=ROOT, check=True, creationflags=FLAGS, timeout=120)
        # Compose also reads .env itself: inspect the actual binding instead of
        # assuming Python inherited POSTGRES_PORT from the calling shell.
        binding = subprocess.run(["docker", "compose", "port", "db", "5432"],
                                 cwd=ROOT, check=True, creationflags=FLAGS, timeout=30,
                                 capture_output=True, text=True).stdout.strip()
        port = binding.rpartition(":")[2]
        if not port.isdecimal() or not 1 <= int(port) <= 65535:
            raise ValueError("Compose did not publish a valid PostgreSQL port")
        url = f"jdbc:postgresql://127.0.0.1:{port}/opodoydet"
        user = password = "opodoydet"
    if not url.startswith("jdbc:postgresql://"):
        raise ValueError("TEST_DATABASE_URL must be a real PostgreSQL JDBC URL")
    schema = "http_" + label + "_" + uuid.uuid4().hex
    parsed = urlsplit(url[5:])
    query = [(key, value) for key, value in parse_qsl(parsed.query) if key != "currentSchema"]
    query.append(("currentSchema", schema))
    url = "jdbc:" + urlunsplit(parsed._replace(query=urlencode(query)))
    return {"DATABASE_URL": url, "DATABASE_USER": user, "DATABASE_PASSWORD": password,
            "DB_SCHEMA": schema, "LEGACY_DB_PATH": "",
            "DEMO_SEED_PATH": "", "DEMO_MODE": "false"}
