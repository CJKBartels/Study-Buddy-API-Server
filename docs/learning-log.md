# Learning Log

Design decisions and lessons from working in this codebase.
Newest entries at the top.

## 2026-10-22 — A docs agent, checked by hand and then by a test

- **Task:** fix the API docs after `GET /assignments` turned out to document 2 path params it doesn't have.
- **Decision:** a project subagent, `.claude/agents/openapi-auditor.md`, that audits one router at a time against a 7-point checklist (path, path and query params, body, response shape, errors from the whole middleware chain, security) and edits only `@openapi` blocks and `swagger.js` components. It reports suspected code bugs instead of documenting them. Each run was checked by hand (`git diff`, the full suite, live responses from the Docker stack) and committed on its own. The one mistake that's mechanical to spot, path params that don't match the path, is now a test.
- **Alternatives considered:** a skill loaded into the main conversation (interactive, but 46 routes would fill its context); more tests only (deterministic and free in CI, but they can't judge whether a response shape matches what a helper builds).
- **Lesson:** the coverage test checked that each route had a doc block, and the blocks were still wrong in every router: missing query params, `id` vs `_id`, wrapped vs bare responses, a password the model never sends. "Documented" and "correct" are different checks. The audit also surfaced code bugs the tests never hit, mostly 500s from Express 5 leaving `req.body` undefined, filed as #29 and #30. Verify an agent's claims before passing them on: one claim I "disproved" was right, and my check was wrong (PowerShell counts an empty response as 1 item).
- **Revisit:** the agent's limits are partly instructions, not enforcement (it can edit any file), so its diffs still need review. The docs stay correct only if the agent is rerun when routes change.

## 2026-10-22 — Seed script: reset the demo, recognized by fixed ids

- **Task:** fill the live demo with data (#9): a demo user with a public password, a course, assignments with that user's progress, and a study session with messages. `npm run seed` must be safe to re-run.
- **Decision:** each run deletes the demo data, then creates it again through the models (`create` runs the password-hashing hook; `insertMany` would skip it). The demo accounts have fixed ids and the course a fixed join code, so the reset finds them whatever visitors changed. `seedDemo()` lives in `src/db` and has no try/catch; `src/scripts/seed.js` is the boundary that prints a message, sets the exit code, and always disconnects.
- **Alternatives considered:** create only what's missing, matched by name (never deletes, but can't repair edits, and a deleted account leaves orphans); seed only an empty database (simplest, but the only repair is wiping real users too). Seeding through HTTP requests (exercises the routes, but needs a running server and is slow).
- **Lesson:** a reset needs a stable way to recognize its own data. The first draft found demo accounts by email domain; a test that deleted the demo account showed the next run couldn't find that account's availability, and a copy piled up. Names and emails belong to whoever controls the account; fixed ids don't. Also, catch errors only where you can do something with them: the script's caller (terminal or test) decides what failure looks like, so the seeding code lets errors through.
- **Revisit:** the reset must be updated when a new model points at users or courses, or demo rows of that model pile up. Deleting a real account still leaves orphans (#27).

## 2026-10-21 — Health check: readiness, not liveness

- **Task:** add `GET /health` (#6) for App Platform's health check and an uptime monitor for the demo.
- **Decision:** one endpoint, no token. It returns 200 when Mongoose's `connection.readyState` is "connected", and otherwise throws `DATABASE_UNAVAILABLE` (503) with the state in `details`, so it uses the same error envelope as every other route. It goes in App Platform's readiness check only.
- **Alternatives considered:** ping the database on every request (proves a round trip works, but costs a query per check and can hang on a slow database); two endpoints, one for "process is up" and one for "database is up" (more precise, but nothing here needs the split yet).
- **Lesson:** a readiness check answers "should this container get traffic?" and a liveness check answers "should it be restarted?". A database check belongs in readiness only. As a liveness check, an Atlas outage would make the platform restart a healthy API over and over, which can't fix a database on another server.
- **Revisit:** `readyState` can say "connected" a moment after the database stops answering, until the driver notices. The error handler logs every 5xx, so a database outage logs one line per health check.

## 2026-10-21 — Docker: a build we control, and fail-fast startup

- **Task:** containerize the API (#8) and make startup fail loudly when MongoDB is unreachable. The first App Platform build had just failed: its buildpack picked Node 22 / npm 10, which rejected the npm 11 lockfile.
- **Decision:** a `node:24-alpine` Dockerfile (production dependencies only, non-root `node` user) that App Platform builds from and CI builds on every PR. `docker-compose.yml` adds a local MongoDB with a named volume and a healthcheck the API waits on. `server.js` awaits `connectDatabase()` and exits with code 1 on failure. `engines` pins Node 24 too, and the unused Swagger editor packages are gone.
- **Alternatives considered:** keep App Platform on its buildpack (no Dockerfile needed, but DigitalOcean picks the build, and CI would test a different build than production runs); keep a Dockerfile only for local use (two build paths that can drift apart). For startup, connect in the background and keep listening (the API stays up but answers every request with a 500, and the platform sees a healthy process).
- **Lesson:** a container's own disk is temporary. Each rebuild or deploy starts from the image again, so anything that must survive lives in a volume or an outside service. Compose services reach each other by service name on a private network, and nothing outside that network gets in except through a published port. Publishing a passwordless database on `127.0.0.1` keeps it to this machine.
- **Revisit:** Node 24 is set in 3 places (Dockerfile, `ci.yml`, `engines`) that must change together. The App Platform component still has to be switched to the Dockerfile at deploy time.

## 2026-10-20 — Assignment lists: absence means default

- **Task:** stop the assignment lists from writing a state doc per assignment on every view, and stop copying due dates into personal state (#15).
- **Decision:** two plain queries (the assignments, then only this user's states for them) merged by a plain function, `withUserState`. A missing state means the defaults; `personalDueAt` is stored only when the user picks a date, and every reader shows `personalDueAt ?? assignment.dueAt`. `findOrCreate` switched to `$setOnInsert`.
- **Alternatives considered:** keep the aggregation and fix its `$lookup` to filter by user (one round trip, but a denser pipeline in two places). Rejected because the density is how the bug hid.
- **Lesson:** probing before designing found two bugs worse than the issue described. The `$lookup` joined states by assignment only, so every member saw classmates' states and private notes; and `findOrCreate`'s plain update rewrote `personalDueAt` on every call. A third probe found `GET /assignments` returning admin-only join codes. Store overrides, not copies: a copied default goes stale the moment the source changes, while a computed one can't.
- **Revisit:** no data migration for old copied due dates (no real data). Old copies still read as personal dates until cleared.

## 2026-10-20 — Session follow-ups: consistent responses, leave, waitlist promotion

- **Task:** finish the follow-ups from #3 (#18): plain-string and raw-result responses, RSVP's decision in the URL, no way to leave, no waitlist promotion.
- **Decision:** one rule for success responses: if the thing still exists, return it; if it's gone, 204. RSVP takes `{ status }` in the body. Leave is `DELETE .../participants/me` (the host can't leave). Promotion is a helper, `promoteFromWaitlist`, called by leave, remove, and capacity changes; each promotion is one atomic `findOneAndUpdate` on the oldest waitlisted participant.
- **Alternatives considered:** 204 everywhere (the client refetches to see state) or documents everywhere (nothing to return for real deletes). For promotion, Mongoose save hooks (can't be forgotten, but invisible, and join/invite write with `findOneAndUpdate`, which skips save hooks).
- **Lesson:** route order is behavior. Before the leave route existed, `DELETE .../participants/me` matched `/participants/:userId` with `userId = "me"` and returned a 400 for the wrong reason, which made one new test pass by accident. Specific paths go first, and a test that passes before the code exists deserves a second look.
- **Revisit:** promoted users aren't told; notifications come after the WebSocket milestone. Lowering capacity never demotes anyone. Promotion counts then promotes, so simultaneous triggers could over-fill by one, the same accepted race as joining.

## 2026-10-19 — Token expiry, pruning, and atomic token writes

- **Task:** make auth tokens expire and stop `user.tokens` growing forever (#13).
- **Decision:** 7-day tokens and re-login, no refresh tokens. Each stored token keeps an `expiresAt` copied from its `exp`, and sign-in `$pull`s expired and pre-expiry tokens before `$push`ing the new one. `auth` refuses tokens with no `exp`.
- **Alternatives considered:** short access tokens plus stored refresh tokens (no DB lookup per request and a 15-minute leak window, but a new endpoint, frontend refresh logic, and sign-out stops being instant). Rejected because the stored token list already gives instant revocation, which is the main thing refresh tokens add. For pruning, decoding every stored JWT instead of storing `expiresAt` (slower, and code where a query would do).
- **Lesson:** a read-modify-write on a shared list (`concat` + `save()`) loses updates under concurrency. Here Mongoose's version check turned the conflict into a `VersionError`, and a catch-all in the sign-in route reported it as "invalid email or password" to a user with the right password. Use `$push`/`$pull` for list changes, and catch only the errors you mean to translate. Also: two JWTs with the same payload in the same second are identical strings; `jwtid` makes them unique.
- **Revisit:** the simultaneous sign-out test passes on the old code too, so it guards but doesn't prove that race. Existing users are signed out once when this deploys.

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
