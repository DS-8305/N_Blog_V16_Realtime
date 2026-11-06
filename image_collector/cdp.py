"""Attach-only helpers for a loopback Chrome DevTools session.

The collector must not launch Chrome, read cookies, or close the browser.
"""
from __future__ import annotations

from pathlib import Path
import os


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def parse_debugger_address(value: str) -> str:
    """Return ``127.0.0.1:port`` or raise ValueError.

    Accepts ``host:port`` and ``http://host:port``. Remote hosts, paths,
    credentials, and non-HTTP schemes are rejected so the debugging port is
    never treated as a network service.
    """
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("CDP 주소가 비어 있습니다.")
    if "://" in raw:
        from urllib.parse import urlparse

        parsed = urlparse(raw)
        host = (parsed.hostname or "").lower()
        port = parsed.port
        if (
            parsed.scheme != "http"
            or parsed.username
            or parsed.password
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or port is None
        ):
            raise ValueError("CDP 주소는 http://127.0.0.1:포트 형식만 허용합니다.")
    else:
        if raw.startswith("["):
            host, separator, port_text = raw[1:].partition("]")
            if separator != "]" or not port_text.startswith(":"):
                raise ValueError("CDP 주소는 호스트:포트여야 합니다.")
            port_text = port_text[1:]
        else:
            if raw.count(":") != 1:
                raise ValueError("CDP 주소는 호스트:포트여야 합니다.")
            host, port_text = raw.split(":", 1)
        host = host.strip().lower()
        try:
            port = int(port_text)
        except ValueError as exc:
            raise ValueError("CDP 포트가 올바르지 않습니다.") from exc
    if host not in LOOPBACK_HOSTS:
        raise ValueError("CDP는 이 컴퓨터(127.0.0.1)에만 연결할 수 있습니다.")
    if not isinstance(port, int) or isinstance(port, bool) or port < 1 or port > 65535:
        raise ValueError("CDP 포트가 올바르지 않습니다.")
    return f"127.0.0.1:{port}"


def cdp_lock_dir(address: str) -> Path:
    """A collector mutex directory. This is not a Chrome user-data-dir."""
    port = parse_debugger_address(address).rsplit(":", 1)[1]
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share"))
    return base / "ImageCollector" / "cdp-locks" / port


def detach_external_driver(driver) -> None:
    """Drop ChromeDriver without sending WebDriver quit to the browser."""
    service = getattr(driver, "service", None)
    process = getattr(service, "process", None) if service is not None else None
    if process is not None and getattr(process, "poll", lambda: 0)() is None:
        process.kill()
        try:
            process.wait(timeout=3)
        except Exception:
            pass
    noop = lambda *_args, **_kwargs: None  # noqa: E731
    try:
        driver.quit = noop
    except Exception:
        pass
    if service is not None:
        for name in ("stop", "send_remote_shutdown_command"):
            try:
                setattr(service, name, noop)
            except Exception:
                pass
        try:
            service.process = None
        except Exception:
            pass
