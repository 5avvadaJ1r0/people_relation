from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.crud.person import wiki_ja_article_url
from app.services.diagram_share_token import (
    decode_diagram_share_id,
    encode_diagram_share_payload,
)

# 1x1 RGB PNG（シグネチャ + IHDR + IEND）。OG 検証テスト用。
_MINIMAL_VALID_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    b"\x90wS\xde"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_diagram_share_token_roundtrip() -> None:
    share_id = encode_diagram_share_payload(
        center_person_ids=[1, 2],
        show_peer_links=True,
        total_point_gt=3,
    )
    decoded = decode_diagram_share_id(share_id)
    assert decoded == {
        "center_person_ids": [1, 2],
        "show_peer_links": True,
        "total_point_gt": 3,
    }


def test_diagram_share_token_base64_padding_roundtrip() -> None:
    """share_id はパディング除去済みの canonical 形式のみ受け付ける。"""
    cases = [
        ([1], False, 0),
        ([1, 2, 3, 4, 5], True, 99),
        (list(range(1, 11)), False, 12345),
    ]
    for center_ids, show_peer, total_gt in cases:
        share_id = encode_diagram_share_payload(
            center_person_ids=center_ids,
            show_peer_links=show_peer,
            total_point_gt=total_gt,
        )
        assert "=" not in share_id
        assert decode_diagram_share_id(share_id) == {
            "center_person_ids": list(dict.fromkeys(center_ids))[:10],
            "show_peer_links": show_peer,
            "total_point_gt": total_gt,
        }
        pad = "=" * (-len(share_id) % 4)
        if pad:
            with pytest.raises(HTTPException) as exc:
                decode_diagram_share_id(share_id + pad)
            assert exc.value.status_code == 400


def test_diagram_share_token_invalid_share_id() -> None:
    with pytest.raises(HTTPException) as exc:
        decode_diagram_share_id("not-a-valid-token!!!")
    assert exc.value.status_code == 400


def test_diagram_share_create_and_resolve(client: TestClient) -> None:
    title = "ShareDiagramPerson"
    url = wiki_ja_article_url(title)
    r = client.post(
        "/api/v1/relation",
        json=[
            {
                "master": {"name": "S主", "url": url, "title": title},
                "slave": {
                    "name": "S従",
                    "url": "https://example.com/share-slave",
                    "title": "S従T",
                },
                "point": 5,
            },
        ],
        params={"executed_master_url": url},
    )
    assert r.status_code == 200
    master_id = r.json()[0]["master"]["id"]

    created = client.post(
        "/api/v1/diagram/share",
        json={
            "center_person_ids": [master_id],
            "show_peer_links": False,
            "total_point_gt": 1,
        },
    )
    assert created.status_code == 200
    share_id = created.json()["share_id"]
    assert isinstance(share_id, str) and len(share_id) > 8

    got = client.get(f"/api/v1/diagram/share/{share_id}")
    assert got.status_code == 200
    body = got.json()
    assert body["center_person_ids"] == [master_id]
    assert body["show_peer_links"] is False
    assert body["total_point_gt"] == 1
    assert len(body["center_persons"]) == 1
    assert body["center_persons"][0]["title"] == title
    assert body["has_og_image"] is False


def test_diagram_share_card_html(client: TestClient) -> None:
    title = "ShareCardPerson"
    url = wiki_ja_article_url(title)
    r = client.post(
        "/api/v1/relation",
        json=[
            {
                "master": {"name": "C主", "url": url, "title": title},
                "slave": {
                    "name": "C従",
                    "url": "https://example.com/card-slave",
                    "title": "C従T",
                },
                "point": 2,
            },
        ],
        params={"executed_master_url": url},
    )
    assert r.status_code == 200
    master_id = r.json()[0]["master"]["id"]
    created = client.post(
        "/api/v1/diagram/share",
        json={
            "center_person_ids": [master_id],
            "show_peer_links": True,
            "total_point_gt": 0,
        },
    )
    share_id = created.json()["share_id"]
    card = client.get(f"/api/v1/diagram/share/{share_id}/card")
    assert card.status_code == 200
    assert "twitter:card" in card.text
    assert "summary_large_image" in card.text
    assert title in card.text


@patch("app.services.diagram_share_og._redis")
def test_diagram_share_og_image_put_get(mock_redis_factory, client: TestClient) -> None:
    store: dict[str, bytes] = {}

    class FakeRedis:
        def setex(self, key: str, _ttl: int, value: bytes) -> None:
            store[key] = value

        def get(self, key: str) -> bytes | None:
            return store.get(key)

    mock_redis_factory.return_value = FakeRedis()

    share_id = encode_diagram_share_payload(
        center_person_ids=[99],
        show_peer_links=False,
        total_point_gt=1,
    )
    put = client.put(
        f"/api/v1/diagram/share/{share_id}/og-image",
        content=_MINIMAL_VALID_PNG,
        headers={"Content-Type": "image/png"},
    )
    assert put.status_code == 204
    got = client.get(f"/api/v1/diagram/share/{share_id}/og-image")
    assert got.status_code == 200
    assert got.content == _MINIMAL_VALID_PNG


def test_diagram_share_og_image_rejects_invalid_content_type(
    client: TestClient,
) -> None:
    share_id = encode_diagram_share_payload(
        center_person_ids=[1],
        show_peer_links=False,
        total_point_gt=0,
    )
    bad_type = client.put(
        f"/api/v1/diagram/share/{share_id}/og-image",
        content=_MINIMAL_VALID_PNG,
        headers={"Content-Type": "image/jpeg"},
    )
    assert bad_type.status_code == 415


def test_diagram_share_og_image_rejects_invalid_png(client: TestClient) -> None:
    share_id = encode_diagram_share_payload(
        center_person_ids=[1],
        show_peer_links=False,
        total_point_gt=0,
    )
    bad_magic = client.put(
        f"/api/v1/diagram/share/{share_id}/og-image",
        content=b"not-png",
        headers={"Content-Type": "image/png"},
    )
    assert bad_magic.status_code == 400
    missing_ihdr = client.put(
        f"/api/v1/diagram/share/{share_id}/og-image",
        content=b"\x89PNG\r\n\x1a\n" + b"\x00" * 24,
        headers={"Content-Type": "image/png"},
    )
    assert missing_ihdr.status_code == 400
