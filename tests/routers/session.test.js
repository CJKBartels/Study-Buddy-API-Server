import { describe, it, expect } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../../src/app.js'
import SessionMessage from '../../src/models/sessionMessage.js'

const NON_EXISTENT_ID = '000000000000000000000001'

let userCounter = 0
function uniqueUser(overrides = {}) {
    userCounter += 1
    return {
        username: `sessionuser${userCounter}`,
        email: `session${userCounter}@example.com`,
        password: 'Password1!',
        ...overrides
    }
}

// Returns { token, user } for a freshly created, signed-in user.
async function createAndSignIn(overrides = {}) {
    const data = uniqueUser(overrides)
    await request(app).post('/users').send(data)
    const res = await request(app).post('/user/sign-in').send({ email: data.email, password: data.password })
    return res.body
}

async function createCourse(token) {
    const res = await request(app)
        .post('/courses')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseName: 'Intro to Testing', courseCode: 'CS101' })
    return res.body
}

async function joinCourse(token, joinCode) {
    return request(app)
        .post(`/courses/join/${joinCode}`)
        .set('Authorization', `Bearer ${token}`)
}

const baseSession = () => ({
    title: 'Midterm review',
    goal: 'Finish practice exam',
    startsAt: '2030-05-01T18:00:00.000Z',
    endsAt: '2030-05-01T20:00:00.000Z'
})

async function createSession(token, courseId, overrides = {}) {
    return request(app)
        .post(`/courses/${courseId}/sessions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseSession(), ...overrides })
}

// Sends an authenticated request: call('get', token, url).send(...)
function call(method, token, url) {
    return request(app)[method](url).set('Authorization', `Bearer ${token}`)
}

// Common fixture: a host who owns a course and a session in it, plus a course
// member who is not yet part of the session.
async function sessionWithMember(sessionOverrides = {}) {
    const host = await createAndSignIn()
    const course = await createCourse(host.token)
    const member = await createAndSignIn()
    await joinCourse(member.token, course.joinCode)
    const res = await createSession(host.token, course._id, sessionOverrides)
    const session = res.body
    const base = `/courses/${course._id}/sessions/${session._id}`
    return { host, member, course, session, base }
}

describe('session access checks', () => {
    it('returns 400 BAD_REQUEST for a malformed session id', async () => {
        const { host, course } = await sessionWithMember()
        const res = await call('patch', host.token, `/courses/${course._id}/sessions/not-an-id`).send({ title: 'x' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('BAD_REQUEST')
    })

    it('returns 404 SESSION_NOT_FOUND for an unknown session', async () => {
        const { host, course } = await sessionWithMember()
        const res = await call('patch', host.token, `/courses/${course._id}/sessions/${NON_EXISTENT_ID}`).send({ title: 'x' })
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('SESSION_NOT_FOUND')
    })

    it('returns 404 SESSION_NOT_FOUND for a session that belongs to another course', async () => {
        const { session } = await sessionWithMember()
        const outsider = await createAndSignIn()
        const otherCourse = await createCourse(outsider.token)
        const res = await call('patch', outsider.token, `/courses/${otherCourse._id}/sessions/${session._id}`).send({ title: 'x' })
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('SESSION_NOT_FOUND')
    })

    it('returns 403 NOT_SESSION_HOST when a non-host edits the session', async () => {
        const { member, base } = await sessionWithMember()
        const res = await call('patch', member.token, base).send({ title: 'x' })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_HOST')
    })

    it('returns 403 NOT_SESSION_PARTICIPANT when a non-participant reads participants', async () => {
        const { member, base } = await sessionWithMember()
        const res = await call('get', member.token, `${base}/participants`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_PARTICIPANT')
    })

    it('returns 403 NOT_COURSE_MEMBER for a user outside the course', async () => {
        const { base } = await sessionWithMember()
        const outsider = await createAndSignIn()
        const res = await call('get', outsider.token, `${base}/participants`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('POST /courses/:courseId/sessions', () => {
    it('returns 201 with the session and makes the creator an accepted participant', async () => {
        const { member, course } = await sessionWithMember()
        const res = await createSession(member.token, course._id)
        expect(res.status).toBe(201)
        expect(res.body.title).toBe(baseSession().title)
        expect(res.body.host).toBe(member.user._id)
        expect(res.body.status).toBe('scheduled')

        const participants = await call('get', member.token, `/courses/${course._id}/sessions/${res.body._id}/participants`)
        expect(participants.status).toBe(200)
        expect(participants.body).toHaveLength(1)
    })

    it('returns 400 VALIDATION_ERROR when title is missing', async () => {
        const { member, course } = await sessionWithMember()
        const res = await createSession(member.token, course._id, { title: undefined })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.details.title).toBeDefined()
    })

    it('returns 400 VALIDATION_ERROR for fields a client may not set, and creates nothing', async () => {
        const { member, course } = await sessionWithMember()
        const res = await createSession(member.token, course._id, { status: 'cancelled', host: NON_EXISTENT_ID })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(Object.keys(res.body.error.details).sort()).toEqual(['host', 'status'])

        const list = await call('get', member.token, `/courses/${course._id}/sessions?status=cancelled`)
        expect(list.body).toHaveLength(0)
    })
})

describe('GET /courses/:courseId/sessions', () => {
    it('lists scheduled sessions sorted by start time', async () => {
        const { host, course } = await sessionWithMember({ startsAt: '2030-06-01T18:00:00.000Z', endsAt: '2030-06-01T20:00:00.000Z' })
        await createSession(host.token, course._id, { title: 'Earlier' })
        const res = await call('get', host.token, `/courses/${course._id}/sessions`)
        expect(res.status).toBe(200)
        expect(res.body.map((s) => s.title)).toEqual(['Earlier', 'Midterm review'])
    })

    it('leaves out cancelled sessions by default', async () => {
        const { host, course, base } = await sessionWithMember()
        await call('delete', host.token, base)
        const res = await call('get', host.token, `/courses/${course._id}/sessions`)
        expect(res.body).toHaveLength(0)
    })
})

describe('GET /courses/:courseId/sessions/:sessionId', () => {
    it('returns 200 with the session for a course member', async () => {
        const { member, session, base } = await sessionWithMember()
        const res = await call('get', member.token, base)
        expect(res.status).toBe(200)
        expect(res.body._id).toBe(session._id)
    })

    it('returns 404 SESSION_NOT_FOUND for an unknown session', async () => {
        const { member, course } = await sessionWithMember()
        const res = await call('get', member.token, `/courses/${course._id}/sessions/${NON_EXISTENT_ID}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('SESSION_NOT_FOUND')
    })
})

