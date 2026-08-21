#!/usr/bin/env python3
"""Redact credentials and tenant identifiers from relay subprocess stderr."""

from __future__ import annotations

import re
import sys


URL = re.compile(r"((?:rtmps?|rtsp|https?)://[^/\s]+)(?:/[^\s]*)?", re.I)
UUID = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.I,
)
NAMED_SECRET = re.compile(r"\b(token|key|secret|password)=\S+", re.I)


for raw_line in sys.stdin:
    line = URL.sub(r"\1/[redacted]", raw_line)
    line = UUID.sub("[tenant]", line)
    line = NAMED_SECRET.sub(r"\1=[redacted]", line)
    sys.stdout.write(line)
    sys.stdout.flush()
