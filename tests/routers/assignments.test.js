import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import CourseMembership from '../../src/models/courseMembership.js'
import AssignmentUserState from '../../src/models/assignmentUserState.js'

const NON_EXISTENT_ID = '000000000000000000000001'

let userCounter = 0
function uniqueUser(overrides = {}) {
    userCounter += 1
    return {
        username: `assignuser${userCounter}`,
        email: `assign${userCounter}@example.com`,
        password: 'Password1!',
        ...overrides
    }
}

async function createUser(data) {
    await request(app).post('/users').send(data)
}

async function signIn(email, password) {
    const res = await request(app).post('/user/sign-in').send({ email, password })
    return res.body
}

// Returns { token, user } for a freshly created, signed-in user.
async function createAndSignIn(overrides = {}) {
    const data = uniqueUser(overrides)
    await createUser(data)
    return signIn(data.email, data.password)
}

const baseCourse = () => ({
    courseName: 'Intro to Testing',
    courseCode: 'CS101'
})

async function createCourse(token, overrides = {}) {
    const res = await request(app)
        .post('/courses')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseCourse(), ...overrides })
    return res.body
}

async function joinCourse(token, joinCode) {
    return request(app)
        .post(`/courses/join/${joinCode}`)
        .set('Authorization', `Bearer ${token}`)
}

// Promote an existing member to a role via the admin-only members endpoint.
async function setRole(adminToken, courseId, userId, role) {
    return request(app)
        .patch(`/courses/${courseId}/members/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role })
}

const baseAssignment = () => ({
    title: 'Problem Set 1',
    description: 'Chapters 1-3',
    dueAt: '2030-05-01T00:00:00.000Z'
})

async function createAssignment(token, courseId, overrides = {}) {
    return request(app)
        .post(`/courses/${courseId}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseAssignment(), ...overrides })
}

function listMine(token, courseId) {
    return request(app).get(`/courses/${courseId}/my/assignments`).set('Authorization', `Bearer ${token}`)
}

function listAll(token) {
    return request(app).get('/assignments').set('Authorization', `Bearer ${token}`)
}

function setMyState(token, courseId, assignmentId, changes) {
    return request(app)
        .patch(`/courses/${courseId}/assignments/${assignmentId}/my-state`)
        .set('Authorization', `Bearer ${token}`)
        .send(changes)
}

// Common fixture: an admin who owns a course, plus a plain member who joined it.
async function courseWithMember() {
    const admin = await createAndSignIn()
    const course = await createCourse(admin.token)
    const member = await createAndSignIn()
    await joinCourse(member.token, course.joinCode)
    return { admin, member, course }
}

