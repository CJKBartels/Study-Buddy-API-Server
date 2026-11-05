import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

// Express 5 leaves req.body undefined when a request has no JSON body. These
// tests send no body at all, across every router, because the fix is one line
// in app.js that all of them rely on.

let userCounter = 0

async function signedInUser() {
    userCounter += 1
    const credentials = {
        username: `bodyuser${userCounter}`,
        email: `body${userCounter}@example.com`,
        password: 'Password1!'
    }
    await request(app).post('/users').send(credentials)
    const res = await request(app).post('/user/sign-in').send(credentials)
    return res.body
}

// Sends an authenticated request: call('get', token, url).send(...)
function call(method, token, url) {
    return request(app)[method](url).set('Authorization', `Bearer ${token}`)
}

const courseFields = { courseName: 'Intro to Testing', courseCode: 'CS101' }
const assignmentFields = { title: 'Problem Set 1', dueAt: '2030-05-01T00:00:00.000Z' }
const sessionFields = {
    title: 'Midterm review',
    startsAt: '2030-05-01T18:00:00.000Z',
    endsAt: '2030-05-01T20:00:00.000Z'
}

// One of everything the routes below need: a user who owns a course, with an
// assignment, a session, and a message in that session.
async function fullCourse() {
    const { token, user } = await signedInUser()
    const course = (await call('post', token, '/courses').send(courseFields)).body
    const courseUrl = `/courses/${course._id}`

    const assignment = (await call('post', token, `${courseUrl}/assignments`).send(assignmentFields)).body
    const session = (await call('post', token, `${courseUrl}/sessions`).send(sessionFields)).body
    const sessionUrl = `${courseUrl}/sessions/${session._id}`
    const message = (await call('post', token, `${sessionUrl}/messages`).send({ message: 'Hello' })).body

    return {
        token,
        courseUrl,
        assignmentUrl: `${courseUrl}/assignments/${assignment._id}`,
        sessionUrl,
        messageUrl: `${sessionUrl}/messages/${message._id}`,
        memberUrl: `${courseUrl}/members/${user._id}`
    }
}

describe('requests with no body', () => {
    let fixture

    beforeEach(async () => {
        fixture = await fullCourse()
    })

    it.each([
        ['post', 'POST /users', () => '/users'],
        ['patch', 'PATCH /users/me', () => '/users/me'],
        ['post', 'POST /courses', () => '/courses'],
        ['patch', 'PATCH /courses/:courseId', (f) => f.courseUrl],
        ['patch', 'PATCH /courses/:courseId/members/:userId', (f) => f.memberUrl],
        ['post', 'POST .../assignments', (f) => `${f.courseUrl}/assignments`],
        ['patch', 'PATCH .../assignments/:assignmentId', (f) => f.assignmentUrl],
        ['post', 'POST .../sessions', (f) => `${f.courseUrl}/sessions`],
        ['patch', 'PATCH .../sessions/:sessionId', (f) => f.sessionUrl],
        ['post', 'POST .../sessions/:sessionId/invites', (f) => `${f.sessionUrl}/invites`],
        ['post', 'POST .../messages', (f) => `${f.sessionUrl}/messages`],
        ['patch', 'PATCH .../messages/:messageId', (f) => f.messageUrl],
        ['put', 'PUT /availability/me', () => '/availability/me']
    ])('%s %s returns 400', async (method, name, url) => {
        const res = await call(method, fixture.token, url(fixture))

        expect(res.status).toBe(400)
        expect(res.body.error.code).toBeDefined()
    })

    it('PATCH .../my-state returns the current state, since nothing was asked to change', async () => {
        const res = await call('patch', fixture.token, `${fixture.assignmentUrl}/my-state`)

        expect(res.status).toBe(200)
        expect(res.body.state).toBe('not_started')
    })
})

describe('POST /courses', () => {
    it.each([
        ['joinCode', 'HACKED123'],
        ['createdBy', '000000000000000000000001'],
        ['_id', '000000000000000000000002'],
        ['createdAt', '2000-01-01T00:00:00.000Z']
    ])('rejects %s, which only the server sets', async (field, value) => {
        const { token } = await signedInUser()

        const res = await call('post', token, '/courses').send({ ...courseFields, [field]: value })

        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.details[field]).toBeDefined()
    })

    it('still accepts every documented field', async () => {
        const { token } = await signedInUser()

        const res = await call('post', token, '/courses')
            .send({ ...courseFields, title: 'Testing 101', school: 'State University', isPublic: false })

        expect(res.status).toBe(201)
        expect(res.body).toMatchObject({ title: 'Testing 101', school: 'State University', isPublic: false })
    })
})

describe('POST /courses/:courseId/assignments', () => {
    it.each([
        ['status', 'archived'],
        ['source', 'moderator'],
        ['createdBy', '000000000000000000000001'],
        ['_id', '000000000000000000000002'],
        ['createdAt', '2000-01-01T00:00:00.000Z']
    ])('rejects %s, which only the server sets', async (field, value) => {
        const { token } = await signedInUser()
        const course = (await call('post', token, '/courses').send(courseFields)).body
        const assignmentsUrl = `/courses/${course._id}/assignments`

        const res = await call('post', token, assignmentsUrl).send({ ...assignmentFields, [field]: value })

        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.details[field]).toBeDefined()
        expect((await call('get', token, assignmentsUrl)).body).toEqual([])
    })

    it('still accepts every documented field', async () => {
        const { token } = await signedInUser()
        const course = (await call('post', token, '/courses').send(courseFields)).body

        const res = await call('post', token, `/courses/${course._id}/assignments`)
            .send({ ...assignmentFields, description: 'Chapters 1-3' })

        expect(res.body).toMatchObject({ title: 'Problem Set 1', description: 'Chapters 1-3', status: 'active' })
    })
})

describe('acceptFields', () => {
    it('names every field it rejects', async () => {
        const { token } = await signedInUser()

        const res = await call('post', token, '/courses').send({ ...courseFields, joinCode: 'X', createdBy: 'Y' })

        expect(Object.keys(res.body.error.details).sort()).toEqual(['createdBy', 'joinCode'])
    })

    it('runs after the access checks, so outsiders learn nothing about the fields', async () => {
        const { courseUrl } = await fullCourse()
        const outsider = await signedInUser()

        const res = await call('patch', outsider.token, courseUrl).send({ joinCode: 'X' })

        expect(res.status).toBe(403)
    })
})
