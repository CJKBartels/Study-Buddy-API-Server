# Phase 1 Bug Fixes — Issue Tracker

_Created: 2026-06-27. Source: `Study-Buddy/docs/ARCHITECTURE.md` §3 +
`ROADMAP.md` Phase 1._

These are the MVP-blocking bugs in the API server. Each issue is written to be
**paste-ready as a GitHub issue** and **ready to hand to Claude Code as a
prompt**. Suggested order: SB-1 → SB-2 → SB-3 → SB-4 → SB-5 (independent, but
this groups them by file/risk).

To file these on GitHub from the repo, Claude Code (or you) can run, e.g.:

```sh
gh issue create --title "SB-1: Sessions list not scoped to course" --body-file - <<'EOF'
...issue body...
EOF
```

Status: ⬜ open · 🟠 in progress · ✅ fixed

---

## SB-1 — `GET /courses/:courseId/sessions` returns sessions from every course  ✅

- **Severity:** High (correctness, data leak across courses)
- **File:** `src/routers/session.js` — the "Get Sessions" handler

**Problem.** The handler builds `filter` from `mine`, `status`, `from`, `to`,
but never constrains it to the course in the URL. `Session.find(filter)` with no
`course` therefore returns **every session in the database**, not just the
current course's.

**Impact.** Users see (and can page through) sessions belonging to courses they
aren't in. Breaks the sessions list for the whole app.

**Fix.** Initialize the filter with the course from the route (already attached
by `isCourse`/`isCourseMember` middleware):

```js
let filter = { course: req.course._id }
```

Also consider: default `status` to `scheduled` unless asked, and sort by
`startsAt`.

**Acceptance.**
- Listing sessions for course A never returns a session whose `course` is B.
- A member of A who is not in B gets only A's sessions.
- Existing `mine` / `status` / `from` / `to` filters still work, ANDed with the
  course constraint.

---

## SB-2 — "Leave course" route is unreachable (route-ordering bug)  ✅

- **Severity:** High (a documented feature simply doesn't work)
- **File:** `src/routers/course.js`

**Problem.** `DELETE /courses/:courseId/members/:userId` (admin-only) is declared
**before** `DELETE /courses/:courseId/members/me`. Express matches top-down, so a
request to `.../members/me` is captured by `:userId = "me"` and hits the
admin-only handler. A normal member can never leave a course, and the handler
then tries to operate on a user whose id is the literal string `"me"`.

**Fix.** Declare the specific `/members/me` route **above** the
`/members/:userId` route. (General rule, now in CONVENTIONS: specific paths
before param paths.)

**Acceptance.**
- A non-admin member can `DELETE /courses/:id/members/me` and is removed.
- `DELETE /courses/:id/members/:userId` still works for admins on other users.
- Hitting `/members/me` never reaches the admin-only handler.

---

## SB-3 — `joinCode` leaks from course read endpoints  ✅

- **Severity:** High (security — invite codes are effectively passwords)
- **File:** `src/routers/course.js` — "Get Courses" and "Get Course" handlers

**Problem.**
1. `GET /courses` does `Course.find()` with no projection, returning `joinCode`
   for every course. Anyone authenticated can read every course's invite code.
2. `GET /courses/:courseId` does `delete course.joinCode` on a Mongoose
   **document**, which does not reliably strip the field from the serialized
   response.

**Fix.**
- For the list: project out the code — `Course.find({}, { joinCode: 0 })` (and
  decide whether the list should be limited to public courses / the user's
  courses at all — see ARCHITECTURE Q2).
- For the single course: use the existing `Course.findPublicCourse(id)` static
  (it already projects `joinCode: 0`), or `.lean()` then delete.
- Only return `joinCode` to course admins/moderators (e.g. a dedicated
  `GET /courses/:id/joinCode` guarded by `isCourseAdmin`).

**Acceptance.**
- No `joinCode` field appears in `GET /courses` or `GET /courses/:id` responses
  for a normal member.
- An admin can still retrieve the code through an explicitly-authorized route.

---

## SB-4 — `GET /courses/:courseId/sessions/:sessionId` isn't course-scoped and hangs on error  ✅

- **Severity:** Medium
- **File:** `src/routers/session.js` — the "Get Session" handler

**Problem.** It does `Session.findById(req.params.sessionId)` without checking
the session belongs to `:courseId`, so a valid session id from another course is
returned. Its `catch` only `console.log`s — on any error the client gets **no
response** and the request hangs.

**Fix.**
- Query with both ids: `Session.findOne({ _id: sessionId, course: req.course._id })`.
- Return `404` when not found; always send a response in `catch` (e.g. `500`
  with the standard error envelope).

**Acceptance.**
- Fetching a session id that belongs to another course returns `404`.
- Errors return a JSON error response, never hang.

---

## SB-5 — Minor correctness: message date filter + RSVP waitlist enum  ✅

- **Severity:** Low–Medium (silent no-ops)
- **File:** `src/routers/session.js`

**Problem A — message date filter.** The "Get Messages" handler assigns the
`before`/`after` range to `filter.startsAt`, but `SessionMessage` has no
`startsAt` field (it uses `sentAt` / `createdAt`). The date filter silently does
nothing.

**Fix A.** Assign to `filter.sentAt` (the schema aliases `createdAt` to
`sentAt`). Also add pagination defaults/caps for `offset`/`limit`.

**Problem B — RSVP waitlist branch.** The RSVP handler checks
`participantDoc.status == 'waitlist'`, but the `SessionParticipant` enum value is
`'waitlisted'`. The branch never runs.

**Fix B.** Compare against `'waitlisted'`. (When capacity/waitlist is actually
implemented in Phase 4, revisit this flow.)

**Acceptance.**
- `GET .../messages?after=<ts>` returns only messages at/after `ts`.
- The waitlist comparison uses the real enum value.

---

## Not in this batch (tracked elsewhere)

These are real but not MVP-blocking; they live in
`Study-Buddy/docs/ROADMAP.md` Phase 4 / ARCHITECTURE §3:

- Central error envelope + error-handling middleware (replaces string/emoji
  responses).
- Server-side token pruning on logout.
- Capacity/waitlist enforcement.
- Duplicate/over-broad CORS; add `helmet`. (Rate limiting: done in #7.)
- Input validation layer; pagination guards everywhere.
- Frontend: env-based API URL + global 401 handling (`Study-Buddy/src/assets/fetch.js`).