describe('PATCH /courses/:courseId/sessions/:sessionId', () => {
    it('returns 200 and applies allowed updates for the host', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('patch', host.token, base).send({ title: 'Final review' })
        expect(res.status).toBe(200)
        expect(res.body.title).toBe('Final review')
    })

    it('returns 400 INVALID_UPDATES for an empty body', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('patch', host.token, base).send({})
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 INVALID_UPDATES for a field that cannot be changed', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('patch', host.token, base).send({ host: NON_EXISTENT_ID })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })
})

describe('DELETE /courses/:courseId/sessions/:sessionId', () => {
    it('cancels the session for the host', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('delete', host.token, base)
        expect(res.status).toBe(200)
        const after = await call('get', host.token, base)
        expect(after.body.status).toBe('cancelled')
    })

    it('returns 403 NOT_SESSION_HOST for a non-host', async () => {
        const { member, base } = await sessionWithMember()
        const res = await call('delete', member.token, base)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_HOST')
    })
})

async function invite(token, base, userId) {
    return call('post', token, `${base}/invites`).send({ userId })
}

async function rsvp(token, base, decision) {
    return call('patch', token, `${base}/participants/me/${decision}`)
}

// Puts the member through invite -> accept -> removed by the host.
async function removedMember() {
    const fixture = await sessionWithMember()
    const { host, member, base } = fixture
    await invite(host.token, base, member.user._id)
    await rsvp(member.token, base, 'true')
    await call('delete', host.token, `${base}/participants/${member.user._id}`)
    return fixture
}

describe('GET /courses/:courseId/sessions/:sessionId/participants', () => {
    it('lists participants with their usernames', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('get', host.token, `${base}/participants`)
        expect(res.status).toBe(200)
        expect(res.body).toHaveLength(1)
        expect(res.body[0].user.username).toBe(host.user.username)
    })
})

