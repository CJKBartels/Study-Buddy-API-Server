import Router from 'express'
import auth from '../middleware/auth.js'
import Session from '../models/session.js'
import { isCourse, isCourseMember } from '../middleware/courseAccess.js'
import { isSession, isSessionHost, isSessionParticipant } from '../middleware/sessionAccess.js'
import SessionParticipant from '../models/sessionParticipant.js'
import { isValidObjectId } from 'mongoose'
import SessionMessage from '../models/sessionMessage.js'
import AppError from '../assets/AppError.js'

const router = new Router()

const statusChangeError = (participant, status) =>
    new AppError('INVALID_STATUS_CHANGE', { message: `Cannot change status from ${participant.status} to ${status}` })

// Throws unless SessionParticipant's status table allows this change
const assertCanMove = (participant, status) => {
    if (!participant.canMoveTo(status)) {
        throw statusChangeError(participant, status)
    }
}

//Create Session
router.post('/courses/:courseId/sessions', auth, isCourse, isCourseMember, async (req, res) => {
    const { body, course, user } = req

    // course, host, timezone, and status are set by the server, never the client
    const creatable = ['title', 'goal', 'description', 'startsAt', 'endsAt', 'location', 'locationType', 'capacity', 'joinPolicy']
    const rejected = Object.keys(body).filter((field) => !creatable.includes(field))

    if (rejected.length > 0) {
        const details = Object.fromEntries(rejected.map((field) => [field, 'Field cannot be set']))
        throw new AppError('VALIDATION_ERROR', { details })
    }

    const session = new Session({
        ...body,
        course: course._id,
        host: user._id,
        timezone: user.timezone
    })
    await session.save()

    await SessionParticipant.create({
        session: session._id,
        user: user._id,
        status: 'accepted',
        respondedAt: new Date()
    })

    res.status(201).send(session)
})

//Get Sessions
router.get('/courses/:courseId/sessions', auth, isCourse, isCourseMember, async (req, res) => {
    const { user, course, query } = req
    let filter = { course: course._id }

    if (query?.mine) {
        filter.host = user._id
    }

    filter.status = query?.status ?? 'scheduled'

    const startsAt = {}
    if (query?.from) {
        startsAt.$gte = query.from
    }
    if (query?.to) {
        startsAt.$lte = query.to
    }

    if (Object.keys(startsAt).length > 0) {
        filter.startsAt = startsAt
    }

    const sessions = await Session.find(filter).sort({ startsAt: 1 })
    res.status(200).send(sessions)
})

//Get Session
router.get('/courses/:courseId/sessions/:sessionId', auth, isCourse, isCourseMember, isSession, async (req, res) => {
    res.status(200).send(req.session)
})

//Edit Session
router.patch('/courses/:courseId/sessions/:sessionId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    async (req, res) => {
        const { body: mods, session } = req

        if (Object.keys(mods).length === 0) {
            throw new AppError('INVALID_UPDATES', { message: 'Missing updates' })
        }

        const props = Object.keys(mods)
        const modifiable = ['title', 'goal', 'description', 'startsAt', 'endsAt', 'location', 'locationType', 'capacity', 'joinPolicy', 'status']

        const isValid = props.every((prop) => modifiable.includes(prop))

        if (!isValid) {
            throw new AppError('INVALID_UPDATES')
        }

        props.forEach((prop) => session[prop] = mods[prop])
        await session.save()

        res.status(200).send(session)
    }
)

//Cancel Session
router.delete('/courses/:courseId/sessions/:sessionId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    async (req, res) => {
        const { session } = req

        session.status = 'cancelled'
        await session.save()

        res.status(200).send('Session Cancelled Successfully')
    }
)

//Get Session Participants
router.get('/courses/:courseId/sessions/:sessionId/participants',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { session, query } = req

        const filter = {
            session: session._id,
        }

        if (query?.status) {
            filter.status = query.status
        }

        const participants = await SessionParticipant.find(filter, { status: 0, session: 0 })
            .populate('user', 'username')

        res.status(200).send(participants)
    }
)

//Invite Users
router.post('/courses/:courseId/sessions/:sessionId/invites',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        try {
            const { session, body: invitees, user } = req

            const failedUserIds = []

            const data = invitees.filter((i) => isValidObjectId(i))
                .map((i) => {
                    return {
                        session: session._id,
                        user: i,
                        invitedBy: user._id,
                        status: 'invited'
                    }
                })

            let documents = await SessionParticipant.create(data, { aggregateErrors: true })
            documents = documents.map((i) => {
                if (i.session) return i

                return {
                    code: i.code,
                    msg: i.errorResponse.errmsg
                }
            })

            res.status(200).send(documents)
        } catch (err) {
            res.status(500).json(err)
        }
    }
)