describe('POST /courses/:courseId/assignments', () => {
    it('returns 200 with the created assignment and source=community for a member', async () => {
        const { member, course } = await courseWithMember()
        const res = await createAssignment(member.token, course._id)
        expect(res.status).toBe(200)
        expect(res.body.title).toBe(baseAssignment().title)
        expect(res.body.source).toBe('community')
        expect(res.body.status).toBe('active')
        expect(res.body.createdBy).toBe(member.user._id)
    })

    it('sets source=moderator when the creator is a moderator', async () => {
        const { admin, member, course } = await courseWithMember()
        await setRole(admin.token, course._id, member.user._id, 'moderator')
        const res = await createAssignment(member.token, course._id)
        expect(res.status).toBe(200)
        expect(res.body.source).toBe('moderator')
    })

    it('returns 400 VALIDATION_ERROR when title is missing', async () => {
        const { member, course } = await courseWithMember()
        const res = await createAssignment(member.token, course._id, { title: undefined })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when dueAt is missing', async () => {
        const { member, course } = await courseWithMember()
        const res = await createAssignment(member.token, course._id, { dueAt: undefined })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const { course } = await courseWithMember()
        const outsider = await createAndSignIn()
        const res = await createAssignment(outsider.token, course._id)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const { course } = await courseWithMember()
        const res = await request(app)
            .post(`/courses/${course._id}/assignments`)
            .send(baseAssignment())
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('GET /courses/:courseId/assignments', () => {
    it('returns 200 with the active assignments for the course', async () => {
        const { member, course } = await courseWithMember()
        await createAssignment(member.token, course._id)
        const res = await request(app)
            .get(`/courses/${course._id}/assignments`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
        expect(res.body.length).toBe(1)
    })

    it('excludes archived assignments by default', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${admin.token}`)

        const res = await request(app)
            .get(`/courses/${course._id}/assignments`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.body.length).toBe(0)
    })

    it('includes archived assignments when status=all', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${admin.token}`)

        const res = await request(app)
            .get(`/courses/${course._id}/assignments`)
            .query({ status: 'all' })
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.body.length).toBe(1)
    })

    it('filters by source', async () => {
        const { admin, member, course } = await courseWithMember()
        await createAssignment(member.token, course._id) // community
        await createAssignment(admin.token, course._id) // moderator (admin)

        const res = await request(app)
            .get(`/courses/${course._id}/assignments`)
            .query({ source: 'moderator' })
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.body.length).toBe(1)
        expect(res.body[0].source).toBe('moderator')
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const { course } = await courseWithMember()
        const outsider = await createAndSignIn()
        const res = await request(app)
            .get(`/courses/${course._id}/assignments`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('GET /courses/:courseId/assignments/:assignmentId', () => {
    it('returns 200 and populates createdBy and course', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .get(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(200)
        expect(res.body._id).toBe(created.body._id)
        expect(res.body.createdBy.username).toBeDefined()
        expect(res.body.course.title).toBeDefined()
    })

    it('returns 404 for a well-formed id with no matching assignment', async () => {
        const { member, course } = await courseWithMember()
        const res = await request(app)
            .get(`/courses/${course._id}/assignments/${NON_EXISTENT_ID}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(404)
    })

    it('returns 400 for a malformed assignment id', async () => {
        const { member, course } = await courseWithMember()
        const res = await request(app)
            .get(`/courses/${course._id}/assignments/not-an-id`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(400)
    })
})

describe('PATCH /courses/:courseId/assignments/:assignmentId', () => {
    it('returns 200 and applies title/description/dueAt updates by the creator', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ title: 'Updated Title', description: 'New desc' })
        expect(res.status).toBe(200)
        expect(res.body.title).toBe('Updated Title')
        expect(res.body.description).toBe('New desc')
    })

    it('returns 403 FORBIDDEN when a non-creator member edits', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const other = await createAndSignIn()
        await joinCourse(other.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${other.token}`)
            .send({ title: 'Hijacked' })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('lets a moderator edit another member\'s assignment and sets source=moderator', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        expect(created.body.source).toBe('community')

        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ title: 'Moderated Title' })
        expect(res.status).toBe(200)
        expect(res.body.title).toBe('Moderated Title')
        expect(res.body.source).toBe('moderator')
    })

    it('returns 400 INVALID_UPDATES for a non-modifiable field', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ status: 'archived' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 INVALID_UPDATES for an empty update body', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({})
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })
})

describe('POST /courses/:courseId/assignments/:assignmentId/stamp', () => {
    it('returns 200 and sets source=moderator for a moderator', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        expect(created.body.source).toBe('community')

        const res = await request(app)
            .post(`/courses/${course._id}/assignments/${created.body._id}/stamp`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(200)
        expect(res.body.source).toBe('moderator')
    })

    it('returns 403 NOT_COURSE_MODERATOR for a plain member', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .post(`/courses/${course._id}/assignments/${created.body._id}/stamp`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MODERATOR')
    })
})

describe('DELETE /courses/:courseId/assignments/:assignmentId', () => {
    it('returns 200 and archives the assignment for the creator', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(200)

        const check = await request(app)
            .get(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(check.body.status).toBe('archived')
    })

    it('lets a moderator archive another member\'s assignment', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(200)
    })

    it('returns 403 FORBIDDEN when a non-creator member archives', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const other = await createAndSignIn()
        await joinCourse(other.token, course.joinCode)

        const res = await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${other.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('returns 409 CONFLICT when archiving an already-archived assignment', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)

        const res = await request(app)
            .delete(`/courses/${course._id}/assignments/${created.body._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
    })
})

describe('GET /courses/:courseId/my/assignments', () => {
    it('returns default state for every assignment without creating state docs', async () => {
        const { member, course } = await courseWithMember()
        await createAssignment(member.token, course._id)

        const res = await listMine(member.token, course._id)
        expect(res.status).toBe(200)
        expect(res.body).toHaveLength(1)
        expect(res.body[0].userState.state).toBe('not_started')
        expect(res.body[0].userState.personalDueAt).toBe(baseAssignment().dueAt)

        // Listing is a read: it must not write state docs
        expect(await AssignmentUserState.countDocuments({})).toBe(0)
    })

    it('shows only the signed-in user\'s state, never a classmate\'s', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(admin.token, course._id, created.body._id, { state: 'in_progress', personalNotes: 'ADMIN PRIVATE NOTE' })

        const res = await listMine(member.token, course._id)
        expect(res.body).toHaveLength(1)
        expect(res.body[0].userState.state).toBe('not_started')
        expect(res.body[0].userState.personalNotes).toBeUndefined()
    })

    it('shows the user\'s own state once when classmates also have states', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(admin.token, course._id, created.body._id, { state: 'complete' })
        await setMyState(member.token, course._id, created.body._id, { state: 'in_progress', personalNotes: 'mine' })

        const res = await listMine(member.token, course._id)
        expect(res.body).toHaveLength(1)
        expect(res.body[0].userState.state).toBe('in_progress')
        expect(res.body[0].userState.personalNotes).toBe('mine')
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const { course } = await courseWithMember()
        const outsider = await createAndSignIn()
        const res = await request(app)
            .get(`/courses/${course._id}/my/assignments`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('PATCH /courses/:courseId/assignments/:assignmentId/my-state', () => {
    it('creates the state doc and applies modifiable fields', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)

        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}/my-state`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ state: 'in_progress', personalNotes: 'Started section 1' })
        expect(res.status).toBe(200)
        expect(res.body.state).toBe('in_progress')
        expect(res.body.personalNotes).toBe('Started section 1')

        const persisted = await AssignmentUserState.findOne({
            assignment: created.body._id,
            user: member.user._id
        })
        expect(persisted.state).toBe('in_progress')
    })

    it('does not create a duplicate when a state already exists', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)

        await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}/my-state`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ state: 'in_progress' })
        await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}/my-state`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ state: 'complete' })

        expect(await AssignmentUserState.countDocuments({})).toBe(1)
    })

    it('returns 400 INVALID_UPDATES for a non-modifiable field', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}/my-state`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ course: NON_EXISTENT_ID })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 VALIDATION_ERROR for a state outside the enum', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await request(app)
            .patch(`/courses/${course._id}/assignments/${created.body._id}/my-state`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ state: 'not_a_state' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
})

describe('personal due dates', () => {
    const OFFICIAL = baseAssignment().dueAt                 // 2030-05-01
    const MOVED = '2030-05-03T00:00:00.000Z'
    const MINE = '2030-04-20T00:00:00.000Z'

    function moveDueDate(token, courseId, assignmentId, dueAt) {
        return request(app)
            .patch(`/courses/${courseId}/assignments/${assignmentId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ dueAt })
    }

    async function myDueDate(token, courseId) {
        const res = await listMine(token, courseId)
        return res.body[0].userState.personalDueAt
    }

    it('keeps the user\'s own due date when they later edit only their notes', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(member.token, course._id, created.body._id, { personalDueAt: MINE })

        const res = await setMyState(member.token, course._id, created.body._id, { personalNotes: 'edited' })
        expect(res.body.personalDueAt).toBe(MINE)
        expect(await myDueDate(member.token, course._id)).toBe(MINE)
    })

    it('shows the official due date in the my-state response when the user never picked one', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        const res = await setMyState(member.token, course._id, created.body._id, { state: 'in_progress' })
        expect(res.body.personalDueAt).toBe(OFFICIAL)
    })

    it('follows a moved official due date for users who never picked their own, even with a state', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(member.token, course._id, created.body._id, { state: 'in_progress' })

        await moveDueDate(admin.token, course._id, created.body._id, MOVED)
        expect(await myDueDate(member.token, course._id)).toBe(MOVED)
    })

    it('keeps the user\'s own due date when the official one moves', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(member.token, course._id, created.body._id, { personalDueAt: MINE })

        await moveDueDate(admin.token, course._id, created.body._id, MOVED)
        expect(await myDueDate(member.token, course._id)).toBe(MINE)
    })

    it('goes back to the official due date when the user clears their own with null', async () => {
        const { member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(member.token, course._id, created.body._id, { personalDueAt: MINE })

        const res = await setMyState(member.token, course._id, created.body._id, { personalDueAt: null })
        expect(res.body.personalDueAt).toBe(OFFICIAL)
        expect(await myDueDate(member.token, course._id)).toBe(OFFICIAL)
    })
})