describe('POST /courses/:courseId/sessions/:sessionId/join', () => {
    it('returns 200 and adds the member as accepted', async () => {
        const { member, base } = await sessionWithMember()
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('accepted')
    })

    it('returns 403 SESSION_NOT_OPEN for an invite-only session', async () => {
        const { member, base } = await sessionWithMember({ joinPolicy: 'invite_only' })
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('SESSION_NOT_OPEN')
    })

    it('returns 409 ALREADY_PARTICIPANT when joining twice', async () => {
        const { member, base } = await sessionWithMember()
        await call('post', member.token, `${base}/join`)
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('ALREADY_PARTICIPANT')
    })

    it('accepts a pending invite', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('accepted')
    })

    it('returns 409 INVALID_STATUS_CHANGE for a removed user', async () => {
        const { member, base } = await removedMember()
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE')
    })

    it('returns 409 INVALID_STATUS_CHANGE for a user who declined', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        await rsvp(member.token, base, 'false')
        const res = await call('post', member.token, `${base}/join`)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE')
    })
})

describe('PATCH /courses/:courseId/sessions/:sessionId/participants/me/:decision', () => {
    it('accepting an invite lets the user see participants', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        const res = await rsvp(member.token, base, 'true')
        expect(res.status).toBe(200)
        const participants = await call('get', member.token, `${base}/participants`)
        expect(participants.status).toBe(200)
    })

    it('declining an invite keeps the user out', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        const res = await rsvp(member.token, base, 'false')
        expect(res.status).toBe(200)
        const participants = await call('get', member.token, `${base}/participants`)
        expect(participants.body.error.code).toBe('NOT_SESSION_PARTICIPANT')
    })

    it('returns 403 NOT_INVITED for a user with no invite', async () => {
        const { member, base } = await sessionWithMember()
        const res = await rsvp(member.token, base, 'true')
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_INVITED')
    })

    it('returns 409 ALREADY_PARTICIPANT when accepting twice', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        await rsvp(member.token, base, 'true')
        const res = await rsvp(member.token, base, 'true')
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('ALREADY_PARTICIPANT')
    })

    it('returns 409 INVALID_STATUS_CHANGE when a removed user accepts again', async () => {
        const { member, base } = await removedMember()
        const res = await rsvp(member.token, base, 'true')
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE')

        const participants = await call('get', member.token, `${base}/participants`)
        expect(participants.body.error.code).toBe('NOT_SESSION_PARTICIPANT')
    })

    it('returns 409 INVALID_STATUS_CHANGE when a user who declined accepts later', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        await rsvp(member.token, base, 'false')
        const res = await rsvp(member.token, base, 'true')
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE')
    })
})

