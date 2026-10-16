"""Probes, build info, OpenAPI and the Prometheus endpoint."""

from sqlalchemy import create_engine

import app.main as main


def test_health_answers_without_the_database(client, monkeypatch):
    def no_db(*_args, **_kwargs):
        raise AssertionError("/health must not touch the database")

    monkeypatch.setattr(main.engine, "connect", no_db)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_when_schema_is_migrated(client):
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_is_503_when_database_is_unreachable(client, monkeypatch):
    unreachable = create_engine(
        "postgresql+psycopg://nobody:nothing@127.0.0.1:1/none", connect_args={"connect_timeout": 1}
    )
    monkeypatch.setattr(main, "engine", unreachable)
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "not ready"


def test_info_publishes_build_and_lending_rules(client):
    body = client.get("/api/info").json()
    assert body["app"] == "ShelfWise"
    assert body["version"] == "test"
    assert body["pod"]
    assert body["policy"]["members"]["student"] == {"max_loans": 3, "loan_days": 14}
    assert body["policy"]["members"]["faculty"] == {"max_loans": 6, "loan_days": 28}
    assert body["policy"]["fine_per_day"] == 5
    assert "Technology" in body["policy"]["genres"]


def test_openapi_and_docs_live_under_api(client):
    spec = client.get("/api/openapi.json")
    assert spec.status_code == 200
    assert "/api/loans/{loan_id}/return" in spec.json()["paths"]
    assert client.get("/docs", follow_redirects=False).headers["location"] == "/api/docs"


def test_metrics_expose_http_and_business_metrics(client, make_book, make_member, borrow):
    book = make_book(copies=2)
    borrow(make_member(), book)
    client.post("/api/loans", json={"member_id": 999_999, "book_id": book["id"]})  # a 404

    body = client.get("/metrics").text
    assert 'http_requests_total{handler="/api/loans",method="POST",status="2xx"}' in body
    assert 'http_requests_total{handler="/api/loans",method="POST",status="4xx"}' in body
    assert "http_request_duration_seconds_bucket" in body
    assert 'le="0.005"' in body  # our fine-grained buckets, not the 100 ms default
    assert "shelfwise_loans_active 1.0" in body
    assert 'shelfwise_copies{status="on_loan"} 1.0' in body
    assert 'shelfwise_copies{status="available"} 1.0' in body
    assert "shelfwise_db_up 1.0" in body
    assert 'shelfwise_build_info{pod="' in body
    assert 'handler="/health"' not in body  # probes are excluded from the HTTP metrics


def test_rule_rejections_are_counted_by_rule(client, make_book, make_member, borrow):
    book = make_book(copies=1)
    borrow(make_member(), book)
    borrow(make_member(), book, expect=409)
    assert 'shelfwise_rule_rejections_total{code="no_copy_available"}' in client.get("/metrics").text
