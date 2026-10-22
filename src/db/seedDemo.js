import { Types } from 'mongoose'
import User from '../models/user.js'
import Course from '../models/course.js'
import CourseMembership from '../models/courseMembership.js'
import Assignment from '../models/assignment.js'
import AssignmentUserState from '../models/assignmentUserState.js'
import Session from '../models/session.js'
import SessionParticipant from '../models/sessionParticipant.js'
import SessionMessage from '../models/sessionMessage.js'
import Availability from '../models/availability.js'

// The demo accounts. Their ids are fixed, so a run can still find the data
// of an account a visitor deleted. The .example domain never resolves.
const DEMO_USERS = [
    { _id: new Types.ObjectId('000000000000000000000d01'), username: 'demo', email: 'demo@studybuddy.example' },
    { _id: new Types.ObjectId('000000000000000000000d02'), username: 'maya', email: 'maya@studybuddy.example' },
    { _id: new Types.ObjectId('000000000000000000000d03'), username: 'jordan', email: 'jordan@studybuddy.example' }
]
export const DEMO_EMAIL = DEMO_USERS[0].email
export const DEMO_PASSWORD = 'studybuddy-demo'
export const DEMO_JOIN_CODE = 'DEMO2026'

const DAY = 24 * 60 * 60 * 1000
const TIMEZONE = 'America/Chicago'

// Deletes every demo document, then creates the demo data again. Re-running
// always gives the same starting state, whatever visitors changed, and never
// touches documents that don't belong to demo accounts or the demo course.
export async function seedDemo(now = new Date()) {
    await removeDemoData()
    return await createDemoData(now)
}

async function removeDemoData() {
    // Also any account that took a demo username or email (a visitor can
    // sign up as "demo" after deleting it), or re-creating them would fail
    // on the unique index
    const users = await User.find({
        $or: [
            { _id: { $in: DEMO_USERS.map((user) => user._id) } },
            { username: { $in: DEMO_USERS.map((user) => user.username) } },
            { email: { $in: DEMO_USERS.map((user) => user.email) } }
        ]
    }, { _id: 1 })
    const userIds = [...new Set([...DEMO_USERS.map((user) => user._id), ...users.map((user) => user._id)].map(String))]

    // The join code finds the demo course even if a visitor deleted the
    // demo account that created it
    const courses = await Course.find({ $or: [{ createdBy: { $in: userIds } }, { joinCode: DEMO_JOIN_CODE }] }, { _id: 1 })
    const courseIds = courses.map((course) => course._id)

    const sessions = await Session.find({ $or: [{ course: { $in: courseIds } }, { host: { $in: userIds } }] }, { _id: 1 })
    const sessionIds = sessions.map((session) => session._id)

    const assignments = await Assignment.find({ $or: [{ course: { $in: courseIds } }, { createdBy: { $in: userIds } }] }, { _id: 1 })
    const assignmentIds = assignments.map((assignment) => assignment._id)

    // Children first, so a run that stops halfway still leaves the parents
    // for the next run to find
    await SessionMessage.deleteMany({ $or: [{ session: { $in: sessionIds } }, { sender: { $in: userIds } }] })
    await SessionParticipant.deleteMany({ $or: [{ session: { $in: sessionIds } }, { user: { $in: userIds } }] })
    await AssignmentUserState.deleteMany({ $or: [{ assignment: { $in: assignmentIds } }, { user: { $in: userIds } }] })
    await Availability.deleteMany({ user: { $in: userIds } })
    await CourseMembership.deleteMany({ $or: [{ course: { $in: courseIds } }, { user: { $in: userIds } }] })
    await Session.deleteMany({ _id: { $in: sessionIds } })
    await Assignment.deleteMany({ _id: { $in: assignmentIds } })
    await Course.deleteMany({ _id: { $in: courseIds } })
    await User.deleteMany({ _id: { $in: userIds } })
}

async function createDemoData(now) {
    const daysFromNow = (days) => new Date(now.getTime() + days * DAY)

    // save() (through create) runs the pre-save hook that hashes passwords
    const [demo, maya, jordan] = await User.create(
        DEMO_USERS.map((user) => ({ ...user, password: DEMO_PASSWORD, timezone: TIMEZONE })))

    const course = await Course.create({
        title: 'Data Structures',
        courseName: 'Data Structures and Algorithms',
        courseCode: 'CS 2420',
        school: 'Demo University',
        createdBy: demo._id,
        joinCode: DEMO_JOIN_CODE
    })

    await CourseMembership.create([
        { course: course._id, user: demo._id, role: 'admin', status: 'active' },
        { course: course._id, user: maya._id, role: 'moderator', status: 'active' },
        { course: course._id, user: jordan._id, role: 'member', status: 'active' }
    ])

    const [hashMaps, , sorting] = await Assignment.create([
        { course: course._id, createdBy: maya._id, source: 'moderator', title: 'Hash map implementation', description: 'Open addressing with linear probing.', dueAt: daysFromNow(3) },
        { course: course._id, createdBy: maya._id, source: 'moderator', title: 'Graph traversal problem set', description: 'BFS, DFS, and topological sort.', dueAt: daysFromNow(10) },
        { course: course._id, createdBy: jordan._id, source: 'community', title: 'Sorting practice quiz', dueAt: daysFromNow(-2) }
    ])

    // The demo user's own progress. None for the graph problem set: absence means the
    // defaults (not started, due when the assignment is due).
    await AssignmentUserState.create([
        { assignment: hashMaps._id, course: course._id, user: demo._id, state: 'in_progress', personalNotes: 'Resize at 0.7 load factor.', personalDueAt: daysFromNow(2) },
        { assignment: sorting._id, course: course._id, user: demo._id, state: 'complete', completedAt: daysFromNow(-3) }
    ])

    const session = await Session.create({
        course: course._id,
        host: maya._id,
        title: 'Hash map study group',
        goal: 'Finish the probing logic together',
        description: 'Bring your current implementation.',
        startsAt: daysFromNow(1),
        endsAt: new Date(daysFromNow(1).getTime() + 2 * 60 * 60 * 1000),
        timezone: TIMEZONE,
        capacity: 6,
        location: 'Library room 204',
        locationType: 'in_person'
    })

    await SessionParticipant.create([
        { session: session._id, user: maya._id, status: 'accepted', respondedAt: now },
        { session: session._id, user: demo._id, status: 'accepted', respondedAt: now },
        { session: session._id, user: jordan._id, status: 'accepted', respondedAt: now }
    ])

    // One at a time, so each message gets a later sentAt than the one before
    const messages = [
        [maya, 'I booked room 204 for tomorrow.'],
        [jordan, 'Is anyone else stuck on deletion with linear probing?'],
        [demo, 'Yes, tombstones fixed it for me. I can walk through it.']
    ]
    for (const [sender, body] of messages) {
        await SessionMessage.create({ session: session._id, course: course._id, sender: sender._id, body })
    }

    await Availability.create({
        user: demo._id,
        timezone: TIMEZONE,
        blocks: [{ day: 1, startMin: 18 * 60, endMin: 21 * 60 }, { day: 3, startMin: 18 * 60, endMin: 21 * 60 }]
    })

    return { users: [demo, maya, jordan], course, session }
}
