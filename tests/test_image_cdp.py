"""Loopback CDP parsing and detach behavior. No browser is started."""
import unittest
from types import SimpleNamespace

from image_collector.browser import BrowserSession
from image_collector.cdp import detach_external_driver, parse_debugger_address


class ParseTests(unittest.TestCase):
    def test_accepts_loopback_forms(self):
        self.assertEqual(parse_debugger_address("127.0.0.1:9230"), "127.0.0.1:9230")
        self.assertEqual(parse_debugger_address("http://127.0.0.1:9230"), "127.0.0.1:9230")
        self.assertEqual(parse_debugger_address("http://localhost:9230/"), "127.0.0.1:9230")
        self.assertEqual(parse_debugger_address("[::1]:9230"), "127.0.0.1:9230")

    def test_rejects_remote_and_decorated_addresses(self):
        for value in (
            "0.0.0.0:9230",
            "192.168.0.10:9230",
            "http://127.0.0.1:9230/json",
            "https://127.0.0.1:9230",
            "http://user:pass@127.0.0.1:9230",
            "",
        ):
            with self.assertRaises(ValueError):
                parse_debugger_address(value)


class _Process:
    def __init__(self):
        self.killed = False
        self.returncode = None

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


class DetachTests(unittest.TestCase):
    def test_attached_close_does_not_quit_the_browser(self):
        process = _Process()
        driver = SimpleNamespace(service=SimpleNamespace(process=process), quit_called=False)

        def quit():
            driver.quit_called = True

        driver.quit = quit
        session = BrowserSession(debugger_address="127.0.0.1:9230")
        session._driver = driver
        session.close()
        self.assertTrue(process.killed)
        self.assertFalse(driver.quit_called)
        self.assertIsNone(session._driver)

    def test_detach_replaces_quit(self):
        process = _Process()
        driver = SimpleNamespace(service=SimpleNamespace(process=process), quit=lambda: None)
        detach_external_driver(driver)
        driver.quit()
        self.assertTrue(process.killed)

    def test_cdp_rejects_headless(self):
        with self.assertRaises(ValueError):
            BrowserSession(headless=True, debugger_address="127.0.0.1:9230")

    def test_owned_session_still_calls_quit(self):
        calls = []

        class Driver:
            def quit(self):
                calls.append("quit")

        session = BrowserSession(headless=True)
        session._driver = Driver()
        session.close()
        self.assertEqual(calls, ["quit"])


if __name__ == "__main__":
    unittest.main()
