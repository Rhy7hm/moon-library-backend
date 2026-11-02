"""Copy isolation, failure handling, boundaries, and overlapping selections."""
import base64
from unittest.mock import Mock

from app.services import admin_ops
from app.storage import R2Storage
from tests.conftest import folder, item, login, make_user, op, ready_cards, sql, upload


def pairs(result):
    return {"pairs": [{"id": f["id"], "src": f["src"]} for f in result["files"]]}


def test_copy_overlapping_selections_and_self_target(owner):
    top = folder(owner, "Top")
    sub = folder(owner, "Sub", top)
    leaf = folder(owner, "Leaf", sub)
    card = item(owner, leaf)
    upload(owner, card, "a.png", b"original")
    r = op(owner, "copy.start", {"folderIds": [leaf, top, sub, top], "itemIds": [card, card], "targetId": None})
    assert (r["folders"], r["items"], len(r["folderIds"]), r["itemIds"]) == (3, 1, 1, [])
    copy = sql(owner.application, "SELECT folder_id FROM items WHERE id = (SELECT item_id FROM files WHERE id = ?)", r["files"][0]["id"])[0]
    assert copy["folder_id"] not in (top, sub, leaf)
    self_copy = op(owner, "copy.start", {"folderIds": [top], "targetId": leaf})
    assert self_copy["folders"] == 3  # a snapshot, not an infinitely growing traversal


def test_copy_names_slugs_and_sibling_order(owner):
    top = folder(owner, "Top")
    a = folder(owner, "A!", top)
    b = folder(owner, "A?", top)
    dest = folder(owner, "Destination")
    r = op(owner, "copy.start", {"folderIds": [a, b], "targetId": dest})
    rows = sql(owner.application, "SELECT slug FROM folders WHERE parent_id = ?", dest)
    assert len({x["slug"] for x in rows}) == 2
    op(owner, "copy.start", {"folderIds": [a], "targetId": top})
    rows = sql(owner.application, "SELECT name FROM folders WHERE parent_id = ? ORDER BY sort, created_at, id", top)
    assert 'A! (copy)' in rows[1]["name"]
    taken = {"a (copy)"} | {f"a (copy {n})" for n in range(2, 101)}
    assert admin_ops._with_copy({"en": "A", "zh": "甲"}, taken) == {"en": "A (copy 101)", "zh": "甲 (copy 101)"}


def test_copy_metadata_icons_and_purge_isolation(owner, app):
    top = folder(owner, "Top")
    icon = op(owner, "folder.iconImage", {"data": base64.b64encode(b"RIFF0000WEBPicon").decode()})["icon"]
    op(owner, "folder.update", {"id": top, "icon": icon, "hidden": True, "iconBg": "#123456", "iconFg": "#abcdef"})
    card = item(owner, top)
    fid, keys, _ = upload(owner, card, "a.png", b"original", "en", ["en", "zh"], thumb=b"thumb", opt=b"opt")
    op(owner, "file.update", {"id": fid, "caption": "Caption"})
    op(owner, "item.update", {"id": card, "pinned": True, "status": "draft", "publishAt": 1900000000000, "hideAt": 1910000000000})
    r = op(owner, "copy.start", {"folderIds": [top], "targetId": None})
    new = sql(app, "SELECT * FROM folders WHERE id = ?", r["folderIds"][0])[0]
    assert new["hidden"] == 1 and new["icon"] != icon
    assert owner.get('/f/' + new["icon"][4:]).data == b"RIFF0000WEBPicon"
    to = sql(app, "SELECT * FROM files WHERE id = ?", r["files"][0]["id"])[0]
    old = sql(app, "SELECT * FROM files WHERE id = ?", fid)[0]
    for k in ['lang', 'extra_langs', 'caption', 'mime', 'size', 'opt_size', 'width', 'height']:
        assert to[k] == old[k]
    new_card = sql(app, "SELECT * FROM items WHERE id = ?", to["item_id"])[0]
    assert (new_card['status'], new_card['pinned'], new_card['publish_at'], new_card['hide_at']) == ('draft', 1, 1900000000000, 1910000000000)
    assert op(owner, "copy.files", pairs(r))["failed"] == []
    assert sql(app, "SELECT * FROM file_versions WHERE item_id = ?", to["item_id"]) == []
    op(owner, "trash", {"folderIds": r["folderIds"]})
    op(owner, "purge", {"all": True})
    assert owner.get('/f/' + icon[4:]).status_code == 200
    assert owner.get('/f/' + keys['orig']).data == b'original'


