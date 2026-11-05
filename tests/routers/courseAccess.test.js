import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import CourseMembership from '../../src/models/courseMembership.js'

let userCounter = 0

async function signedInUser() {
    userCounter += 1
    const credentials = {
        username: `accessuser${userCounter}`,
        email: `access${userCounter}@example.com`,
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

async function courseOwnedBy(token, overrides = {}) {
    const res = await call('post', token, '/courses')
        .send({ courseName: 'Intro to Testing', courseCode: 'CS101', ...overrides })
    return res.body
}

// An admin, one other member, and someone with no link to the course
async function courseWithPeople(overrides = {}) {
    const admin = await signedInUser()
    const member = await signedInUser()
    const outsider = await signedInUser()
    const course = await courseOwnedBy(admin.token, overrides)
    await call('post', member.token, `/courses/join/${course.joinCode}`)

    return { admin, member, outsider, course, courseUrl: `/courses/${course._id}` }
}

const memberUrl = (courseUrl, person) => `${courseUrl}/members/${person.user._id}`

const ban = (admin, courseUrl, person) => call('patch', admin.token, memberUrl(courseUrl, person)).send({ status: 'banned' })

const makeAdmin = (admin, courseUrl, person) => call('patch', admin.token, memberUrl(courseUrl, person)).send({ role: 'admin' })

const courseRoutes = [
    ['get', 'GET /courses/:courseId', (courseUrl) => courseUrl],
    ['get', 'GET .../joinCode', (courseUrl) => `${courseUrl}/joinCode`],
    ['patch', 'PATCH /courses/:courseId', (courseUrl) => courseUrl],
    ['delete', 'DELETE /courses/:courseId', (courseUrl) => courseUrl],
    ['get', 'GET .../members', (courseUrl) => `${courseUrl}/members`],
    ['delete', 'DELETE .../members/me', (courseUrl) => `${courseUrl}/members/me`],
    ['get', 'GET .../assignments', (courseUrl) => `${courseUrl}/assignments`],
    ['get', 'GET .../sessions', (courseUrl) => `${courseUrl}/sessions`]
]

describe('a private course', () => {
    it.each(courseRoutes)('%s %s looks missing to an outsider', async (method, name, url) => {
        const { outsider, courseUrl } = await courseWithPeople({ isPublic: false })

        const res = await call(method, outsider.token, url(courseUrl))

        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('COURSE_NOT_FOUND')
    })

    it.each(courseRoutes)('%s %s looks missing to a banned member', async (method, name, url) => {
        const { admin, member, courseUrl } = await courseWithPeople({ isPublic: false })
        await ban(admin, courseUrl, member)

        const res = await call(method, member.token, url(courseUrl))

        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('COURSE_NOT_FOUND')
    })

    it('is readable by its members', async () => {
        const { member, course, courseUrl } = await courseWithPeople({ isPublic: false })

        const res = await call('get', member.token, courseUrl)

        expect(res.status).toBe(200)
        expect(res.body._id).toBe(course._id)
    })

    it('is listed for its members only', async () => {
        const { member, outsider, course } = await courseWithPeople({ isPublic: false })

        const seenBy = async (person) => (await call('get', person.token, '/courses')).body.map((listed) => listed._id)

        expect(await seenBy(member)).toContain(course._id)
        expect(await seenBy(outsider)).not.toContain(course._id)
    })

    it('is not listed for a banned member', async () => {
        const { admin, member, course, courseUrl } = await courseWithPeople({ isPublic: false })
        await ban(admin, courseUrl, member)

        const listed = await call('get', member.token, '/courses')

        expect(listed.body.map((entry) => entry._id)).not.toContain(course._id)
    })

    it('can still be joined with its join code', async () => {
        const { outsider, course, courseUrl } = await courseWithPeople({ isPublic: false })

        const joined = await call('post', outsider.token, `/courses/join/${course.joinCode}`)

        expect(joined.status).toBe(201)
        expect((await call('get', outsider.token, courseUrl)).status).toBe(200)
    })
})

describe('a public course', () => {
    it('is listed and readable by anyone signed in', async () => {
        const { outsider, course, courseUrl } = await courseWithPeople()

        const listed = await call('get', outsider.token, '/courses')

        expect(listed.body.map((entry) => entry._id)).toContain(course._id)
        expect((await call('get', outsider.token, courseUrl)).status).toBe(200)
    })

    it('still tells an outsider they are not a member', async () => {
        const { outsider, courseUrl } = await courseWithPeople()

        const res = await call('get', outsider.token, `${courseUrl}/members`)

        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })

    it('still tells a banned member they are banned', async () => {
        const { admin, member, courseUrl } = await courseWithPeople()
        await ban(admin, courseUrl, member)

        const res = await call('get', member.token, `${courseUrl}/members`)

        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('COURSE_BANNED')
    })
})

describe('the last admin', () => {
    const ways = [
        ['leaving', (admin, courseUrl) => call('delete', admin.token, `${courseUrl}/members/me`)],
        ['removing themselves', (admin, courseUrl) => call('delete', admin.token, memberUrl(courseUrl, admin))],
        ['demoting themselves', (admin, courseUrl) => call('patch', admin.token, memberUrl(courseUrl, admin)).send({ role: 'member' })],
        ['banning themselves', (admin, courseUrl) => call('patch', admin.token, memberUrl(courseUrl, admin)).send({ status: 'banned' })]
    ]

    it.each(ways)('gets a 409 for %s, and stays an active admin', async (name, attempt) => {
        const { admin, course, courseUrl } = await courseWithPeople()

        const res = await attempt(admin, courseUrl)

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('LAST_ADMIN')

        const membership = await CourseMembership.findOne({ course: course._id, user: admin.user._id })
        expect(membership).toMatchObject({ role: 'admin', status: 'active' })
    })

    it.each(ways)('is free to do %s once there is another admin', async (name, attempt) => {
        const { admin, member, courseUrl } = await courseWithPeople()
        await makeAdmin(admin, courseUrl, member)

        const res = await attempt(admin, courseUrl)

        expect(res.status).toBeLessThan(300)
    })

    it('is still the last admin when the other admin is banned', async () => {
        const { admin, member, courseUrl } = await courseWithPeople()
        await makeAdmin(admin, courseUrl, member)
        await ban(admin, courseUrl, member)

        const res = await call('delete', admin.token, `${courseUrl}/members/me`)

        expect(res.body.error.code).toBe('LAST_ADMIN')
    })

    it('can edit their own membership in ways that keep them an admin', async () => {
        const { admin, courseUrl } = await courseWithPeople()

        const res = await call('patch', admin.token, memberUrl(courseUrl, admin)).send({ role: 'admin' })

        expect(res.status).toBe(200)
    })

    it('does not stop a regular member from leaving', async () => {
        const { member, courseUrl } = await courseWithPeople()

        expect((await call('delete', member.token, `${courseUrl}/members/me`)).status).toBe(204)
    })

    it('does not stop an admin from removing a regular member', async () => {
        const { admin, member, courseUrl } = await courseWithPeople()

        expect((await call('delete', admin.token, memberUrl(courseUrl, member))).status).toBe(204)
    })
})
