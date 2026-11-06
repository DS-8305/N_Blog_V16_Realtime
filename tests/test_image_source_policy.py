"""Source policy and download transport checks; no network or browser is used."""
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from PIL import Image
import requests

from image_collector.downloader import Downloader
from image_collector.models import Candidate, CollectionOptions, RejectedImage
from image_collector.runner import run_collection


def png_bytes():
    output = io.BytesIO()
    Image.new("RGB", (160, 160), "red").save(output, "PNG")
    return output.getvalue()


class Transport:
    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def merge_environment_settings(self, *args):
        return {"stream": True, "verify": True, "cert": None, "proxies": {}}

    def get_adapter(self, url):
        return self

    def send(self, request, **kwargs):
        self.requests.append(request.url)
        status, headers, body, final_url = self.routes[request.url]
        response = requests.Response()
        response.status_code = status
        response.headers.update(headers)
        response.url = final_url or request.url
        class Raw(io.BytesIO):
            def read1(self, size, decode_content=True):
                return self.read(size)
        response.raw = Raw(body)
        return response


class DownloadPolicyTests(unittest.TestCase):
    def test_blocked_source_is_rejected_before_transport(self):
        url = "https://images.publisher.example/photo.png"
        session = Transport({url: (200, {"Content-Type": "image/png"}, png_bytes(), None)})
        downloader = Downloader(CollectionOptions(engine="google", profile="legacy-thumbnail").resolve(), session=session)
        candidate = Candidate("", source_url="https://www.instagram.com/private/p/1/", original_url=url)
        with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
            downloader.download(candidate)
        self.assertEqual(session.requests, [])

    def test_blocked_original_cannot_fall_back_to_safe_thumbnail(self):
        url = "https://images.publisher.example/thumb.png"
        session = Transport({url: (200, {"Content-Type": "image/png"}, png_bytes(), None),
                             "https://blogfiles.pstatic.net/private.png": (404, {}, b"", None)})
        options = CollectionOptions(engine="google", download_mode="original-preferred", profile="legacy-thumbnail").resolve()
        downloader = Downloader(options, session=session)
        candidate = Candidate(url, source_url="https://news.example/article", original_url="https://blogfiles.pstatic.net/private.png")
        with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
            downloader.download(candidate)
        self.assertEqual(session.requests, [])

    def test_safe_publisher_image_still_downloads(self):
        url = "https://images.publisher.example/photo.png"
        session = Transport({url: (200, {"Content-Type": "image/png"}, png_bytes(), None)})
        downloader = Downloader(CollectionOptions(engine="google", profile="legacy-thumbnail").resolve(), session=session)
        result = downloader.download(Candidate("", source_url="https://news.example/article", original_url=url))
        self.assertEqual((result.width, result.height, result.downloaded_url), (160, 160, url))

    def test_missing_original_still_allows_safe_original_preferred_thumbnail(self):
        url = "https://images.publisher.example/thumb.png"
        session = Transport({url: (200, {"Content-Type": "image/png"}, png_bytes(), None)})
        options = CollectionOptions(engine="google", download_mode="original-preferred", profile="legacy-thumbnail").resolve()
        result = Downloader(options, session=session).download(Candidate(url, source_url="https://news.example/article"))
        self.assertEqual(result.download_kind, "thumbnail")
        self.assertEqual(result.downloaded_url, url)

    def test_redirect_to_personal_cdn_is_not_requested(self):
        url = "https://images.publisher.example/photo.png"
        session = Transport({url: (302, {"Location": "https://scontent.cdninstagram.com/private.png"}, b"", None),
                             "https://scontent.cdninstagram.com/private.png": (200, {"Content-Type": "image/png"}, png_bytes(), None)})
        downloader = Downloader(CollectionOptions(engine="google", profile="legacy-thumbnail").resolve(), session=session)
        with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
            downloader.download(Candidate("", source_url="https://news.example/article", original_url=url))
        self.assertEqual(session.requests, [url])

    def test_redirect_policy_failure_cannot_fall_back_to_safe_thumbnail(self):
        url = "https://images.publisher.example/photo.png"
        thumb = "https://images.publisher.example/thumb.png"
        session = Transport({url: (302, {"Location": "https://scontent.cdninstagram.com/private.png"}, b"", None),
                             thumb: (200, {"Content-Type": "image/png"}, png_bytes(), None)})
        options = CollectionOptions(engine="google", download_mode="original-preferred", profile="legacy-thumbnail").resolve()
        with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
            Downloader(options, session=session).download(Candidate(thumb, source_url="https://news.example/article", original_url=url))
        self.assertEqual(session.requests, [url])

    def test_final_response_url_is_checked_before_reading_image(self):
        url = "https://images.publisher.example/photo.png"
        session = Transport({url: (200, {"Content-Type": "image/png"}, b"not image bytes", "https://blogfiles.pstatic.net/private.png")})
        downloader = Downloader(CollectionOptions(engine="google", profile="legacy-thumbnail").resolve(), session=session)
        with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
            downloader.download(Candidate("", source_url="https://news.example/article", original_url=url))

    def test_runner_filters_blocked_candidates_before_custom_downloader(self):
        candidates = [Candidate("https://images.example/photo.png", source_url="https://blog.naver.com/private/1"),
                      Candidate("https://images.example/thumb.png", source_url="https://news.example/article",
                                original_url="https://blogfiles.pstatic.net/private.png")]
        class ForbiddenDownloader:
            def __init__(self, *args, **kwargs):
                pass
            def download(self, candidate, **kwargs):
                raise AssertionError("Blocked candidate reached downloader")
        runtime = Path(__file__).resolve().parents[1] / ".runtime"
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as root:
            result = run_collection(["scene"], CollectionOptions(engine="google", backend="api", limit=1),
                                    output_root=root, selected_candidates=candidates,
                                    downloader_factory=ForbiddenDownloader, browser_pool=SimpleNamespace())
            rows = list(json.loads((result.run_dir / "run.json").read_text(encoding="utf-8"))["jobs"].values())[0]["records"]
            self.assertEqual(result.saved_count, 0)
            self.assertEqual([row["status"] for row in rows], ["skipped", "skipped"])
            for row in rows:
                self.assertIn("image_source_disallowed", row["error"])