def test_copy_failures_retry_and_pair_validation(owner, app, monkeypatch):
    top = folder(owner)
    card = item(owner, top)
    src, _, _ = upload(owner, card, "a.png", b"original", thumb=b"thumb")
    another = item(owner, top)
    other, _, _ = upload(owner, another, "a.png", b"different")
    r = op(owner, "copy.start", {"itemIds": [card], "targetId": top})
    dest = r['files'][0]['id']
    assert op(owner, 'copy.files', {'pairs': [{'id': dest, 'src': other}]}) == {'done': [], 'failed': [dest]}
    original = R2Storage.copy
    def fail_thumb(self, source, target):
        if source.startswith('t/'):
            raise RuntimeError('temporary test failure')
        return original(self, source, target)
    monkeypatch.setattr(R2Storage, 'copy', fail_thumb)
    assert op(owner, 'copy.files', pairs(r)) == {'done': [], 'failed': [dest]}
    assert sql(app, 'SELECT status FROM files WHERE id = ?', dest)[0]['status'] == 'uploading'
    assert not any(i['id'] == sql(app, 'SELECT item_id FROM files WHERE id = ?', dest)[0]['item_id'] for i in ready_cards(app)['items'])
    monkeypatch.setattr(R2Storage, 'copy', original)
    assert op(owner, 'copy.files', pairs(r)) == {'done': [dest], 'failed': []}
    assert op(owner, 'copy.files', pairs(r)) == {'done': [dest], 'failed': []}  # lost response retry
    normal = op(owner, 'file.create', {'itemId': card, 'lang': 'en', 'kind': 'image', 'name': 'a.png', 'mime': 'image/png', 'size': 8})
    assert op(owner, 'copy.files', {'pairs': [{'id': normal['id'], 'src': src}]})['failed'] == [normal['id']]
    for invalid in [[], [{}], [{'id': dest, 'src': src}]*21, [{'id': dest, 'src': src}]*2]:
        op(owner, 'copy.files', {'pairs': invalid}, status=400)


def test_copy_undo_before_files_finish(owner):
    top = folder(owner)
    card = item(owner, top)
    upload(owner, card, 'a.png', b'original')
    r = op(owner, 'copy.start', {'itemIds': [card], 'targetId': top})
    log = op(owner, 'audit.list', {'kind': 'content'})['entries'][0]
    op(owner, 'audit.undo', {'id': log['id']})
    assert op(owner, 'copy.files', pairs(r))['failed'] == [r['files'][0]['id']]


def test_copy_limits_and_invalid_records(owner, app, monkeypatch):
    top = folder(owner)
    sub = folder(owner, 'Sub', top)
    card = item(owner, sub)
    upload(owner, card, 'a.png', b'one', 'en')
    upload(owner, card, 'b.png', b'two', 'ms')
    monkeypatch.setattr(admin_ops, 'MAX_COPY_FOLDERS', 1)
    op(owner, 'copy.start', {'folderIds': [top]}, status=413)
    monkeypatch.setattr(admin_ops, 'MAX_COPY_FOLDERS', 300)
    monkeypatch.setattr(admin_ops, 'MAX_COPY_FILES', 1)
    op(owner, 'copy.start', {'itemIds': [card], 'targetId': sub}, status=413)
    assert len(sql(app, 'SELECT id FROM folders')) == 2
    assert len(sql(app, 'SELECT id FROM items')) == 1
    op(owner, 'copy.start', {'folderIds': ['missing']}, status=404)
    op(owner, 'copy.start', {'itemIds': ['missing'], 'targetId': top}, status=404)
    op(owner, 'trash', {'folderIds': [top]})
    op(owner, 'copy.start', {'folderIds': [top]}, status=404)
    op(owner, 'copy.start', {'folderIds': [sub], 'targetId': top}, status=404)


def test_copy_permissions(owner, app):
    top = folder(owner)
    for role in ['viewer', 'editor']:
        make_user(app, username=role, role=role)
        client = app.test_client()
        login(client, username=role)
        op(client, 'copy.start', {'folderIds': [top]}, status=403 if role == 'viewer' else 200)
        if role == 'viewer':
            op(client, 'copy.files', {'pairs': [{'id': 'a', 'src': 'b'}]}, status=403)


def test_copy_storage_large_object_preserves_headers():
    st = object.__new__(R2Storage)
    st.bucket = 'test'
    st.client = Mock()
    st.client.head_object.return_value = {'ContentLength': 6 * 1024**3, 'ContentType': 'video/mp4', 'ContentDisposition': 'inline', 'CacheControl': 'public'}
    st.copy('source', 'destination')
    st.client.copy_object.assert_not_called()
    st.client.copy.assert_called_once_with({'Bucket': 'test', 'Key': 'source'}, 'test', 'destination', ExtraArgs={'ContentType': 'video/mp4', 'ContentDisposition': 'inline', 'CacheControl': 'public'})


def test_copy_icon_failure_leaves_no_database_copies(owner, app, monkeypatch):
    top = folder(owner)
    icon = op(owner, 'folder.iconImage', {'data': base64.b64encode(b'RIFF0000WEBPicon').decode()})['icon']
    op(owner, 'folder.update', {'id': top, 'icon': icon})
    def fail(*args):
        raise RuntimeError('test icon copy failure')
    monkeypatch.setattr(R2Storage, 'copy', fail)
    op(owner, 'copy.start', {'folderIds': [top]}, status=500)
    assert len(sql(app, 'SELECT id FROM folders')) == 1
    assert owner.get('/f/' + icon[4:]).status_code == 200


def test_copy_mixed_independent_card_and_folder(owner, app):
    top = folder(owner, 'Top')
    sub = folder(owner, 'Sub', top)
    nested = item(owner, sub, 'Nested')
    loose = item(owner, top, 'Loose')
    upload(owner, nested, 'nested.png', b'nested')
    upload(owner, loose, 'loose.png', b'loose')
    r = op(owner, 'copy.start', {'folderIds': [sub], 'itemIds': [loose], 'targetId': top})
    assert (len(r['folderIds']), len(r['itemIds']), r['items'], len(r['files'])) == (1, 1, 2, 2)
    assert sql(app, 'SELECT folder_id FROM items WHERE id = ?', r['itemIds'][0])[0]['folder_id'] == top
    assert op(owner, 'copy.files', pairs(r))['failed'] == []
