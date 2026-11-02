"""MySQL + mocked S3 tests for permanent deletion and cleanup."""
import pytest

from app.storage import storage
from tests.conftest import folder, item, op, run_sql, sql, upload


@pytest.mark.parametrize("selection", ["parent-first", "child-first", "all", "cleanup"])
def test_nested_folder_deletion(app, owner, selection):
    parent = folder(owner, "Parent")
    child = folder(owner, "Child", parent)
    leaf = folder(owner, "Leaf", child)
    card = item(owner, leaf)
    _, keys, _ = upload(owner, card, "x.png", b"image")
    op(owner, "trash", {"folderIds": [parent, child]})
    if selection == "cleanup":
        run_sql(app, "UPDATE folders SET deleted_at = 1 WHERE deleted_at IS NOT NULL")
        result = app.test_cli_runner().invoke(args=["cleanup"])
        assert result.exit_code == 0, result.output
    else:
        body = {"all": True} if selection == "all" else {
            "folderIds": [parent, child] if selection == "parent-first" else [child, parent]}
        assert op(owner, "purge", body) == {"ok": True, "items": 1, "folders": 3}
    assert sql(app, "SELECT id FROM folders") == []
    assert sql(app, "SELECT id FROM items") == []
    assert owner.get("/f/" + keys["orig"]).status_code == 404


@pytest.mark.parametrize("action", ["purge", "cleanup"])
def test_failed_storage_delete_retains_records_and_can_retry(app, owner, monkeypatch, action):
    parent = folder(owner)
    card = item(owner, parent)
    fid, keys, _ = upload(owner, card, "x.png", b"image", thumb=b"thumb")
    if action == "cleanup":
        op(owner, "file.delete", {"id": fid})
        run_sql(app, "UPDATE file_versions SET replaced_at = 1")
        table = "file_versions"
    else:
        op(owner, "trash", {"folderIds": [parent]})
        table = "files"
    with app.app_context():
        client = storage().client
    original = client.delete_objects

    def partially_fail(**kwargs):
        # Delete the thumbnail successfully, but leave the original undeleted.
        original(Bucket=kwargs["Bucket"], Delete={"Objects": [{"Key": keys["thumb"]}], "Quiet": True})
        return {"Errors": [{"Key": keys["orig"], "Code": "AccessDenied"}]}

    monkeypatch.setattr(client, "delete_objects", partially_fail)
    if action == "cleanup":
        result = app.test_cli_runner().invoke(args=["cleanup"])
        assert result.exit_code != 0
    else:
        op(owner, "purge", {"all": True}, status=500)
    assert len(sql(app, f"SELECT id FROM {table}")) == 1
    assert len(sql(app, "SELECT id FROM items")) == 1
    assert len(sql(app, "SELECT id FROM folders")) == 1
    assert owner.get("/f/" + keys["orig"]).status_code == 200
    monkeypatch.setattr(client, "delete_objects", original)
    if action == "cleanup":
        result = app.test_cli_runner().invoke(args=["cleanup"])
        assert result.exit_code == 0, result.output
    else:
        op(owner, "purge", {"all": True})
    assert sql(app, f"SELECT id FROM {table}") == []
    assert owner.get("/f/" + keys["orig"]).status_code == 404
