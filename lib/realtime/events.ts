/**
 * Realtime event validation.
 *
 * The WebSocket is a leaky boundary: a future server version may add
 * event types, payload fields, or subjects we have not yet seen. The
 * manager MUST keep operating when the contract drifts, so this
 * module is structured around narrow predicates that return `true`
 * only when the input is a well-formed evidence of the documented
 * shape.
 *
 * Conventions:
 * 1. Every predicate is pure. No side effects, no `Date.now()`, no
 *    `crypto.randomUUID()` — validation is cheap and deterministic.
 * 2. A `false` from a predicate means the manager should drop the
 *    frame silently (it logged the issue at the call site). The
 *    caller is responsible for the structured warning.
 * 3. The wire → view mapping lives in `lib/mappers.ts`; this module
 *    only validates the wire envelope so the manager can run
 *    in any context (browser, Node tests, future SSR).
 *
 * The Subject types (`RealtimeEvent`, `ConnectionStatus`,
 * `CloseReason`) live in `events-types.ts`; this file only adds the
 * runtime guards and re-exports them for callers that want a single
 * import.
 */

import type {
  WireAgent,
  WireComment,
  WireIssue,
  WireReaction,
  WireUser,
  WireWorkspace,
  WireWorkspaceMember,
  WireWsFrame,
  WireWsServerEvent,
} from "../types";
import type { RealtimeEvent } from "./events-types";

export type { RealtimeEvent, ConnectionStatus, CloseReason } from "./events-types";

// ---------------------------------------------------------------------------
// Frame envelope — every inbound frame must satisfy these.
// ---------------------------------------------------------------------------

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Top-level frame shape: `{ type: string, payload: object }`. The
 * payload type is `unknown` here; the per-event validators below
 * narrow it.
 */