describe('GET /assignments', () => {
    it('returns assignments across all of the user\'s active courses with userState attached', async () => {
        const user = await createAndSignIn()

        const adminA = await createAndSignIn()
        const courseA = await createCourse(adminA.token)
        await joinCourse(user.token, courseA.joinCode)
        await createAssignment(user.token, courseA._id)

        const adminB = await createAndSignIn()
        const courseB = await createCourse(adminB.token, { courseCode: 'CS202' })
        await joinCourse(user.token, courseB.joinCode)
        await createAssignment(user.token, courseB._id)

        const res = await request(app)
            .get('/assignments')
            .set('Authorization', `Bearer ${user.token}`)
        expect(res.status).toBe(200)
        expect(res.body.length).toBe(2)
        for (const entry of res.body) {
            expect(entry.userState).toBeDefined()
            expect(entry.userState.state).toBe('not_started')
        }
    })

    it('excludes assignments from courses the user is not a member of', async () => {
        const user = await createAndSignIn()
        const adminA = await createCourse(user.token) // user owns courseA

        const outsiderAdmin = await createAndSignIn()
        const courseB = await createCourse(outsiderAdmin.token, { courseCode: 'CS303' })
        await createAssignment(outsiderAdmin.token, courseB._id)

        await createAssignment(user.token, adminA._id)

        const res = await request(app)
            .get('/assignments')
            .set('Authorization', `Bearer ${user.token}`)
        expect(res.status).toBe(200)
        expect(res.body.length).toBe(1)
    })

    it('does not create state docs', async () => {
        const { member, course } = await courseWithMember()
        await createAssignment(member.token, course._id)
        await listAll(member.token)
        expect(await AssignmentUserState.countDocuments({})).toBe(0)
    })

    it('shows only the signed-in user\'s state, once per assignment', async () => {
        const { admin, member, course } = await courseWithMember()
        const created = await createAssignment(member.token, course._id)
        await setMyState(admin.token, course._id, created.body._id, { personalNotes: 'ADMIN PRIVATE NOTE' })

        const res = await listAll(member.token)
        expect(res.body).toHaveLength(1)
        expect(res.body[0].userState.personalNotes).toBeUndefined()
    })

    it('includes course details but never the join code', async () => {
        const { member, course } = await courseWithMember()
        await createAssignment(member.token, course._id)
        const res = await listAll(member.token)
        expect(res.body[0].course.courseName).toBe(course.courseName)
        expect(res.body[0].course.joinCode).toBeUndefined()
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).get('/assignments')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})
