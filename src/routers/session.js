import Router from 'express'
import auth from '../middleware/auth.js'
import Session from '../models/session.js'
import { isCourse, isCourseMember } from '../middleware/courseAccess.js'
import { isSession, isSessionHost, isSessionParticipant } from '../middleware/sessionAccess.js'
import SessionParticipant from '../models/sessionParticipant.js'
import CourseMembership from '../models/courseMembership.js'
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

// The status someone gets for saying yes: accepted while there is room,
// waitlisted once the session is full. No capacity means no limit.
// Known race: count-then-write, so two people taking the last spot at the
// same moment can overbook by one. Accepted on purpose: an atomic counter on
// Session would have to be kept in sync on every path that changes who is
// accepted, and one missed path would make sessions look full when they aren't.
// Fill open spots from the waitlist, longest-waiting first. Call it from every
// path that can open a spot (leave, remove, raising capacity). This is the
// server-side waitlisted -> accepted move the status table allows and that
// RSVP and join refuse. Each promotion is one atomic findOneAndUpdate, so two
// promotions running at once never pick the same person. Missing a call only
// delays promotion until the next trigger; it can't corrupt anything.
const promoteFromWaitlist = async (session) => {
    const accepted = await SessionParticipant.countDocuments({ session: session._id, status: 'accepted' })
    const openSpots = session.capacity == null ? Infinity : session.capacity - accepted

    for (let promoted = 0; promoted < openSpots; promoted++) {
        const next = await SessionParticipant.findOneAndUpdate(
            { session: session._id, status: 'waitlisted' },
            { status: 'accepted' },
            { sort: { respondedAt: 1, _id: 1 } }
        )
        if (!next) break
    }
}

const statusIfAccepting = async (session) => {
    if (session.capacity == null) {
        return 'accepted'
    }

    const accepted = await SessionParticipant.countDocuments({ session: session._id, status: 'accepted' })
    return accepted < session.capacity ? 'accepted' : 'waitlisted'
}

