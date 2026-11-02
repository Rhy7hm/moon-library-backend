"""Storage deletion regressions; also runnable with python -m unittest."""
import unittest
from unittest.mock import Mock, patch

from app.storage import R2Storage, StorageError
from app.services.admin_ops import subtree


class StorageDeleteTests(unittest.TestCase):
    def setUp(self):
        self.storage = object.__new__(R2Storage)
        self.storage.bucket = "test"
        self.storage.client = Mock()
        self.storage.client.delete_objects.return_value = {}
        self.sleep = patch("app.storage.time.sleep").start()
        self.addCleanup(patch.stopall)

    def keys(self):
        return [[o["Key"] for o in c.kwargs["Delete"]["Objects"]]
                for c in self.storage.client.delete_objects.call_args_list]

    def test_empty_and_duplicate_keys(self):
        self.storage.delete([])
        self.storage.client.delete_objects.assert_not_called()
        self.storage.delete(["a", "", "a", "b"])
        self.assertEqual(self.keys(), [["a", "b"]])

    def test_partial_failure_retries_only_failed_keys(self):
        self.storage.client.delete_objects.side_effect = [
            {"Errors": [{"Key": "b", "Code": "SlowDown"}]}, {},
        ]
        self.storage.delete(["a", "b"])
        self.assertEqual(self.keys(), [["a", "b"], ["b"]])
        self.sleep.assert_called_once_with(0.25)

    def test_permanent_failure_is_not_retried(self):
        self.storage.client.delete_objects.return_value = {
            "Errors": [{"Key": "a", "Code": "AccessDenied"}]}
        with self.assertRaisesRegex(StorageError, "AccessDenied"):
            self.storage.delete(["a"])
        self.assertEqual(len(self.keys()), 1)
        self.sleep.assert_not_called()

    def test_transient_failures_stop_after_three_attempts(self):
        self.storage.client.delete_objects.return_value = {
            "Errors": [{"Key": "a", "Code": "InternalError"}]}
        with self.assertRaisesRegex(StorageError, "InternalError"):
            self.storage.delete(["a"])
        self.assertEqual(len(self.keys()), 3)
        self.assertEqual([c.args[0] for c in self.sleep.call_args_list], [0.25, 0.5])

    def test_multiple_batches_and_retry_after_partial_success(self):
        keys = [str(i) for i in range(901)]
        self.storage.client.delete_objects.side_effect = [
            {}, {"Errors": [{"Key": "900", "Code": "AccessDenied"}]}, {}, {},
        ]
        with self.assertRaises(StorageError):
            self.storage.delete(keys)
        # Already deleted keys are safe to submit again (S3 deletion is idempotent).
        self.storage.delete(keys)
        self.assertEqual([len(k) for k in self.keys()], [900, 1, 900, 1])

    def test_unknown_failed_key_is_not_retried(self):
        self.storage.client.delete_objects.return_value = {
            "Errors": [{"Key": "unexpected", "Code": "SlowDown"}]}
        with self.assertRaises(StorageError):
            self.storage.delete(["a"])
        self.sleep.assert_not_called()


class SubtreeTests(unittest.TestCase):
    def test_overlapping_roots_always_put_parents_first(self):
        rows = [{"id": "a", "parent_id": None},
                {"id": "b", "parent_id": "a"},
                {"id": "c", "parent_id": "b"},
                {"id": "d", "parent_id": None}]
        with patch("app.services.admin_ops.q.all", return_value=rows):
            for roots in (["a", "b"], ["b", "a"], ["c", "a", "b", "a"], ["d", "b", "a"]):
                with self.subTest(roots=roots):
                    result = subtree(roots)
                    self.assertEqual(len(result), len(set(result)))
                    self.assertLess(result.index("a"), result.index("b"))
                    self.assertLess(result.index("b"), result.index("c"))


if __name__ == "__main__":
    unittest.main()
