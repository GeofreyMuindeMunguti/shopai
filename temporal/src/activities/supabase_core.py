from __future__ import annotations
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Dict

from temporalio import activity

from ..supabase_client import SupabaseError, get_supabase
from ._context import supabase_app_error

logger = logging.getLogger(__name__)


@dataclass
class EntityResult:
    entity_id: str
    version_id: str
    success: bool = True
    error: str | None = None


def _uuid_or_none(value: str | None) -> str | None:
    try:
        return str(uuid.UUID(str(value))) if value else None
    except ValueError:
        return None


@activity.defn
def create_entity(entity_type: str, attributes: Dict[str, Any], created_by: str | None = None) -> EntityResult:
    db = get_supabase()
    try:
        entity = db.insert("entities", {"entity_type": entity_type})[0]
        version = db.insert("entity_versions", {"entity_id": entity["id"], "version_number": 1, "data": attributes})[0]
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc
    logger.info("entity created entity_type=%s entity_id=%s created_by=%s", entity_type, entity["id"], created_by)
    return EntityResult(entity_id=entity["id"], version_id=version["id"])


@activity.defn
def update_entity_scd2(entity_id: str, attributes: Dict[str, Any], updated_by: str | None = None) -> EntityResult:
    db = get_supabase()
    try:
        latest = db.select("entity_versions", {"entity_id": f"eq.{entity_id}", "select": "version_number",
                                               "order": "version_number.desc", "limit": "1"})
        number = (latest[0]["version_number"] if latest else 0) + 1
        # The SCD2 trigger closes the previous current version.
        version = db.insert("entity_versions", {"entity_id": entity_id, "version_number": number, "data": attributes})[0]
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc
    logger.info("entity version created entity_id=%s version=%d updated_by=%s", entity_id, number, updated_by)
    return EntityResult(entity_id=entity_id, version_id=version["id"])


@activity.defn
def get_entity(entity_id: str) -> Dict[str, Any]:
    try:
        rows = get_supabase().select("entity_versions", {"entity_id": f"eq.{entity_id}", "is_current": "eq.true",
                                                         "select": "entity_id,version_number,data"})
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc
    if not rows:
        return {"entity_id": entity_id}
    return {"entity_id": entity_id, "version_number": rows[0]["version_number"], **(rows[0].get("data") or {})}


@activity.defn
def append_event(entity_id: str, entity_type: str, event_type: str, event_data: Dict[str, Any], actor_id: str | None = None, correlation_id: str | None = None) -> bool:
    row = {
        "entity_type": entity_type,
        "entity_id": _uuid_or_none(entity_id),
        "event_type": event_type,
        "data": event_data if _uuid_or_none(entity_id) else {**event_data, "entity_ref": entity_id},
        "actor_id": _uuid_or_none(actor_id),
        "correlation_id": correlation_id,
    }
    try:
        get_supabase().insert("audit_events", row)
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc
    logger.info("event appended entity_type=%s event_type=%s correlation_id=%s", entity_type, event_type, correlation_id)
    return True


@activity.defn
def create_relationship(from_entity_id: str, to_entity_id: str, relationship_type: str, attributes: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        row = get_supabase().insert("relationships_v2", {"relationship_type": relationship_type, "parent_id": from_entity_id,
                                                         "child_id": to_entity_id, "metadata": attributes or {}})[0]
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc
    return {"relationship_id": row["id"], "success": True}
