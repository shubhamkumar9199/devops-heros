"""Business metrics for Prometheus, next to the HTTP metrics from the instrumentator.

Counters count events seen by this replica, so sum() them across pods. Gauges are
read from the database at scrape time, so every replica reports the same value:
use max() on them, not sum().
"""

from __future__ import annotations

import logging

from prometheus_client import REGISTRY, Counter, Gauge
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector

from app import clock, policy
from app.config import settings

log = logging.getLogger(__name__)

LOANS_CREATED = Counter("shelfwise_loans_created_total", "Loans issued")
RETURNS = Counter("shelfwise_returns_total", "Loans returned, by whether they were late", ["late"])
HOLDS_PROMOTED = Counter("shelfwise_holds_promoted_total", "Returned copies handed straight to a waiting member")
FINES_COLLECTED = Counter("shelfwise_fines_collected_rupees_total", "Fines paid, in rupees")
RULE_REJECTIONS = Counter(
    "shelfwise_rule_rejections_total", "Requests refused by a lending rule (HTTP 409), by rule", ["code"]
)
BUILD_INFO = Gauge("shelfwise_build_info", "The build this pod runs", ["version", "pod"])


class LibraryCollector(Collector):
    """Reads the library's state from the database on every scrape."""

    def collect(self):
        from app import services
        from app.db import SessionLocal

        db_up = GaugeMetricFamily("shelfwise_db_up", "1 when the scrape could read the database")
        try:
            with SessionLocal() as db:
                s = services.stats(db, clock.now())
        except Exception:  # a scrape must never fail because the DB is down
            log.warning("metrics scrape could not read the database", exc_info=True)
            db_up.add_metric([], 0)
            yield db_up
            return
        db_up.add_metric([], 1)
        yield db_up

        def gauge(name: str, doc: str, value: float) -> GaugeMetricFamily:
            return GaugeMetricFamily(name, doc, value=value)

        yield gauge("shelfwise_books", "Titles in the catalogue", s["books"])
        yield gauge("shelfwise_members_active", "Active library members", s["members_active"])
        yield gauge("shelfwise_loans_active", "Loans currently out", s["loans_active"])
        yield gauge("shelfwise_loans_overdue", "Active loans past their due date", s["loans_overdue"])
        yield gauge("shelfwise_fines_outstanding_rupees", "Unpaid fines, in rupees", s["fines_outstanding"])
        copies = GaugeMetricFamily("shelfwise_copies", "Copies by circulation status", labels=["status"])
        for status in policy.COPY_STATUSES:
            copies.add_metric([status], s["copies_by_status"].get(status, 0))
        yield copies
        holds = GaugeMetricFamily("shelfwise_holds_open", "Open holds by state", labels=["state"])
        holds.add_metric(["waiting"], s["holds_waiting"])
        holds.add_metric(["ready"], s["holds_ready"])
        yield holds


_registered = False


def register() -> None:
    """Called once at startup (the test client starts the app more than once)."""
    global _registered
    if _registered:
        return
    REGISTRY.register(LibraryCollector())
    BUILD_INFO.labels(version=settings.version, pod=settings.pod_name).set(1)
    _registered = True