describe('DELETE /courses/:courseId/sessions/:sessionId/participants/:userId', () => {
    it('returns 200 and marks the participant removed', async () => {
        const { host, member, base } = await sessionWithMember()
        await call('post', member.token, `${base}/join`)
        const res = await call('delete', host.token, `${base}/participants/${member.user._id}`)
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('removed')
    })

    it('returns 404 PARTICIPANT_NOT_FOUND for a user not in the session', async () => {
        const { host, member, base } = await sessionWithMember()
        const res = await call('delete', host.token, `${base}/participants/${member.user._id}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('PARTICIPANT_NOT_FOUND')
    })

    it('returns 400 BAD_REQUEST when the host removes themselves', async () => {
        const { host, base } = await sessionWithMember()
        const res = await call('delete', host.token, `${base}/participants/${host.user._id}`)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('BAD_REQUEST')
    })

    it('returns 409 INVALID_STATUS_CHANGE when removing someone already removed', async () => {
        const { host, member, base } = await removedMember()
        const res = await call('delete', host.token, `${base}/participants/${member.user._id}`)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE')
    })

    it('returns 403 NOT_SESSION_HOST for a non-host', async () => {
        const { host, member, base } = await sessionWithMember()
        await call('post', member.token, `${base}/join`)
        const res = await call('delete', member.token, `${base}/participants/${host.user._id}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_HOST')
    })
})

describe('POST /courses/:courseId/sessions/:sessionId/invites', () => {
    it('returns 201 with an invited participant', async () => {
        const { host, member, base } = await sessionWithMember()
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(201)
        expect(res.body.status).toBe('invited')
        expect(res.body.invitedBy).toBe(host.user._id)
    })

    it('returns 400 BAD_REQUEST for a malformed user id', async () => {
        const { host, base } = await sessionWithMember()
        const res = await invite(host.token, base, 'not-an-id')
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('BAD_REQUEST')
    })

    it('returns 400 INVITEE_NOT_IN_COURSE for a user outside the course, and invites nobody', async () => {
        const { host, base } = await sessionWithMember()
        const outsider = await createAndSignIn()
        const res = await invite(host.token, base, outsider.user._id)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVITEE_NOT_IN_COURSE')

        const participants = await call('get', host.token, `${base}/participants?status=invited`)
        expect(participants.body).toHaveLength(0)
    })

    it('returns 400 INVITEE_NOT_IN_COURSE for a user banned from the course', async () => {
        const { host, member, course, base } = await sessionWithMember()
        await call('patch', host.token, `/courses/${course._id}/members/${member.user._id}`).send({ status: 'banned' })
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVITEE_NOT_IN_COURSE')
    })

    it('returns 409 ALREADY_PARTICIPANT when inviting twice', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('ALREADY_PARTICIPANT')
    })

    it('returns 409 ALREADY_PARTICIPANT when inviting someone who already joined', async () => {
        const { host, member, base } = await sessionWithMember()
        await call('post', member.token, `${base}/join`)
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('ALREADY_PARTICIPANT')
    })

    it('re-invites a user who declined, who can then accept', async () => {
        const { host, member, base } = await sessionWithMember()
        await invite(host.token, base, member.user._id)
        await rsvp(member.token, base, 'false')
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(201)
        expect(res.body.status).toBe('invited')
        const accepted = await rsvp(member.token, base, 'true')
        expect(accepted.status).toBe(200)
    })

    it('lets the host re-invite a removed user', async () => {
        const { host, member, base } = await removedMember()
        const res = await invite(host.token, base, member.user._id)
        expect(res.status).toBe(201)
        expect(res.body.status).toBe('invited')
    })

    it('returns 403 NOT_SESSION_HOST when a non-host re-invites a removed user', async () => {
        const { host, member, course, base } = await removedMember()
        const friend = await createAndSignIn()
        await joinCourse(friend.token, course.joinCode)
        await call('post', friend.token, `${base}/join`)
        const res = await invite(friend.token, base, member.user._id)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_HOST')

        const participants = await call('get', host.token, `${base}/participants?status=removed`)
        expect(participants.body).toHaveLength(1)
    })

    it('returns 403 NOT_SESSION_PARTICIPANT when a non-participant invites', async () => {
        const { host, member, base } = await sessionWithMember()
        const res = await invite(member.token, base, host.user._id)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_PARTICIPANT')
    })
})

async function sendMessage(token, base, message) {
    return call('post', token, `${base}/messages`).send({ message })
}

// Fixture: the member has joined the session, so both users can chat.
async function chattingPair() {
    const fixture = await sessionWithMember()
    await call('post', fixture.member.token, `${fixture.base}/join`)
    return fixture
}

describe('POST /courses/:courseId/sessions/:sessionId/messages', () => {
    it('returns 201 with the message for a participant', async () => {
        const { member, base } = await chattingPair()
        const res = await sendMessage(member.token, base, 'hello')
        expect(res.status).toBe(201)
        expect(res.body.body).toBe('hello')
        expect(res.body.sender).toBe(member.user._id)
    })

    it('returns 400 VALIDATION_ERROR for an empty message', async () => {
        const { member, base } = await chattingPair()
        const res = await call('post', member.token, `${base}/messages`).send({})
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 403 NOT_SESSION_PARTICIPANT for a non-participant', async () => {
        const { member, base } = await sessionWithMember()
        const res = await sendMessage(member.token, base, 'hello')
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_SESSION_PARTICIPANT')
    })
})