class SourcePolicyTests(unittest.TestCase):
    def test_shared_defaults_block_personal_platforms_and_image_cdns(self):
        from image_collector.source_policy import is_disallowed_image_source
        for value in (
            "https://INSTAGRAM.COM./private/", "https://instagr.am/p/1/",
            "https://scontent.cdninstagram.com/photo.jpg", "https://blog.naver.com/person/1",
            "https://postfiles.pstatic.net/photo.jpg", "https://blogfiles.naver.net/photo.jpg",
            "https://person.tistory.com/1", "https://person.wordpress.com/1",
            "https://person.blogspot.com/1", "https://blogger.googleusercontent.com/photo.jpg",
            "https://lh3.googleusercontent.com/private-blog/photo.jpg",
            "https://blog.kakaocdn.net/photo.jpg", "https://i.redd.it/photo.jpg",
            "https://scontent.fbcdn.net/photo.jpg", "https://en.wikipedia.org/wiki/Photo",
        ):
            with self.subTest(url=value):
                self.assertTrue(is_disallowed_image_source(value))
        self.assertFalse(is_disallowed_image_source("https://imgnews.pstatic.net/image/1.jpg"))
        self.assertFalse(is_disallowed_image_source("https://notinstagram.com/image.jpg"))

    def test_malformed_non_http_and_credentials_are_rejected(self):
        from image_collector.source_policy import is_disallowed_image_source
        for value in (None, "", "relative", "https:news.example/photo", "file:///photo.png",
                      "data:image/png;base64,abc", "https://news.example@instagram.com/a",
                      "https://instagram.com@news.example/a", "https://news.example:99999/a",
                      "https://@news.example/a",
                      "https://news.example/%ZZ",
                      "https://news.example/white space", "https://news.example\\@elsewhere.example/a"):
            with self.subTest(url=value):
                self.assertTrue(is_disallowed_image_source(value))

    def test_origin_review_is_fail_closed_for_self_hosted_personal_or_unknown_origins(self):
        from image_collector.source_policy import assert_allowed_image_origin
        for kind in ("personal", "unknown"):
            with self.assertRaisesRegex(RejectedImage, "image_origin_unverified"):
                assert_allowed_image_origin(kind, "https://ordinary-person.example/photos")
        assert_allowed_image_origin("publisher", "https://news.example/article")
        assert_allowed_image_origin("official", "https://agency.example/photos")

    def official_config(self):
        return {
            "blockedDomains": ["instagram.com", "cdninstagram.com", "blog.naver.com", "postfiles.pstatic.net"],
            "verifiedOfficialSources": [
                {"sourceUrlPrefix": "https://www.instagram.com/agency/", "verifiedBy": "Editor",
                 "evidenceUrl": "https://agency.example/accounts",
                 "imageUrls": ["https://scontent.cdninstagram.com/agency.jpg"]},
                {"sourceUrl": "https://blog.naver.com/agency/123", "verifiedBy": "Editor",
                 "evidenceUrl": "https://agency.example/blog",
                 "imageUrls": ["https://postfiles.pstatic.net/agency.jpg"]},
            ],
        }

    def test_official_exception_is_exact_and_cannot_be_borrowed(self):
        from image_collector.source_policy import ImageSourcePolicy
        policy = ImageSourcePolicy(self.official_config())
        policy.assert_allowed_image_source("https://www.instagram.com/agency/p/123/", "https://scontent.cdninstagram.com/agency.jpg")
        policy.assert_allowed_image_source("https://blog.naver.com/agency/123", "https://postfiles.pstatic.net/agency.jpg")
        policy.assert_allowed_image_origin("official", "https://www.instagram.com/agency/")
        for source, image in (
            ("https://www.instagram.com/agency_imposter/p/123/", None),
            ("https://www.instagram.com/elsewhere/", None),
            ("https://blog.naver.com/agency/124", None),
            ("https://news.example/article", "https://scontent.cdninstagram.com/agency.jpg"),
            ("https://blog.naver.com/agency/123", "https://scontent.cdninstagram.com/agency.jpg"),
            ("https://www.instagram.com/agency/p/123/", "https://scontent.cdninstagram.com/private.jpg"),
            ("https://www.instagram.com/agency/p/123/", "https://images.publisher.example/unverified.jpg"),
        ):
            with self.subTest(source=source, image=image):
                with self.assertRaisesRegex(RejectedImage, "image_source_disallowed"):
                    policy.assert_allowed_image_source(source, image)

    def test_incomplete_or_wildcard_official_verification_is_rejected(self):
        from image_collector.source_policy import ImageSourcePolicy
        for override in ({"verifiedBy": ""}, {"evidenceUrl": ""},
                         {"sourceUrlPrefix": "https://www.instagram.com/"},
                         {"sourceUrlPrefix": "https://www.instagram.com/agency*"},
                         {"sourceUrlPrefix": "https://www.instagram.com/agency"},
                         {"sourceUrlPrefix": "https://www.instagram.com/agency/#elsewhere"}):
            config = self.official_config()
            config["verifiedOfficialSources"] = [{**config["verifiedOfficialSources"][0], **override}]
            with self.subTest(override=override):
                with self.assertRaisesRegex(ValueError, "image_policy_invalid"):
                    ImageSourcePolicy(config)


if __name__ == "__main__":
    unittest.main()
