import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import User from '../../src/models/user.js'
import Session from '../../src/models/session.js'
import SessionParticipant from '../../src/models/sessionParticipant.js'
import CourseMembership from '../../src/models/courseMembership.js'
import AssignmentUserState from '../../src/models/assignmentUserState.js'
import Availability from '../../src/models/availability.js'
import { deleteAccount } from '../../src/operations/deleteAccount.js'

let userCounter = 0

async function signedInUser() {
    userCounter += 1
    const credentials = {
        username: `leavinguser${userCounter}`,
        email: `leaving${userCounter}@example.com`,
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

const deleteMe = (person) => call('delete', person.token, '/users/me')

const sessionFields = {
    goal: 'Finish practice exam',
    title: 'Midterm review',
    startsAt: '2030-05-01T18:00:00.000Z',
    endsAt: '2030-05-01T20:00:00.000Z'
}

async function createCourse(person, overrides = {}) {
    const res = await call('post', person.token, '/courses')
        .send({ courseName: 'Intro to Testing', courseCode: 'CS101', ...overrides })
    return res.body
}

// An admin who stays, and a member whose account gets deleted
async function courseWithLeaver() {
    const admin = await signedInUser()
    const leaver = await signedInUser()
    const course = await createCourse(admin)
    await call('post', leaver.token, `/courses/join/${course.joinCode}`)

    return { admin, leaver, course, courseUrl: `/courses/${course._id}` }
}

async function createSession(person, courseUrl, overrides = {}) {
    const res = await call('post', person.token, `${courseUrl}/sessions`).send({ ...sessionFields, ...overrides })
    return res.body
}

describe('DELETE /users/me removes what belongs to the user', () => {
    it('removes the account', async () => {
        const { leaver } = await courseWithLeaver()

        const res = await deleteMe(leaver)

        expect(res.status).toBe(204)
        expect(await User.findById(leaver.user._id)).toBeNull()
    })

    it('removes their memberships, and only theirs', async () => {
        const { admin, leaver, course } = await courseWithLeaver()

        await deleteMe(leaver)

        expect(await CourseMembership.countDocuments({ user: leaver.user._id })).toBe(0)
        expect(await CourseMembership.countDocuments({ course: course._id, user: admin.user._id })).toBe(1)
    })

    it('removes their availability', async () => {
        const { leaver } = await courseWithLeaver()
        await call('put', leaver.token, '/availability/me')
            .send({ timezone: 'UTC', blocks: [{ day: 1, startMin: 540, endMin: 660 }] })

        await deleteMe(leaver)

        expect(await Availability.countDocuments({ user: leaver.user._id })).toBe(0)
    })

    it('removes their assignment progress, and only theirs', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        const assignment = (await call('post', admin.token, `${courseUrl}/assignments`)
            .send({ title: 'Problem Set 1', dueAt: '2030-05-01T00:00:00.000Z' })).body
        const myState = `${courseUrl}/assignments/${assignment._id}/my-state`
        await call('patch', leaver.token, myState).send({ state: 'in_progress' })
        await call('patch', admin.token, myState).send({ state: 'in_progress' })

        await deleteMe(leaver)

        expect(await AssignmentUserState.countDocuments({ user: leaver.user._id })).toBe(0)
        expect(await AssignmentUserState.countDocuments({ user: admin.user._id })).toBe(1)
    })

    it('removes their session spots', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(admin, courseUrl)
        await call('post', leaver.token, `${courseUrl}/sessions/${session._id}/join`)

        await deleteMe(leaver)

        expect(await SessionParticipant.countDocuments({ user: leaver.user._id })).toBe(0)
    })

    it('promotes the next person on the waitlist into the open spot', async () => {
        const { admin, leaver, course, courseUrl } = await courseWithLeaver()
        const waiting = await signedInUser()
        await call('post', waiting.token, `/courses/join/${course.joinCode}`)
        const session = await createSession(admin, courseUrl, { capacity: 2 })
        const sessionUrl = `${courseUrl}/sessions/${session._id}`
        await call('post', leaver.token, `${sessionUrl}/join`)
        await call('post', waiting.token, `${sessionUrl}/join`)

        await deleteMe(leaver)

        const spot = await SessionParticipant.findOne({ session: session._id, user: waiting.user._id })
        expect(spot.status).toBe('accepted')
    })
})

