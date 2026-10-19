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
        try {
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
        } catch (err) {
            res.status(500).json(err)
        }
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

        if (session.joinPolicy != 'course_open') {
            res.status(403).send('Not an Open Session')
            return
        }

        const data = {
            session: session._id,
            user: user._id,
            status: 'accepted'
        }

        try {
            let document = await SessionParticipant.create(data)
            res.status(200).send(document)
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).send('User is already a participant')
            }

            res.status(500).json(err)
        }
    }
)

//RSVP
router.patch('/courses/:courseId/sessions/:sessionId/participants/me/:decision',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { user, session, params } = req

        const participantDoc = await SessionParticipant.findOne({ session: session._id, user: user._id })

        if (!participantDoc) {
            res.status(403).send('User was not invited to session')
            return
        }

        if (params.decision == 'true') {

            if (participantDoc.status == 'accepted') {
                res.status(409).send('User is alreadly a participant')
                return
            }

            if (participantDoc.status == 'waitlisted') {
                res.status(400).send('Session is currently at capacity')
                return
            }

            participantDoc.status = 'accepted'
        } else {
            participantDoc.status = 'declined'
        }

        try {
            await participantDoc.save()
            res.status(200).send('User has joined the session')
        } catch (error) {
            res.status(500).json(error)
        }

    }
)

//Remove Participant
router.delete('/courses/:courseId/sessions/:sessionId/participants/:userId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    async (req, res) => {
        const { session, params } = req
        try {
            const participant = await SessionParticipant.updateOne({ session: session._id, user: params.userId }, { status: 'removed' })

            res.send(participant)
        } catch (error) {
            res.json(error)
        }

    }
)

//Send Message
router.post('/courses/:courseId/sessions/:sessionId/messages',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { body, user, session, course } = req

        const data = {
            session: session._id,
            sender: user._id,
            course: course._id,
            body: body.message
        }

        try {
            const message = await SessionMessage.create(data)
            res.status(201).send(message)
        } catch (error) {
            res.status(500).json(error)
        }
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

        try {
            const offset = Math.max(0, parseInt(query?.offset) || 0)
            const limit = Math.min(100, Math.max(1, parseInt(query?.limit) || 50))
            const messages = await SessionMessage.find(filter).skip(offset).limit(limit)
            res.status(200).send(messages)
        } catch (error) {
            res.status(500).json(error)
        }
    }
)

//Edit Messages
router.patch('/courses/:courseId/sessions/:sessionId/messages/:messageId',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { user, params, body } = req

        const message = await SessionMessage.findOne({ _id: params.messageId })

        if (!message || message.deletedAt) {
            res.status(404).send('Message does not exist')
            return
        }

        if (!user._id.equals(message.sender)) {
            res.status(403).send('User cannot edit messages they did not send')
            return
        }

        message.edited = true
        message.body = body.message

        try {
            await message.save()
            res.status(200).send(message)
        } catch (error) {
            res.status(500).json(error)
        }
    }
)

// Delete Message
router.delete('/courses/:courseId/sessions/:sessionId/messages/:messageId',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { user, params, session } = req

        const message = await SessionMessage.findOne({ _id: params.messageId })

        if (!message) {
            res.status(404).send('Message does not exist')
            return
        }

        if (!user._id.equals(message.sender) && !user._id.equals(session.host)) {
            res.status(403).send('User cannot delete this message')
            return
        }

        if (message.deletedAt) {
            res.status(404).send('Message already deleted')
            return
        }

        message.deletedAt = new Date()

        try {
            await message.save()
            res.status(200).send('Message deleted successfully')
        } catch (error) {
            res.status(500).json(error)
        }

    }
)

export default router