/**
 * Create Session
 *
 * @openapi
 * /courses/{courseId}/sessions:
 *   post:
 *     summary: Create a session
 *     description: The creator becomes the host and an accepted participant. Server-set fields (course, host, timezone, status) are rejected.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SessionCreateRequest'
 *     responses:
 *       201:
 *         description: The created session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * Get Sessions
 *
 * @openapi
 * /courses/{courseId}/sessions:
 *   get:
 *     summary: List sessions in a course
 *     description: Sorted by start time. Only scheduled sessions unless `status` says otherwise.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - in: query
 *         name: mine
 *         schema:
 *           type: boolean
 *         description: Only sessions you host
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, cancelled]
 *           default: scheduled
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Sessions starting at or after this time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Sessions starting at or before this time
 *     responses:
 *       200:
 *         description: Array of sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * Get Session
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}:
 *   get:
 *     summary: Get a session
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: The session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/courses/:courseId/sessions/:sessionId', auth, isCourse, isCourseMember, isSession, async (req, res) => {
    res.status(200).send(req.session)
})

/**
 * Edit Session
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}:
 *   patch:
 *     summary: Edit a session (host only)
 *     description: Raising or removing capacity promotes people from the waitlist, longest-waiting first. Lowering it never removes anyone already accepted.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SessionPatchRequest'
 *     responses:
 *       200:
 *         description: The updated session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

        // A higher (or removed) capacity can open spots. A lower one never
        // demotes anyone already accepted; promotion just waits until the
        // accepted count drops below the new capacity.
        if (props.includes('capacity')) {
            await promoteFromWaitlist(session)
        }

        res.status(200).send(session)
    }
)

/**
 * Cancel Session
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}:
 *   delete:
 *     summary: Cancel a session (host only)
 *     description: Sets status to cancelled; the session is kept.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: The session, now cancelled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/courses/:courseId/sessions/:sessionId',
    auth, isCourse, isCourseMember, isSession, isSessionHost,
    async (req, res) => {
        const { session } = req

        session.status = 'cancelled'
        await session.save()

        res.status(200).send(session)
    }
)

/**
 * Get Session Participants
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/participants:
 *   get:
 *     summary: List participants (participants only)
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [invited, accepted, declined, waitlisted, removed, left]
 *         description: Only participants with this status
 *     responses:
 *       200:
 *         description: Array of participants, with usernames
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   user:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       username:
 *                         type: string
 *                   invitedBy:
 *                     type: string
 *                   respondedAt:
 *                     type: string
 *                     format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * Invite User
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/invites:
 *   post:
 *     summary: Invite one course member (participants only)
 *     description: One invite per request; send one request per person to invite a group. Users who declined or left can be invited again. Only the host can re-invite a removed user.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       201:
 *         description: The invited participant
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionParticipant'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
// One invite per request. To invite a group, the client sends one request per
// person, so every success and failure uses the normal response shapes.
router.post('/courses/:courseId/sessions/:sessionId/invites',
    auth, isCourse, isCourseMember, isSession, isSessionParticipant,
    async (req, res) => {
        const { session, course, body, user } = req
        const { userId } = body ?? {}

        if (!isValidObjectId(userId)) {
            throw new AppError('BAD_REQUEST', { message: 'Invalid user id' })
        }

        const membership = await CourseMembership.findOne({ course: course._id, user: userId })

        if (membership?.status !== 'active') {
            throw new AppError('INVITEE_NOT_IN_COURSE')
        }

        // Same atomic upsert as join: create the invite if absent, otherwise
        // leave the existing doc alone so the table can check it below.
        const result = await SessionParticipant.findOneAndUpdate(
            { session: session._id, user: userId },
            { $setOnInsert: { status: 'invited', invitedBy: user._id } },
            { upsert: true, new: true, includeResultMetadata: true }
        )
        const participant = result.value

        if (result.lastErrorObject.updatedExisting) {
            if (['invited', 'accepted', 'waitlisted'].includes(participant.status)) {
                throw new AppError('ALREADY_PARTICIPANT', { message: `User is already ${participant.status}` })
            }

            // The table allows removed -> invited, but removal is the host's call,
            // so only the host may undo it.
            if (participant.status === 'removed' && !session.host.equals(user._id)) {
                throw new AppError('NOT_SESSION_HOST', { message: 'Only the host can re-invite a removed user' })
            }
            assertCanMove(participant, 'invited')

            participant.status = 'invited'
            participant.invitedBy = user._id
            participant.respondedAt = undefined
            await participant.save()
        }

        res.status(201).send(participant)
    }
)

/**
 * Join Open Session
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/join:
 *   post:
 *     summary: Join an open session
 *     description: Accepts a pending invite too. When the session is full, the participant is waitlisted instead of accepted.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: The participant (status accepted or waitlisted)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionParticipant'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.post('/courses/:courseId/sessions/:sessionId/join',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { session, user } = req

        if (session.joinPolicy !== 'course_open') {
            throw new AppError('SESSION_NOT_OPEN')
        }

        const status = await statusIfAccepting(session)

        // Atomic upsert: creates the participant if absent, otherwise returns the
        // existing doc untouched. updatedExisting tells the two cases apart.
        // Must stay $setOnInsert, not $set: $set would write 'accepted' onto an
        // existing doc (e.g. a removed user) before the table check below runs.
        const result = await SessionParticipant.findOneAndUpdate(
            { session: session._id, user: user._id },
            { $setOnInsert: { status, respondedAt: new Date() } },
            { upsert: true, new: true, includeResultMetadata: true }
        )
        const participant = result.value

        if (result.lastErrorObject.updatedExisting) {
            // waitlisted is refused here too: the table's waitlisted -> accepted
            // is for the server promoting someone, not for joining again.
            if (['accepted', 'waitlisted'].includes(participant.status)) {
                throw new AppError('ALREADY_PARTICIPANT', { message: `User is already ${participant.status}` })
            }
            assertCanMove(participant, status)

            participant.status = status
            participant.respondedAt = new Date()
            await participant.save()
        }

        res.status(200).send(participant)
    }
)

/**
 * RSVP
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/participants/me:
 *   patch:
 *     summary: Answer an invite
 *     description: Only works while invited. Accepting a full session waitlists you.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [accepted, declined]
 *     responses:
 *       200:
 *         description: Your participant record (status accepted, waitlisted, or declined)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionParticipant'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.patch('/courses/:courseId/sessions/:sessionId/participants/me',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { user, session, body } = req
        const answer = body?.status

        // Only the two answers an invite allows; anything else is refused
        // instead of silently counting as a decline
        if (!['accepted', 'declined'].includes(answer)) {
            throw new AppError('VALIDATION_ERROR', { details: { status: 'Must be accepted or declined' } })
        }

        const participant = await SessionParticipant.findOne({ session: session._id, user: user._id })

        if (!participant) {
            throw new AppError('NOT_INVITED')
        }

        const accepting = answer === 'accepted'

        if (accepting && participant.status === 'accepted') {
            throw new AppError('ALREADY_PARTICIPANT')
        }

        // RSVP only answers an invite. The table allows waitlisted -> accepted,
        // but only so the server can promote someone when a spot opens. Without
        // this check, a waitlisted user could RSVP "true" and skip the line.
        if (participant.status !== 'invited') {
            throw statusChangeError(participant, accepting ? 'accepted' : 'declined')
        }

        const status = accepting ? await statusIfAccepting(session) : 'declined'
        assertCanMove(participant, status)

        participant.status = status
        participant.respondedAt = new Date()
        await participant.save()

        res.status(200).send(participant)
    }
)

/**
 * Leave Session
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/participants/me:
 *   delete:
 *     summary: Leave a session or its waitlist
 *     description: Sets your status to left. If you were accepted, the longest-waiting person on the waitlist takes your spot. The host can't leave; cancel the session instead.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Your participant record, now left
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionParticipant'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
// Declared before /participants/:userId, or Express would treat "me" as a user id
router.delete('/courses/:courseId/sessions/:sessionId/participants/me',
    auth, isCourse, isCourseMember, isSession,
    async (req, res) => {
        const { session, user } = req

        if (session.host.equals(user._id)) {
            throw new AppError('BAD_REQUEST', { message: 'Host cannot leave; cancel the session instead' })
        }

        const participant = await SessionParticipant.findOne({ session: session._id, user: user._id })

        if (!participant) {
            throw new AppError('PARTICIPANT_NOT_FOUND')
        }
        assertCanMove(participant, 'left')

        const freesASpot = participant.status === 'accepted'
        participant.status = 'left'
        await participant.save()

        if (freesASpot) {
            await promoteFromWaitlist(session)
        }

        res.status(200).send(participant)
    }
)

/**
 * Remove Participant
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/participants/{userId}:
 *   delete:
 *     summary: Remove a participant (host only)
 *     description: The host cannot remove themselves. Removing an accepted participant promotes the longest-waiting person from the waitlist.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: The participant, now removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionParticipant'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
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

        const freesASpot = participant.status === 'accepted'
        participant.status = 'removed'
        await participant.save()

        if (freesASpot) {
            await promoteFromWaitlist(session)
        }

        res.status(200).send(participant)
    }
)

/**
 * Send Message
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/messages:
 *   post:
 *     summary: Send a message (participants only)
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: The sent message
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionMessage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * Get Messages
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/messages:
 *   get:
 *     summary: Get message history (participants only)
 *     description: Oldest first. Deleted messages are left out.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Messages sent at or after this time
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Messages sent at or before this time
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Array of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SessionMessage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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
        // _id breaks ties between messages sent in the same millisecond, so
        // pages never overlap or skip a message
        const messages = await SessionMessage.find(filter)
            .sort({ sentAt: 1, _id: 1 })
            .skip(offset)
            .limit(limit)

        res.status(200).send(messages)
    }
)

/**
 * Edit Messages
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/messages/{messageId}:
 *   patch:
 *     summary: Edit your message
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: The edited message
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionMessage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * Delete Message
 *
 * @openapi
 * /courses/{courseId}/sessions/{sessionId}/messages/{messageId}:
 *   delete:
 *     summary: Delete a message (sender or host)
 *     description: Soft delete. The message is hidden from history but kept in the database.
 *     tags: [Sessions]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: The message, with deletedAt set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionMessage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

        res.status(200).send(message)
    }
)

export default router