describe('GET /courses/:courseId/sessions/:sessionId/messages', () => {
    async function threeMessages() {
        const fixture = await chattingPair()
        for (const text of ['one', 'two', 'three']) {
            await sendMessage(fixture.member.token, fixture.base, text)
        }
        return fixture
    }

    it('returns the messages of the session', async () => {
        const { host, base } = await threeMessages()
        const res = await call('get', host.token, `${base}/messages`)
        expect(res.status).toBe(200)
        expect(res.body.map((m) => m.body)).toEqual(['one', 'two', 'three'])
    })

    it('returns messages oldest first, regardless of storage order', async () => {
        const { host, member, course, session, base } = await chattingPair()
        // Inserted through the raw driver (bypassing the API and Mongoose
        // timestamps) so storage order and sentAt order disagree. Through the
        // API, insertion order usually matches sentAt and hides the bug.
        const message = (body, sentAt) => ({
            session: new mongoose.Types.ObjectId(session._id),
            course: new mongoose.Types.ObjectId(course._id),
            sender: new mongoose.Types.ObjectId(member.user._id),
            body,
            edited: false,
            sentAt: new Date(sentAt)
        })
        await SessionMessage.collection.insertMany([
            message('later', '2030-05-01T18:05:00.000Z'),
            message('earlier', '2030-05-01T18:00:00.000Z')
        ])

        const res = await call('get', host.token, `${base}/messages`)
        expect(res.body.map((m) => m.body)).toEqual(['earlier', 'later'])
    })

    it('pages with limit and offset', async () => {
        const { host, base } = await threeMessages()
        const res = await call('get', host.token, `${base}/messages?limit=1&offset=1`)
        expect(res.body.map((m) => m.body)).toEqual(['two'])
    })

    it('leaves out deleted messages', async () => {
        const { member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'oops')
        await call('delete', member.token, `${base}/messages/${sent.body._id}`)
        const res = await call('get', member.token, `${base}/messages`)
        expect(res.body).toHaveLength(0)
    })
})

describe('PATCH /courses/:courseId/sessions/:sessionId/messages/:messageId', () => {
    it('returns 200 and marks the message edited for its sender', async () => {
        const { member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'helo')
        const res = await call('patch', member.token, `${base}/messages/${sent.body._id}`).send({ message: 'hello' })
        expect(res.status).toBe(200)
        expect(res.body.body).toBe('hello')
        expect(res.body.edited).toBe(true)
    })

    it('returns 403 CANNOT_MODIFY_MESSAGE when editing someone else\'s message', async () => {
        const { host, member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'mine')
        const res = await call('patch', host.token, `${base}/messages/${sent.body._id}`).send({ message: 'yours now' })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('CANNOT_MODIFY_MESSAGE')
    })

    it('returns 404 MESSAGE_NOT_FOUND when the message belongs to another session', async () => {
        const { member, course, base: sessionA } = await chattingPair()
        const sessionB = (await createSession(member.token, course._id)).body
        const sent = await sendMessage(member.token, `/courses/${course._id}/sessions/${sessionB._id}`, 'in B')

        const res = await call('patch', member.token, `${sessionA}/messages/${sent.body._id}`).send({ message: 'edited via A' })
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND')
    })

    it('returns 404 MESSAGE_NOT_FOUND for an unknown message', async () => {
        const { member, base } = await chattingPair()
        const res = await call('patch', member.token, `${base}/messages/${NON_EXISTENT_ID}`).send({ message: 'x' })
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND')
    })
})

describe('DELETE /courses/:courseId/sessions/:sessionId/messages/:messageId', () => {
    it('lets the sender delete their message', async () => {
        const { member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'bye')
        const res = await call('delete', member.token, `${base}/messages/${sent.body._id}`)
        expect(res.status).toBe(200)
    })

    it('lets the host delete anyone\'s message', async () => {
        const { host, member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'spam')
        const res = await call('delete', host.token, `${base}/messages/${sent.body._id}`)
        expect(res.status).toBe(200)
    })

    it('returns 403 CANNOT_MODIFY_MESSAGE for a participant who is neither sender nor host', async () => {
        const { host, member, base } = await chattingPair()
        const sent = await sendMessage(host.token, base, 'host says')
        const res = await call('delete', member.token, `${base}/messages/${sent.body._id}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('CANNOT_MODIFY_MESSAGE')
    })

    it('returns 404 MESSAGE_NOT_FOUND when a host targets a message from another session', async () => {
        // host hosts session A; member hosts session B in the same course
        const { host, member, course, base: sessionA } = await chattingPair()
        const sessionB = (await createSession(member.token, course._id)).body
        const sent = await sendMessage(member.token, `/courses/${course._id}/sessions/${sessionB._id}`, 'in B')

        const res = await call('delete', host.token, `${sessionA}/messages/${sent.body._id}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND')

        const history = await call('get', member.token, `/courses/${course._id}/sessions/${sessionB._id}/messages`)
        expect(history.body).toHaveLength(1)
    })

    it('returns 404 MESSAGE_NOT_FOUND when deleting twice', async () => {
        const { member, base } = await chattingPair()
        const sent = await sendMessage(member.token, base, 'bye')
        await call('delete', member.token, `${base}/messages/${sent.body._id}`)
        const res = await call('delete', member.token, `${base}/messages/${sent.body._id}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND')
    })
})
