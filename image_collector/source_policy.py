"""Shared provenance policy. CDN exceptions are exact images bound to one verified source."""
from __future__ import annotations

import json
from pathlib import Path
import re
from urllib.parse import quote, urlsplit, urlunsplit

from .models import RejectedImage


class DisallowedImageSource(RejectedImage):
    """Policy failures must never trigger a thumbnail fallback."""


def _http_url(value):
    if (not isinstance(value, str) or not re.match(r"^https?://", value, re.I)
            or re.search(r"[\s\x00-\x1f\x7f\\]", value) or re.search(r"%(?![a-f0-9]{2})", value, re.I)):
        raise DisallowedImageSource("image_source_disallowed:invalid_url")
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower().removesuffix(".").encode("idna").decode("ascii")
        if (parsed.scheme not in ("http", "https") or not host
                or parsed.username is not None or parsed.password is not None):
            raise ValueError("unsupported address or embedded credentials")
        port = parsed.port
        if ":" not in host and not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", part)
                                      for part in host.split(".")):
            raise ValueError("invalid hostname")
        if any(re.sub("%2e", ".", part, flags=re.I) in (".", "..") for part in parsed.path.split("/")):
            raise ValueError("ambiguous dot segment")
        authority = f"[{host}]" if ":" in host else host
        if port is not None and (parsed.scheme, port) not in (("http", 80), ("https", 443)):
            authority += f":{port}"
        path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
        canonical = urlunsplit((parsed.scheme, authority, path, parsed.query, ""))
        return urlsplit(canonical)
    except (ValueError, UnicodeError) as exc:
        raise DisallowedImageSource("image_source_disallowed:invalid_url") from exc


class ImageSourcePolicy:
    def __init__(self, config):
        self.domains = tuple(host.lower() for host in config["blockedDomains"])
        if any(not host or not re.fullmatch(r"[a-z0-9.-]+", host) for host in self.domains):
            raise ValueError("image_policy_invalid:blocked_domain")
        self.exceptions = []
        for entry in config["verifiedOfficialSources"]:
            try:
                if (not entry.get("verifiedBy", "").strip() or not entry.get("evidenceUrl")
                        or bool(entry.get("sourceUrl")) == bool(entry.get("sourceUrlPrefix"))):
                    raise ValueError("verification required")
                _http_url(entry["evidenceUrl"])
                address = entry.get("sourceUrl") or entry["sourceUrlPrefix"]
                if "*" in address:
                    raise ValueError("wildcard")
                source = _http_url(address)
                prefix = bool(entry.get("sourceUrlPrefix"))
                if source.scheme != "https":
                    raise ValueError("https required")
                if prefix and (source.path == "/" or not source.path.endswith("/") or source.query or "#" in address):
                    raise ValueError("bounded account prefix required")
                images = set()
                for address in entry.get("imageUrls", []):
                    if "*" in address:
                        raise ValueError("wildcard")
                    images.add(_http_url(address).geturl())
                self.exceptions.append((source, prefix, images))
            except (ValueError, TypeError, KeyError, AttributeError) as exc:
                raise ValueError("image_policy_invalid:official_verification") from exc

    def _blocked(self, url):
        return any(url.hostname == host or url.hostname.endswith("." + host) for host in self.domains)

    def _exception(self, url):
        for source, prefix, images in self.exceptions:
            if ((prefix and (url.scheme, url.netloc) == (source.scheme, source.netloc)
                 and (url.path.startswith(source.path) or url.path == source.path[:-1]))
                    or (not prefix and url.geturl() == source.geturl())):
                return images
        return None

    def is_disallowed_image_source(self, value=None):
        try:
            url = _http_url(value)
            return self._blocked(url) and self._exception(url) is None
        except DisallowedImageSource:
            return True

    def assert_allowed_image_source(self, source_url, image_url=None, final_url=None):
        source = _http_url(source_url)
        images = self._exception(source)
        if self._blocked(source) and images is None:
            raise DisallowedImageSource("image_source_disallowed:source")
        for address in (image_url, final_url):
            if address is None:
                continue
            image = _http_url(address)
            if (self._blocked(image) or self._blocked(source)) and (images is None or image.geturl() not in images):
                raise DisallowedImageSource("image_source_disallowed:image")

    def assert_allowed_image_origin(self, origin_kind, origin_url):
        if origin_kind not in ("publisher", "official"):
            raise DisallowedImageSource("image_origin_unverified:" + str(origin_kind))
        self.assert_allowed_image_source(origin_url)


with (Path(__file__).resolve().parents[1] / "config" / "image-source-policy.json").open(encoding="utf-8") as _file:
    _config = json.load(_file)
_default_policy = ImageSourcePolicy(_config)
disallowed_image_domains = list(_config["blockedDomains"])
is_disallowed_image_source = _default_policy.is_disallowed_image_source
assert_allowed_image_source = _default_policy.assert_allowed_image_source
assert_allowed_image_origin = _default_policy.assert_allowed_image_origin
