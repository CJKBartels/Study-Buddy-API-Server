import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD, DEMO_JOIN_CODE } from '../../src/db/seedDemo.js'
import User from '../../src/models/user.js'
import Course from '../../src/models/course.js'
import CourseMembership from '../../src/models/courseMembership.js'
import Assignment from '../../src/models/assignment.js'
import AssignmentUserState from '../../src/models/assignmentUserState.js'
import Session from '../../src/models/session.js'
import SessionParticipant from '../../src/models/sessionParticipant.js'
import SessionMessage from '../../src/models/sessionMessage.js'
import Availability from '../../src/models/availability.js'

const models = { User, Course, CourseMembership, Assignment, AssignmentUserState, Session, SessionParticipant, SessionMessage, Availability }

// Document count per collection, e.g. { User: 3, Course: 1, ... }
async function counts() {
    const entries = await Promise.all(Object.entries(models).map(async ([name, model]) => [name, await model.countDocuments()]))
    return Object.fromEntries(entries)
}

async function signIn(email, password) {
    return await request(app).post('/user/sign-in').send({ email, password })
}

describe('seedDemo', () => {
    it('creates a demo user who can sign in and see the demo course', async () => {
        await seedDemo()

        const signInRes = await signIn(DEMO_EMAIL, DEMO_PASSWORD)
        expect(signInRes.status).toBe(200)

        // The demo user sees all 3 assignments, with their own progress on 2
        const assignmentsRes = await request(app).get('/assignments').set('Authorization', `Bearer ${signInRes.body.token}`)
        expect(assignmentsRes.status).toBe(200)
        expect(assignmentsRes.body.map((assignment) => assignment.userState.state).sort())
            .toEqual(['complete', 'in_progress', 'not_started'])
        expect(await counts()).toEqual({
            User: 3, Course: 1, CourseMembership: 3, Assignment: 3, AssignmentUserState: 2,
            Session: 1, SessionParticipant: 3, SessionMessage: 3, Availability: 1
        })
    })

    it('creates nothing extra when run twice', async () => {
        await seedDemo()
        const afterFirstRun = await counts()

        await seedDemo()
        expect(await counts()).toEqual(afterFirstRun)
    })

    it('restores data a visitor changed', async () => {
        await seedDemo()
        const expected = await counts()

        await Assignment.deleteOne({ title: 'Hash map implementation' })
        await Course.updateOne({ joinCode: DEMO_JOIN_CODE }, { courseName: 'Vandalized' })

        await seedDemo()
        expect(await counts()).toEqual(expected)
        expect((await Course.findOne({ joinCode: DEMO_JOIN_CODE })).courseName).toBe('Data Structures and Algorithms')
    })

    it('recovers when a visitor deleted the demo account', async () => {
        await seedDemo()
        const expected = await counts()
        const token = (await signIn(DEMO_EMAIL, DEMO_PASSWORD)).body.token
        await request(app).delete('/users/me').set('Authorization', `Bearer ${token}`)
        // ...then took the freed username and email for their own account
        const signUpRes = await request(app).post('/users').send({ username: 'demo', email: DEMO_EMAIL, password: 'visitor-password' })
        expect(signUpRes.status).toBe(201)

        await seedDemo()
        expect(await counts()).toEqual(expected)
        expect((await signIn(DEMO_EMAIL, DEMO_PASSWORD)).status).toBe(200)
    })

    it('leaves non-demo users and their courses alone', async () => {
        const realUser = await User.create({ username: 'real', email: 'real@example.com', password: 'password123', timezone: 'UTC' })
        const realCourse = await Course.create({ courseName: 'Real course', courseCode: 'R 100', createdBy: realUser._id, joinCode: 'REAL0001' })
        await CourseMembership.create({ course: realCourse._id, user: realUser._id, role: 'admin', status: 'active' })

        await seedDemo()
        await seedDemo()

        expect(await User.exists({ _id: realUser._id })).not.toBeNull()
        expect(await Course.exists({ _id: realCourse._id })).not.toBeNull()
        expect(await CourseMembership.countDocuments({ course: realCourse._id })).toBe(1)
    })
})
