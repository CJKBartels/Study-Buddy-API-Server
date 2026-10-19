import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

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
