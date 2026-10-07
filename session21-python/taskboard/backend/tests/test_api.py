import os
os.environ["DATABASE_URL"] = "sqlite:////tmp/taskboard-tests.db"
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db import Base, engine

@pytest.fixture
def client():
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)

def test_health(client):
    assert client.get("/health").json() == {"status": "UP"}

def test_root(client):
    assert client.get("/").json()["service"] == "TaskBoard API"

def test_create_and_read_task(client):
    response = client.post("/api/tasks", json={"title": "Deploy application", "priority": "HIGH", "assignee": "Shubham"})
    assert response.status_code == 201
    task = response.json()
    assert client.get(f"/api/tasks/{task['id']}").json()["title"] == "Deploy application"

def test_list_tasks(client):
    client.post("/api/tasks", json={"title": "Check monitoring"})
    assert len(client.get("/api/tasks").json()) == 1

def test_update_task(client):
    task = client.post("/api/tasks", json={"title": "Deploy"}).json()
    response = client.put(f"/api/tasks/{task['id']}", json={"status": "DONE"})
    assert response.status_code == 200
    assert response.json()["status"] == "DONE"

def test_delete_task(client):
    task = client.post("/api/tasks", json={"title": "Delete me"}).json()
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404

def test_missing_task(client):
    assert client.get("/api/tasks/99999").status_code == 404

def test_invalid_payload(client):
    assert client.post("/api/tasks", json={}).status_code == 422

def test_stats(client):
    client.post("/api/tasks", json={"title": "First task"})
    assert client.get("/api/tasks/stats").json()["total"] == 1

def test_metrics(client):
    assert "http_requests" in client.get("/metrics").text
