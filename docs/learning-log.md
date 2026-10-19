# Learning Log

Design decisions and lessons from working in this codebase.
Newest entries at the top.

## 2026-10-19 — OpenAPI docs: shared error responses and a coverage test

- **Task:** document the session and availability routes (#5), then backfill error responses for the older routers.
- **Decision:** one `Error` schema plus reusable `BadRequest`/`Unauthorized`/`Forbidden`/`NotFound`/`Conflict` responses that list the codes for each status; routes reference the statuses they can return. A test compares registered routes with documented ones and `errorCodes.js` with the response descriptions.
- **Alternatives considered:** success responses only (matches the old routes, but the error envelope stays undocumented); every code written out per route (most precise, most writing, and stale on every new `throw`).
- **Lesson:** docs that nothing checks drift. Comparing the real routes with the spec found 25 undocumented routes, 5 blocks for routes that don't exist (wrong method, wrong path, Express `:param` syntax), and 4 wrong success codes. swagger-jsdoc also drops a block with a YAML mistake (an unquoted colon) with only a console warning. Turning the comparison into a test makes drift fail CI.
- **Revisit:** the test reads Express internals (`router.stack`), so an Express upgrade could break it. Specific codes per route are only text in shared descriptions. Four routers are `express()` apps created with `new Router()` from the default import; harmless, but `express.Router()` is what they mean.

## 2026-10-19 — Availability: validate a draft, then upsert

- **Task:** move the availability router to `AppError` (#4). A probe showed `PUT /availability/me` saved anything (day 9, blocks ending before they start, `Mars/Olympus`).
- **Decision:** validate an unsaved draft with `new Availability(data).validate()`, then write with one `findOneAndUpdate` upsert. Merge overlapping and touching blocks with a plain `mergeBlocks` function after validation.
- **Alternatives considered:** `runValidators: true` on the update (update validators only check fields in the update, and `this` is the query, so "end after start" can't see `startMin`); load or create, then `save()` (full validation, but `findOne` then create on a unique index races).
- **Lesson:** an update is not a save. Mongoose runs the full schema only on document validation. If code writes through updates, it has to validate some other way, or the schema's rules are decoration. Test validation by sending bad data, not by reading the schema.
- **Revisit:** overlapping blocks merge silently; the client sees the merged result in the response.

## 2026-10-19 — Session router: central errors and a participant state machine

- **Task:** move the session router and `sessionAccess` to `AppError` (#3) and fix 6 bugs found in review.
- **Decision:** an `ALLOWED_MOVES` table on `SessionParticipant` with `canMoveTo(status)`, returning a boolean so the model never imports HTTP errors; routes throw. Routes keep the rules about *who* may make a move (host-only re-invite of a removed user; RSVP and join can't promote a waitlisted user). Invites became one user per request. Capacity is count-then-write.
- **Alternatives considered:** fix each bug inline in its route (rules stay scattered across 4 routes, which is how "removed users can rejoin" happened); a session service layer (no other router has one, and it's the WebSocket refactor deferred until WebSocket work). For invites, a batch route with partial success (a 200 that hides failures, a response shape no other route uses, and needs a size cap); the client can loop with `Promise.allSettled` for the same UX. For capacity, an atomic `acceptedCount` on `Session` (no overbooking, but a second copy of the count to keep in sync on every path).
- **Lesson:** a status field with no list of allowed changes lets every route decide for itself, and one of them will get it wrong. A table answers *which* changes exist; it can't answer *who* is asking, so those rules stay with the caller. Also: in an upsert, `$setOnInsert` vs `$set` decides whether existing docs get checked before the write or overwritten before it.
- **Revisit:** capacity can overbook by one under simultaneous joins (accepted). No promotion from the waitlist and no "leave session" route yet. Success responses are still plain strings in cancel, RSVP (says "joined" even on decline), and delete message. RSVP takes its decision from the URL.

## 2026-07-02 — Extract AssignmentUserState.findOrCreate

- **Task:** de-duplicate the "find-or-create a user's assignment state" logic copied across three assignment-router handlers.
- **Decision:** a single model static `AssignmentUserState.findOrCreate(...)` wrapping the atomic, unique-index-backed upsert; call it from all three sites, leave the list-view reshaping in the handlers.
- **Alternatives considered:** batch `findOrCreateMany` (rejected — optimizes an unmeasured N+1 and adds bulk-upsert error handling now); fold the response reshape into the static (rejected — the my-state caller needs the raw doc, so it'd force a flag param / two jobs); a new service layer (rejected — no service layer exists; forks the model-static convention for 4 lines).
- **Lesson:** an invariant the database enforces should have exactly one code path that writes it. The bug existed because three handlers wrote the (assignment, user) relationship and one had drifted to a non-atomic `findOne`→`create`; consolidating to one atomic writer removed the duplication *and* made the code agree with the unique index. When you see a `unique` index, count how many places create rows under it.
- **Revisit:** N+1 upsert loop in the two list endpoints left in place intentionally (unmeasured perf). Minor smells found while testing: POST create returns 200 not 201; PATCH checks field-validity before authorization (400 vs 403).

<!-- Entries are appended by /log. Example entry:

## 2026-07-02 — Volunteer route assignment endpoint

- **Task:** add POST /routes/{id}/assign for coordinator assignment.
- **Decision:** assignment logic in a RouteAssignmentService; route handler stays thin.
- **Alternatives considered:** logic in the controller (faster now, untestable later); DB trigger (invisible business rules).
- **Lesson:** put decisions where they can be unit-tested; handlers translate HTTP, services decide. Pattern: thin controller / service layer.
- **Revisit:** service takes 4 params already — watch for it becoming a god object.
-->