describe('DELETE /users/me keeps shared work', () => {
    it('keeps the assignments they created, with no author', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        const assignment = (await call('post', leaver.token, `${courseUrl}/assignments`)
            .send({ title: 'Problem Set 1', dueAt: '2030-05-01T00:00:00.000Z' })).body

        await deleteMe(leaver)

        const res = await call('get', admin.token, `${courseUrl}/assignments/${assignment._id}`)
        expect(res.status).toBe(200)
        expect(res.body.title).toBe('Problem Set 1')
        expect(res.body.createdBy).toBeNull()
    })

    it('keeps the messages they sent', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(admin, courseUrl)
        const sessionUrl = `${courseUrl}/sessions/${session._id}`
        await call('post', leaver.token, `${sessionUrl}/join`)
        await call('post', leaver.token, `${sessionUrl}/messages`).send({ message: 'See you there' })

        await deleteMe(leaver)

        const res = await call('get', admin.token, `${sessionUrl}/messages`)
        expect(res.body.map((message) => message.body)).toEqual(['See you there'])
    })
})

describe('DELETE /users/me and hosted sessions', () => {
    it('cancels the sessions they were going to host', async () => {
        const { leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(leaver, courseUrl)

        await deleteMe(leaver)

        expect((await Session.findById(session._id)).status).toBe('cancelled')
    })

    it('leaves past sessions as a record', async () => {
        const { leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(leaver, courseUrl)
        await Session.updateOne({ _id: session._id }, {
            startsAt: new Date('2020-05-01T18:00:00.000Z'),
            endsAt: new Date('2020-05-01T20:00:00.000Z')
        })

        await deleteMe(leaver)

        expect((await Session.findById(session._id)).status).toBe('scheduled')
    })

    it('leaves sessions hosted by others alone', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(admin, courseUrl)
        await call('post', leaver.token, `${courseUrl}/sessions/${session._id}/join`)

        await deleteMe(leaver)

        expect((await Session.findById(session._id)).status).toBe('scheduled')
    })
})

describe('DELETE /users/me for a last admin', () => {
    it('answers 409 LAST_ADMIN naming the courses in the way', async () => {
        const { admin, course } = await courseWithLeaver()

        const res = await deleteMe(admin)

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('LAST_ADMIN')
        expect(res.body.error.details.courses).toEqual([course._id])
    })

    it('changes nothing when it refuses', async () => {
        const { admin, course, courseUrl } = await courseWithLeaver()
        const session = await createSession(admin, courseUrl)

        await deleteMe(admin)

        expect(await User.findById(admin.user._id)).not.toBeNull()
        expect(await CourseMembership.countDocuments({ course: course._id, user: admin.user._id })).toBe(1)
        expect((await Session.findById(session._id)).status).toBe('scheduled')
    })

    it('names only the courses where they really are the last admin', async () => {
        const { admin, leaver, course, courseUrl } = await courseWithLeaver()
        await call('patch', admin.token, `${courseUrl}/members/${leaver.user._id}`).send({ role: 'admin' })
        const soloCourse = await createCourse(admin)

        const res = await deleteMe(admin)

        expect(res.body.error.details.courses).toEqual([soloCourse._id])
        expect(res.body.error.details.courses).not.toContain(course._id)
    })

    it('goes through once another admin is appointed', async () => {
        const { admin, leaver, courseUrl } = await courseWithLeaver()
        await call('patch', admin.token, `${courseUrl}/members/${leaver.user._id}`).send({ role: 'admin' })

        expect((await deleteMe(admin)).status).toBe(204)
    })
})

describe('deleteAccount after a failure', () => {
    it('finishes the job when run again on a half-cleaned account', async () => {
        const { leaver, courseUrl } = await courseWithLeaver()
        const session = await createSession(leaver, courseUrl)
        // As if an earlier run stopped after removing the membership
        await CourseMembership.deleteMany({ user: leaver.user._id })

        await deleteAccount(await User.findById(leaver.user._id))

        expect(await User.findById(leaver.user._id)).toBeNull()
        expect((await Session.findById(session._id)).status).toBe('cancelled')
    })

    it('does not fail when run twice', async () => {
        const { leaver } = await courseWithLeaver()
        const user = await User.findById(leaver.user._id)

        await deleteAccount(user)

        await expect(deleteAccount(user)).resolves.not.toThrow()
    })
})
