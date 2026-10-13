# Study Buddy API

[![CI](https://github.com/CJKBartels/Study-Buddy-API-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/CJKBartels/Study-Buddy-API-Server/actions/workflows/ci.yml)

Study Buddy helps students in the same course find each other and get work done together. You join a course with a join code, post and track assignments with your classmates, and set up study sessions with invites, RSVPs, and a session chat.

This repo is the REST API: Express 5, MongoDB through Mongoose, and JWT auth. The frontend lives in [Study-Buddy](https://github.com/CJKBartels/Study-Buddy).

## Architecture

```mermaid
flowchart LR
    SPA["Study Buddy SPA<br/>(separate repo)"] -- "HTTPS + JSON<br/>Bearer token" --> Router

    subgraph API["Express API"]
        direction TB
        Router["Routers"] --> Chain["Access chain<br/>auth → isCourse → isCourseMember → ..."]
        Chain --> Handler["Route handler"]
        Handler --> Models["Mongoose models"]
        Chain -. "throw AppError" .-> Errors["errorHandler<br/>one error envelope"]
        Handler -. "throw AppError" .-> Errors
    end

    Models --> DB[("MongoDB Atlas")]
```

Every request passes through an access chain of middleware before it reaches a handler. Anything that goes wrong along the way is thrown as an `AppError`, and one error handler at the end turns it into the same JSON shape.

Sign-in issues a JWT and stores it on the user, which is what makes per-device sign-out possible:

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant D as MongoDB
    C->>A: POST /user/sign-in (email, password)
    A->>D: find user, check bcrypt hash
    A->>D: push new JWT onto user.tokens
    A-->>C: user + token
    C->>A: GET /users/me (Authorization: Bearer token)
    A->>D: find user by JWT id AND token still in user.tokens
    A-->>C: 200 user
    C->>A: POST /user/sign-out
    A->>D: remove this token from user.tokens
    Note over C,D: tokens on the user's other devices keep working
```

## Data model

9 Mongoose models. The 3 join collections (`CourseMembership`, `AssignmentUserState`, `SessionParticipant`) carry most of the rules, and each has a compound unique index so the database itself rejects duplicates.

```mermaid
erDiagram
    USER ||--o{ COURSE_MEMBERSHIP : "joins courses through"
    COURSE ||--o{ COURSE_MEMBERSHIP : has
    COURSE ||--o{ ASSIGNMENT : has
    USER ||--o{ ASSIGNMENT : creates
    ASSIGNMENT ||--o{ ASSIGNMENT_USER_STATE : "tracked per user in"
    USER ||--o{ ASSIGNMENT_USER_STATE : owns
    COURSE ||--o{ SESSION : has
    USER ||--o{ SESSION : hosts
    SESSION ||--o{ SESSION_PARTICIPANT : has
    USER ||--o{ SESSION_PARTICIPANT : "takes part as"
    SESSION ||--o{ SESSION_MESSAGE : contains
    USER ||--o{ SESSION_MESSAGE : sends
    USER ||--o| AVAILABILITY : sets

    USER {
        string username UK
        string email UK
        array tokens "issued JWTs"
    }
    COURSE_MEMBERSHIP {
        ObjectId course FK "unique together with user"
        ObjectId user FK
        string role "member, moderator, admin"
        string status "active, banned"
    }
    ASSIGNMENT_USER_STATE {
        ObjectId assignment FK "unique together with user"
        ObjectId user FK
        ObjectId course FK
        string state "not_started, in_progress, complete"
        string personalNotes
        date personalDueAt
    }
    SESSION_PARTICIPANT {
        ObjectId session FK "unique together with user"
        ObjectId user FK
        string status "invited, accepted, declined, waitlisted, removed, left"
    }
    AVAILABILITY {
        ObjectId user FK "one per user"
        array blocks "weekly time ranges"
    }
```

## Design decisions

### Per-user progress lives in its own model

Assignments are shared by the whole course. Any member can post one, and moderators can stamp it as official. Progress is personal, though: my "in progress" and my notes shouldn't change what you see.

So `AssignmentUserState` holds one document per (assignment, user) pair, with the state, personal notes, and a personal due date. A unique index on `(assignment, user)` makes duplicates impossible, and a single model method, `findOrCreate`, is the only code that creates these documents. It's an atomic upsert, so two first visits at the same moment still produce one document.

**Tradeoff:** states are created lazily, the first time a user lists a course's assignments. That request pays one upsert per assignment. Embedding a progress array inside each assignment would skip the extra collection, but then every student's update would rewrite the same shared document.

### Tokens live on the user so one device can sign out

A JWT stays valid until it expires, and the server has no built-in way to take one back.

Every sign-in pushes its token onto `user.tokens`. The `auth` middleware accepts a token only if its signature checks out and it's still in that array. Signing out removes that one token, so signing out on your laptop leaves your phone signed in.

**Tradeoff:** every authenticated request does a database lookup, which gives up the main draw of JWTs (verifying without a lookup). Tokens also never expire yet, and the array only grows. [#13](https://github.com/CJKBartels/Study-Buddy-API-Server/issues/13) adds expiry and cleanup.

### Access checks are a middleware chain that loads documents

Almost every route has to answer the same questions before doing anything. Are you signed in? Does this course exist? Are you a member, a moderator, banned?

Each question is one middleware. It validates the id, loads the document, rejects with the right error, and attaches what it loaded to `req` (`req.user`, `req.course`, `req.courseMembership`). A route's access policy is readable straight off its definition:

```js
router.patch('/courses/:courseId/sessions/:sessionId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    handler)
```

Handlers trust what's on `req` instead of checking again.

**Tradeoff:** the order matters and nothing enforces it (`isCourseMember` needs the `req.user` that `auth` sets), and each step is its own query. The checks are also tied to Express's `req` and `res`, so real-time messaging over WebSockets will need them pulled out into plain functions that both paths call.

### Every error has the same shape

Routes throw `new AppError('COURSE_NOT_FOUND')`. The HTTP status and default message come from one registry (`src/assets/errorCodes.js`), and a single error middleware turns everything into this:

```json
{ "error": { "code": "COURSE_NOT_FOUND", "message": "Course does not exist" } }
```

That includes errors the code never throws itself: Mongoose validation, cast, and duplicate-key errors, JWT errors, and malformed JSON. Express 5 forwards rejected async handlers to the error middleware, so routes don't need try/catch. The frontend can branch on `code` instead of parsing messages.

**Tradeoff:** unexpected errors return a generic 500 and get logged on the server. That keeps stack traces out of responses, but debugging means reading server logs. The session and availability routers still return the old mix of plain strings and ad-hoc JSON (one returns an emoji); [#3](https://github.com/CJKBartels/Study-Buddy-API-Server/issues/3) and [#4](https://github.com/CJKBartels/Study-Buddy-API-Server/issues/4) move them over.

## Testing

176 tests run with Vitest. Router tests drive the real Express app through supertest: create a user, sign in, use the token. So `auth` and the access chain run in every test, the same way they do in production.

The database is a real `mongod` that [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server) starts in memory. Tests never touch Atlas and need no setup, and every collection is wiped before each test.

The suite covers:

- sign-up, sign-in, and sign-out, including revoking one token while others keep working
- role checks: members can't do moderator or admin actions, and non-members can't see a course's members, assignments, or join code
- per-user state: one user's progress never shows up for another
- validation failures and the error envelope

CI runs lint and the full suite on every pull request into `main`. `main` only accepts pull requests that pass.

## Running locally

You need Node 24 (what CI uses) and a MongoDB connection string, either Atlas or a local `mongod`.

```sh
cp .env.example .env   # fill in MONGODB_URL and JSON_WEB_TOKEN_SECRET
npm install
npm run dev            # starts on PORT from .env (3000 in the example)
```

Interactive API docs (Swagger UI) are at `http://localhost:3000/api-docs`. The users, courses, and assignments routes are documented so far; [#5](https://github.com/CJKBartels/Study-Buddy-API-Server/issues/5) adds the rest.

```sh
npm test               # full suite once, no database needed
npm run test:watch     # re-run on save
npm run lint
```

## API at a glance

| Area | Routes |
| --- | --- |
| Accounts | `POST /users`, `POST /user/sign-in`, `POST /user/sign-out`, `/users/me` |
| Courses | `/courses`, `POST /courses/join/:joinCode`, `/courses/:courseId/members` |
| Assignments | `/courses/:courseId/assignments`, your progress at `/courses/:courseId/my/assignments`, everything across courses at `GET /assignments` |
| Study sessions | `/courses/:courseId/sessions`, with participants, invites, RSVPs, and messages underneath |
| Availability | `/availability/me` |

## Roadmap

Work is tracked in the [Revamp milestone](https://github.com/CJKBartels/Study-Buddy-API-Server/milestone/1): moving the remaining routers to the shared error handling, a health check, rate limiting on auth, Docker, and a seed script for a live demo. Real-time session chat over WebSockets comes after that.

## License

[MIT](LICENSE)