//Join Open Session
router.post('/courses/:courseId/sessions/:sessionId/join',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { session, user } = req

        if (session.joinPolicy !== 'course_open') {
            throw new AppError('SESSION_NOT_OPEN')
        }

        // Atomic upsert: creates the participant if absent, otherwise returns the
        // existing doc untouched. updatedExisting tells the two cases apart.
        // Must stay $setOnInsert, not $set: $set would write 'accepted' onto an
        // existing doc (e.g. a removed user) before the table check below runs.
        const result = await SessionParticipant.findOneAndUpdate(
            { session: session._id, user: user._id },
            { $setOnInsert: { status: 'accepted', respondedAt: new Date() } },
            { upsert: true, new: true, includeResultMetadata: true }
        )
        const participant = result.value

        if (result.lastErrorObject.updatedExisting) {
            if (participant.status === 'accepted') {
                throw new AppError('ALREADY_PARTICIPANT')
            }
            assertCanMove(participant, 'accepted')

            participant.status = 'accepted'
            participant.respondedAt = new Date()
            await participant.save()
        }

        res.status(200).send(participant)
    }
)

//RSVP
router.patch('/courses/:courseId/sessions/:sessionId/participants/me/:decision',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { user, session, params } = req

        const participant = await SessionParticipant.findOne({ session: session._id, user: user._id })

        if (!participant) {
            throw new AppError('NOT_INVITED')
        }

        const status = params.decision === 'true' ? 'accepted' : 'declined'

        if (status === 'accepted' && participant.status === 'accepted') {
            throw new AppError('ALREADY_PARTICIPANT')
        }

        // RSVP only answers an invite. The table allows waitlisted -> accepted,
        // but only so the server can promote someone when a spot opens. Without
        // this check, a waitlisted user could RSVP "true" and skip the line.
        if (participant.status !== 'invited') {
            throw statusChangeError(participant, status)
        }
        assertCanMove(participant, status)

        participant.status = status
        participant.respondedAt = new Date()
        await participant.save()

        res.status(200).send('User has joined the session')
    }
)

//Remove Participant
router.delete('/courses/:courseId/sessions/:sessionId/participants/:userId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    async (req, res) => {
        const { session, params } = req

        if (session.host.equals(params.userId)) {
            throw new AppError('BAD_REQUEST', { message: 'Host cannot remove themselves' })
        }

        const participant = await SessionParticipant.findOne({ session: session._id, user: params.userId })

        if (!participant) {
            throw new AppError('PARTICIPANT_NOT_FOUND')
        }
        assertCanMove(participant, 'removed')

        participant.status = 'removed'
        await participant.save()

        res.status(200).send(participant)
    }
)

//Send Message
router.post('/courses/:courseId/sessions/:sessionId/messages',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { body, user, session, course } = req

        const message = await SessionMessage.create({
            session: session._id,
            sender: user._id,
            course: course._id,
            body: body.message
        })

        res.status(201).send(message)
    }
)

//Get Messages
router.get('/courses/:courseId/sessions/:sessionId/messages',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { session, query } = req

        const filter = {
            session: session._id,
            deletedAt: null
        }

        const sentAt = {}
        if (query?.after) {
            sentAt.$gte = query.after
        }
        if (query?.before) {
            sentAt.$lte = query.before
        }
        if (Object.keys(sentAt).length > 0) {
            filter.sentAt = sentAt
        }

        const offset = Math.max(0, parseInt(query?.offset) || 0)
        const limit = Math.min(100, Math.max(1, parseInt(query?.limit) || 50))
        const messages = await SessionMessage.find(filter).skip(offset).limit(limit)

        res.status(200).send(messages)
    }
)

//Edit Messages
router.patch('/courses/:courseId/sessions/:sessionId/messages/:messageId',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { user, params, body, session } = req

        const message = await SessionMessage.findOne({ _id: params.messageId, session: session._id })

        if (!message || message.deletedAt) {
            throw new AppError('MESSAGE_NOT_FOUND')
        }

        if (!user._id.equals(message.sender)) {
            throw new AppError('CANNOT_MODIFY_MESSAGE', { message: 'User cannot edit messages they did not send' })
        }

        message.edited = true
        message.body = body.message
        await message.save()

        res.status(200).send(message)
    }
)

// Delete Message
router.delete('/courses/:courseId/sessions/:sessionId/messages/:messageId',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { user, params, session } = req

        const message = await SessionMessage.findOne({ _id: params.messageId, session: session._id })

        if (!message) {
            throw new AppError('MESSAGE_NOT_FOUND')
        }

        if (!user._id.equals(message.sender) && !user._id.equals(session.host)) {
            throw new AppError('CANNOT_MODIFY_MESSAGE', { message: 'User cannot delete this message' })
        }

        if (message.deletedAt) {
            throw new AppError('MESSAGE_NOT_FOUND', { message: 'Message already deleted' })
        }

        message.deletedAt = new Date()
        await message.save()

        res.status(200).send('Message deleted successfully')
    }
)

export default router
