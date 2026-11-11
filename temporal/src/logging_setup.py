"""Single-line structured logs (AGENTS.md) with secret redaction."""
from __future__ import annotations
import logging
import re

from .config import Settings

_STD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime", "taskName"}
_PATTERNS = [
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+"),
    re.compile(r"\b(tvly-)[A-Za-z0-9_\-]+"),
    re.compile(r"\b((?:AKIA|ASIA))[A-Z0-9]{12,}"),
    re.compile(r"(apikey[\"'=:\s]+)[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
]


class RedactFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self._secrets = [s for s in secrets if s and len(s) >= 8]

    def redact(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret, "***")
        for pattern in _PATTERNS:
            text = pattern.sub(lambda m: m.group(1) + "***", text)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.redact(record.getMessage())
        record.args = None
        for key, value in list(vars(record).items()):
            if key not in _STD_ATTRS and isinstance(value, str):
                setattr(record, key, self.redact(value))
        return True


class OneLineFormatter(logging.Formatter):
    """`ts level logger message k=v ...` with newlines escaped so every entry is one line."""

    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record)} {record.levelname} {record.name} {record.getMessage()}"
        extras = " ".join(f"{k}={v}" for k, v in vars(record).items() if k not in _STD_ATTRS)
        line = f"{base} {extras}" if extras else base
        if record.exc_info:
            line += " exc=" + self.formatException(record.exc_info)
        return line.replace("\r", "\\r").replace("\n", "\\n")


def configure_logging(s: Settings, level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(OneLineFormatter())
    handler.addFilter(RedactFilter([
        s.supabase_service_role_key, s.tavily_api_key or "", s.aws_secret_access_key or "",
        s.aws_session_token or "", s.amazon_api_secret_key or "",
    ]))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
