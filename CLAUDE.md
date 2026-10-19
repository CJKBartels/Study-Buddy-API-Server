# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **REST API** for Study Buddy, a site where students in the same course find
each other, plan study sessions, and track shared coursework. The frontend SPA
lives in a separate repo, `Study-Buddy`.

## Product docs (in the frontend repo)

Product-level docs cover **both** repos and live in `Study-Buddy/docs/`:

- `MVP.md`: scope and "done" criteria.
- `ROADMAP.md`: feature list and live status (including backend bugs).
- `ARCHITECTURE.md`: decisions, trade-offs, **code critiques**, open questions.
  Read §3 (critiques) before changing routes or models.

That repo is **not** checked out next to this one. Ask where it lives before
relying on it. Backend-only bug tracking is in `docs/ISSUES.md` (SB-n issues).

## Commands

```sh
npm run dev                 # env-cmd + nodemon on src/server.js (reads .env)
npm start                   # node src/server.js
npm test                    # run all tests once (same command CI runs)
npm run test:watch          # vitest in watch mode
npm test -- tests/routers/course.test.js      # one file
npm test -- -t "returns 201"                  # tests whose name matches
npm run lint                # eslint (style: no semicolons, single quotes, 1tbs)
npm run api                 # serve the standalone swagger editor
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, and `npm test` on
pushes to `main` and on PRs into `main`. `package-lock.json` is committed. Commit it with
any dependency change, or `npm ci` fails.

`.env` needs `PORT`, `MONGODB_URL`, `JSON_WEB_TOKEN_SECRET`. Tests need none of
these. They start their own in-memory MongoDB.

## Architecture

**`app.js` vs `server.js`.** `src/app.js` builds and exports the Express app
without connecting to the DB or listening. `src/server.js` imports
`db/mongoose.js` (the DB connection side effect) and calls `listen`. Tests import
`app` directly with `supertest`. Keep `app.js` free of side effects.

**Access control is a middleware chain that loads resources onto `req`.** Routes
compose `auth → isCourse → isCourseMember | isCourseModerator | isCourseAdmin →
isAssignment / isSession …`. Each step validates the ObjectId, loads the document,
and attaches it (`req.user`, `req.token`, `req.course`, `req.courseMembership`,
…). Handlers read from `req` instead of re-querying. Role/ban checks live in
`middleware/courseAccess.js`, not in handlers.

**Membership is modeled as join collections.** These are `CourseMembership`
(role: member/moderator/admin, status: active/banned), `SessionParticipant`, and
`AssignmentUserState` (one user's progress on a shared assignment). Each has a
compound unique index. Write rows under a unique index through **one atomic code
path** (for example `AssignmentUserState.findOrCreate`, an upsert), never
`findOne` followed by `create`.

**Session participant status is a state machine.** `SessionParticipant` has an
`ALLOWED_MOVES` table and `participant.canMoveTo(status)`. Routes check it before
changing `status`, never set it directly. The table says *which* changes exist.
Routes add rules about *who* may make them (only the host re-invites a removed
user; RSVP and join can't promote a waitlisted user).

**Auth tokens are stateful.** `user.generateAuthToken()` pushes each JWT onto
`user.tokens`. `auth` requires the token to still be in that array, so sign-out
works by removing it.

**Errors: one envelope, central handler (migration in progress).** Throw
`new AppError('CODE', { message?, details? })` (`src/assets/AppError.js`). Status
and default message come from `src/assets/errorCodes.js`. Add new codes there.
`middleware/errorHandler.js` (mounted last) turns every error into
`{ error: { code, message, details? } }`, including Mongoose
validation/cast/duplicate-key errors and JWT errors. Express 5 forwards rejected
async handlers automatically, so routes just `throw` without try/catch.
- Migrated: `user`, `course`, `assignments`, `session` routers; `auth`,
  `courseAccess`, `assignmentAccess`, `sessionAccess` middleware.
- **Not yet migrated** (still `res.status(...).send(...)` with mixed shapes):
  the `availability` router. When you touch it, convert to `AppError`.
  `src/assets/error.js` (`sendValidationError`) is the legacy helper.

**Global Mongoose schema settings.** `db/mongoose.js` makes every String field
trimmed and rejects empty strings. `tests/setup.js` repeats these settings
because tests never import `db/mongoose.js`. **Change both together.**

**Swagger.** The spec is built from `@openapi` JSDoc blocks in
`src/routers/**/*.js`. Shared schemas live in `swagger.js` under
`components.schemas`. It is served at `/api-docs`. `user`, `course`, and
`assignments` are documented. `session` and `availability` are not yet.

## Testing

Vitest + supertest + `mongodb-memory-server`. `tests/globalSetup.js` starts one
in-memory Mongo and sets the env vars. `tests/setup.js` connects and wipes every
collection `beforeEach`. `fileParallelism: false` is required because all test
files share that one DB. Router tests build state through the HTTP API (create
user → sign in → use the token) instead of inserting directly.

## Conventions

- Routes are REST, nested under `/courses/:courseId/...`.
- **Declare specific paths before param paths** (`/members/me` before
  `/members/:userId`). An ordering bug of this kind has broken "leave course"
  before.
- Document new routes with `@openapi` JSDoc.
- Functional style preferred. Use meaningful variable names. No `console.log`
  in request paths (startup logging and the 5xx log in `errorHandler` are the
  exceptions).
- Features need tests.

## Learning log

Record design decisions and lessons in `docs/learning-log.md`, newest first,
using the format of the existing entries.

## When you finish something

Update the status in `docs/ISSUES.md` (and `Study-Buddy/docs/ROADMAP.md` if
available). Add design issues to `ARCHITECTURE.md` / `ISSUES.md`.
