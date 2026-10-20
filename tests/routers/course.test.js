import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import CourseMembership from '../../src/models/courseMembership.js'

const baseUser = () => ({
    username: 'testuser',
    email: 'test@example.com',
    password: 'Password1!'
})

let userCounter = 0
function uniqueUser(overrides = {}) {
    userCounter += 1
    return {
        username: `testuser${userCounter}`,
        email: `test${userCounter}@example.com`,
        password: 'Password1!',
        ...overrides
    }
}

async function createUser(overrides = {}) {
    const res = await request(app)
        .post('/users')
        .send({ ...baseUser(), ...overrides })
    return res.body
}

async function signIn(email, password) {
    const res = await request(app)
        .post('/user/sign-in')
        .send({ email, password })
    return res.body
}

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
    const res = await request(app)
        .post(`/courses/join/${joinCode}`)
        .set('Authorization', `Bearer ${token}`)
    return res
}

const NON_EXISTENT_ID = '000000000000000000000001'

describe('POST /courses', () => {
    it('returns 201 with the created course, including joinCode', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .post('/courses')
            .set('Authorization', `Bearer ${token}`)
            .send(baseCourse())
        expect(res.status).toBe(201)
        expect(res.body.courseName).toBe(baseCourse().courseName)
        expect(res.body.courseCode).toBe(baseCourse().courseCode)
        expect(res.body.joinCode).toBeDefined()
    })

    it('derives title from courseCode and courseName when title is not given', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .post('/courses')
            .set('Authorization', `Bearer ${token}`)
            .send(baseCourse())
        expect(res.body.title).toBe(`${baseCourse().courseCode} - ${baseCourse().courseName}`)
    })

    it('keeps an explicit title when given', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .post('/courses')
            .set('Authorization', `Bearer ${token}`)
            .send({ ...baseCourse(), title: 'Custom Title' })
        expect(res.body.title).toBe('Custom Title')
    })

    it('creates an admin membership for the creator', async () => {
        const { token, user } = await createAndSignIn()
        const course = await createCourse(token)
        const membership = await CourseMembership.findOne({ course: course._id, user: user._id })
        expect(membership).not.toBeNull()
        expect(membership.role).toBe('admin')
        expect(membership.status).toBe('active')
    })

    it('returns 400 VALIDATION_ERROR when courseName is missing', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .post('/courses')
            .set('Authorization', `Bearer ${token}`)
            .send({ courseCode: 'CS101' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when courseCode is missing', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .post('/courses')
            .set('Authorization', `Bearer ${token}`)
            .send({ courseName: 'Intro to Testing' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).post('/courses').send(baseCourse())
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('GET /courses/:courseId', () => {
    it('returns 200 with course details for any authenticated user', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const other = await createAndSignIn()
        const res = await request(app)
            .get(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${other.token}`)
        expect(res.status).toBe(200)
        expect(res.body._id).toBe(course._id)
    })

    it('strips joinCode from the response', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .get(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.body.joinCode).toBeUndefined()
    })

    it('returns 404 COURSE_NOT_FOUND for a well-formed id with no matching course', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get(`/courses/${NON_EXISTENT_ID}`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('COURSE_NOT_FOUND')
    })

    it('returns 400 BAD_REQUEST for a malformed course id', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/courses/not-an-id')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('BAD_REQUEST')
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app).get(`/courses/${course._id}`)
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('error response matches { error: { code, message } } envelope', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/courses/not-an-id')
            .set('Authorization', `Bearer ${token}`)
        expect(res.body.error).toBeDefined()
        expect(typeof res.body.error.code).toBe('string')
        expect(typeof res.body.error.message).toBe('string')
    })
})

describe('GET /courses/:courseId/joinCode', () => {
    it('returns 200 with the joinCode for the course admin', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .get(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(res.body.joinCode).toBe(course.joinCode)
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .get(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .get(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('GET /courses', () => {
    it('returns 200 with an array of courses, joinCode stripped', async () => {
        const { token } = await createAndSignIn()
        await createCourse(token)
        const res = await request(app)
            .get('/courses')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
        expect(res.body.length).toBeGreaterThan(0)
        for (const course of res.body) {
            expect(course.joinCode).toBeUndefined()
        }
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).get('/courses')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('DELETE /courses/:courseId', () => {
    it('returns 204 and removes the course for the admin', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .delete(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(204)

        const check = await request(app)
            .get(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
        expect(check.status).toBe(404)
        expect(check.body.error.code).toBe('COURSE_NOT_FOUND')
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .delete(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .delete(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('PATCH /courses/:courseId', () => {
    it('returns 200 and applies a valid courseName update', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ courseName: 'Advanced Testing' })
        expect(res.status).toBe(200)
        expect(res.body.courseName).toBe('Advanced Testing')
    })

    it('recomputes title when courseName changes without an explicit title', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ courseName: 'Advanced Testing' })
        expect(res.body.title).toBe(`${course.courseCode} - Advanced Testing`)
    })

    it('recomputes title when courseCode changes without an explicit title', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ courseCode: 'CS999' })
        expect(res.body.title).toBe(`CS999 - ${course.courseName}`)
    })

    it('keeps an explicit title when provided alongside courseName', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ courseName: 'Advanced Testing', title: 'Kept Title' })
        expect(res.body.title).toBe('Kept Title')
    })

    it('updates school and isPublic', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ school: 'State University', isPublic: false })
        expect(res.status).toBe(200)
        expect(res.body.school).toBe('State University')
        expect(res.body.isPublic).toBe(false)
    })

    it('returns 400 INVALID_UPDATES for a non-modifiable field', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ joinCode: 'HACKED123' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 VALIDATION_ERROR when courseName is cleared to empty', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ courseName: '' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ courseName: 'Hijacked' })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })
})

describe('POST /courses/join/:joinCode', () => {
    it('returns 201 and creates an active member on success', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const joiner = await createAndSignIn()

        const res = await joinCourse(joiner.token, course.joinCode)
        expect(res.status).toBe(201)

        const membership = await CourseMembership.findOne({ course: course._id, user: joiner.user._id })
        expect(membership).not.toBeNull()
        expect(membership.role).toBe('member')
        expect(membership.status).toBe('active')
    })

    it('returns 404 COURSE_NOT_FOUND for an unknown join code', async () => {
        const { token } = await createAndSignIn()
        const res = await joinCourse(token, 'NOTAREALCODE')
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('COURSE_NOT_FOUND')
    })

    it('returns 409 CONFLICT when joining a course twice', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const joiner = await createAndSignIn()

        await joinCourse(joiner.token, course.joinCode)
        const res = await joinCourse(joiner.token, course.joinCode)
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
    })

    it('returns 403 COURSE_BANNED when the user was previously banned from the course', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const banned = await createAndSignIn()

        await new CourseMembership({
            course: course._id,
            user: banned.user._id,
            role: 'member',
            status: 'banned'
        }).save()

        const res = await joinCourse(banned.token, course.joinCode)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('COURSE_BANNED')
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const res = await request(app).post(`/courses/join/${course.joinCode}`)
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('PATCH /courses/:courseId/joinCode', () => {
    it('returns 201 with a new join code for the admin', async () => {
        const { token } = await createAndSignIn()
        const course = await createCourse(token)
        const res = await request(app)
            .patch(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(201)
        // The route sends the raw join code string via res.send(), which Express
        // serves as text/html rather than JSON — supertest surfaces that as
        // res.text, not res.body (res.body is `{}` for non-JSON responses).
        expect(typeof res.text).toBe('string')
        expect(res.text).not.toBe(course.joinCode)

        const check = await request(app)
            .get(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${token}`)
        expect(check.body.joinCode).toBe(res.text)
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/joinCode`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })
})

describe('GET /courses/:courseId/members', () => {
    it('returns 200 with active members for a member of the course', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .get(`/courses/${course._id}/members`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
        expect(res.body.length).toBe(2)
    })

    it('returns 403 NOT_COURSE_MEMBER for a non-member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .get(`/courses/${course._id}/members`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('GET /courses/:courseId/members/:userId', () => {
    it('returns 200 with the membership details for an existing member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)

        const res = await request(app)
            .get(`/courses/${course._id}/members/${admin.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(200)
        expect(res.body.role).toBe('admin')
    })

    it('returns 404 NOT_FOUND when the userId has no membership in the course', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .get(`/courses/${course._id}/members/${outsider.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 403 NOT_COURSE_MEMBER when the requester is not a course member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .get(`/courses/${course._id}/members/${admin.user._id}`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('PATCH /courses/:courseId/members/:userId', () => {
    it('returns 200 and updates role for the admin', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/members/${member.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ role: 'moderator' })
        expect(res.status).toBe(200)

        const persisted = await CourseMembership.findOne({ course: course._id, user: member.user._id })
        expect(persisted.role).toBe('moderator')
    })

    it('returns 200 and updates status for the admin', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/members/${member.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ status: 'banned' })
        expect(res.status).toBe(200)

        const persisted = await CourseMembership.findOne({ course: course._id, user: member.user._id })
        expect(persisted.status).toBe('banned')
    })

    it('returns 400 INVALID_UPDATES for a non-modifiable field', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/members/${member.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ course: NON_EXISTENT_ID })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 404 NOT_FOUND when the userId has no membership in the course', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .patch(`/courses/${course._id}/members/${outsider.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ role: 'moderator' })
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)
        const other = await createAndSignIn()
        await joinCourse(other.token, course.joinCode)

        const res = await request(app)
            .patch(`/courses/${course._id}/members/${other.user._id}`)
            .set('Authorization', `Bearer ${member.token}`)
            .send({ role: 'moderator' })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })
})

describe('DELETE /courses/:courseId/members/me', () => {
    it('returns 204 and removes the membership from the database', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .delete(`/courses/${course._id}/members/me`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(204)

        const persisted = await CourseMembership.findOne({ course: course._id, user: member.user._id })
        expect(persisted).toBeNull()
    })

    it('returns 403 NOT_COURSE_MEMBER when the requester is not a member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .delete(`/courses/${course._id}/members/me`)
            .set('Authorization', `Bearer ${outsider.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_MEMBER')
    })
})

describe('DELETE /courses/:courseId/members/:userId', () => {
    it('returns 204 and removes the target membership from the database', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)

        const res = await request(app)
            .delete(`/courses/${course._id}/members/${member.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(204)

        const persisted = await CourseMembership.findOne({ course: course._id, user: member.user._id })
        expect(persisted).toBeNull()
    })

    it('returns 404 NOT_FOUND for a user who is not a member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const outsider = await createAndSignIn()

        const res = await request(app)
            .delete(`/courses/${course._id}/members/${outsider.user._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 403 NOT_COURSE_ADMIN for a non-admin member', async () => {
        const admin = await createAndSignIn()
        const course = await createCourse(admin.token)
        const member = await createAndSignIn()
        await joinCourse(member.token, course.joinCode)
        const other = await createAndSignIn()
        await joinCourse(other.token, course.joinCode)

        const res = await request(app)
            .delete(`/courses/${course._id}/members/${other.user._id}`)
            .set('Authorization', `Bearer ${member.token}`)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('NOT_COURSE_ADMIN')
    })
})
