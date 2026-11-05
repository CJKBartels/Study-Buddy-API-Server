import AppError from '../assets/AppError.js'
import AssignmentUserState from '../models/assignmentUserState.js'
import Availability from '../models/availability.js'
import CourseMembership from '../models/courseMembership.js'
import Session from '../models/session.js'
import SessionParticipant from '../models/sessionParticipant.js'

async function refuseIfLastAdmin(user) {
    const adminships = await CourseMembership.find({ user: user._id, role: 'admin', status: 'active' }, { course: 1 })
    const isLast = await Promise.all(adminships.map(({ course }) => CourseMembership.isLastAdmin(course, user._id)))
    const courses = adminships.filter((adminship, index) => isLast[index]).map(({ course }) => course)

    if (courses.length > 0) {
        throw new AppError('LAST_ADMIN', { details: { courses } })
    }
}

// Past sessions stay as they are, as a record. A session still running counts
// as upcoming, since there's nobody left to run it.
function cancelHostedSessions(user) {
    return Session.updateMany(
        { host: user._id, status: 'scheduled', endsAt: { $gt: new Date() } },
        { status: 'cancelled' }
    )
}

// One spot at a time, so a retry after a failure picks up at the next spot
async function giveUpSessionSpots(user) {
    const spots = await SessionParticipant.find({ user: user._id })

    for (const spot of spots) {
        await spot.deleteOne()

        const session = await Session.findById(spot.session)
        if (session?.status === 'scheduled') {
            await SessionParticipant.promoteFromWaitlist(session)
        }
    }
}

// Removes a user and everything that belongs only to them. Shared work stays:
// their assignments, because classmates' progress depends on them, and their
// messages, which clients show as sent by a deleted user.
//
// This is not one transaction, because that would need MongoDB to run as a
// replica set everywhere. Instead the user goes last and every step can safely
// run twice. If a step fails, the account still exists, and deleting it again
// finishes the job.
export async function deleteAccount(user) {
    await refuseIfLastAdmin(user)
    await cancelHostedSessions(user)
    await giveUpSessionSpots(user)

    await Promise.all([
        CourseMembership.deleteMany({ user: user._id }),
        AssignmentUserState.deleteMany({ user: user._id }),
        Availability.deleteMany({ user: user._id })
    ])

    await user.deleteOne()
}