export function isWsFrame(value: unknown): value is WireWsFrame<string, unknown> {
  if (!isObject(value)) return false;
  if (!isString(value.type)) return false;
  if (!("payload" in value)) return false;
  // The server's `pong` and `auth_ack` carry an empty payload —
  // accept the literal `{}` but reject anything else that is not an
  // object (the manager treats arrays as malformed).
  if (value.payload !== null && typeof value.payload !== "object") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Per-event predicates. Each validates the payload shape documented
// in `docs/contracts/multica-api.md` §7.3. They never look at the
// `type` field — the manager dispatches based on `type` first and
// only then calls the matching predicate.
// ---------------------------------------------------------------------------

function isWireIssue(value: unknown): value is WireIssue {
  if (!isObject(value)) return false;
  return (
    isUuid(value.id) &&
    isUuid(value.workspace_id) &&
    typeof value.number === "number" &&
    isString(value.identifier) &&
    isString(value.title) &&
    isString(value.status) &&
    isString(value.priority)
  );
}

function isWireComment(value: unknown): value is WireComment {
  if (!isObject(value)) return false;
  return (
    isUuid(value.id) &&
    isUuid(value.issue_id) &&
    isString(value.author_type) &&
    isUuid(value.author_id) &&
    isString(value.content) &&
    isString(value.created_at) &&
    isString(value.updated_at)
  );
}

function isWireReaction(value: unknown): value is WireReaction {
  if (!isObject(value)) return false;
  return (
    isUuid(value.id) &&
    isString(value.actor_type) &&
    isUuid(value.actor_id) &&
    isString(value.emoji) &&
    isString(value.created_at)
  );
}

function isWireAgent(value: unknown): value is WireAgent {
  if (!isObject(value)) return false;
  return (
    isUuid(value.id) &&
    isUuid(value.workspace_id) &&
    isString(value.name) &&
    isString(value.updated_at)
  );
}

function isWireUser(value: unknown): value is WireUser {
  if (!isObject(value)) return false;
  return isUuid(value.id) && isString(value.name) && isString(value.email);
}

function isWireWorkspaceMember(value: unknown): value is WireWorkspaceMember {
  if (!isObject(value)) return false;
  return isUuid(value.id) && isObject(value.user);
}

function isWireWorkspace(value: unknown): value is WireWorkspace {
  if (!isObject(value)) return false;
  return isUuid(value.id) && isString(value.name) && isString(value.slug);
}

/**
 * Narrow a raw frame to a `RealtimeEvent`. The return is `null` when
 * the frame is structurally well-formed but the payload does not
 * match any subscribed event. The manager logs the original `type`
 * string so the developer can tell "unknown type" from "known type
 * with bad payload".
 */
export function validateRealtimeEvent(frame: WireWsFrame<string, unknown>): RealtimeEvent | null {
  const { type, payload } = frame;
  switch (type) {
    case "issue:created":
    case "issue:updated": {
      if (isObject(payload) && isWireIssue(payload.issue)) {
        return { type, payload: { issue: payload.issue } } as RealtimeEvent;
      }
      return null;
    }
    case "issue:deleted": {
      if (isObject(payload) && isUuid(payload.issue_id)) {
        return { type, payload: { issue_id: payload.issue_id } } as RealtimeEvent;
      }
      return null;
    }
    case "comment:created": {
      if (
        isObject(payload) &&
        isWireComment(payload.comment) &&
        isString(payload.issue_title)
      ) {
        return {
          type,
          payload: {
            comment: payload.comment,
            issue_title: payload.issue_title,
            issue_assignee_type: isString(payload.issue_assignee_type)
              ? payload.issue_assignee_type
              : null,
            issue_assignee_id: isUuid(payload.issue_assignee_id)
              ? payload.issue_assignee_id
              : null,
            issue_status: isString(payload.issue_status) ? payload.issue_status : "",
          },
        } as RealtimeEvent;
      }
      return null;
    }
    case "comment:updated":
    case "comment:resolved":
    case "comment:unresolved": {
      if (isObject(payload) && isWireComment(payload.comment)) {
        return { type, payload: { comment: payload.comment } } as RealtimeEvent;
      }
      return null;
    }
    case "comment:deleted": {
      if (isObject(payload) && isUuid(payload.comment_id)) {
        return { type, payload: { comment_id: payload.comment_id } } as RealtimeEvent;
      }
      return null;
    }
    case "reaction:added":
    case "reaction:removed": {
      if (
        isObject(payload) &&
        isWireReaction(payload.reaction) &&
        isUuid(payload.comment_id)
      ) {
        return {
          type,
          payload: {
            reaction: payload.reaction,
            comment_id: payload.comment_id,
          },
        } as RealtimeEvent;
      }
      return null;
    }
    case "issue_reaction:added":
    case "issue_reaction:removed": {
      if (
        isObject(payload) &&
        isWireReaction(payload.reaction) &&
        isUuid(payload.issue_id)
      ) {
        return {
          type,
          payload: {
            reaction: payload.reaction,
            issue_id: payload.issue_id,
          },
        } as RealtimeEvent;
      }
      return null;
    }
    case "agent:status":
    case "agent:archived":
    case "agent:restored": {
      if (isObject(payload) && isWireAgent(payload.agent)) {
        return { type, payload: { agent: payload.agent } } as RealtimeEvent;
      }
      return null;
    }
    case "member:added":
    case "member:updated":
    case "member:removed": {
      if (
        isObject(payload) &&
        isWireWorkspaceMember(payload.member) &&
        isWireUser(payload.user)
      ) {
        return {
          type,
          payload: {
            member: payload.member,
            user: payload.user,
          },
        } as RealtimeEvent;
      }
      return null;
    }
    case "workspace:updated": {
      if (isObject(payload) && isWireWorkspace(payload.workspace)) {
        return { type, payload: { workspace: payload.workspace } } as RealtimeEvent;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Type guard for the full `WireWsServerEvent` union the server may
 * emit. Used by the manager's protocol-noise branch (auth_ack,
 * auth_error, pong, subscribe_ack / unsubscribe_ack /
 * subscribe_error) to narrow the payload before acting.
 */
export function isWsServerEvent(value: unknown): value is WireWsServerEvent {
  return isWsFrame(value);
}

/**
 * Convenience: confirm a `value` is one of the `RealtimeEvent` types.
 * Useful in tests that want a single boolean predicate.
 */
export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!isWsFrame(value)) return false;
  return validateRealtimeEvent(value) !== null;
}
