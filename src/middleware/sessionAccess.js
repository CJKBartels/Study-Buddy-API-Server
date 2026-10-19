import { isValidObjectId } from 'mongoose'
import Session from '../models/session.js'
import SessionParticipant from '../models/sessionParticipant.js'
import AppError from '../assets/AppError.js'

export const isSession = async (req, res, next) => {
    const { params } = req

    if (!isValidObjectId(params.sessionId)) {
        return next(new AppError('BAD_REQUEST', { message: 'Invalid session id' }))
    }

    const session = await Session.findOne({ _id: params.sessionId, course: req.course._id })

    if (!session) {
        return next(new AppError('SESSION_NOT_FOUND'))
    }

    req.session = session

    next()
}

export const isSessionParticipant = async (req, res, next) => {
    const participant = await SessionParticipant.findOne({ session: req.session._id, user: req.user._id })

    if (participant?.status !== 'accepted') {
        return next(new AppError('NOT_SESSION_PARTICIPANT'))
    }

    next()
}

export const isSessionHost = async (req, res, next) => {
    if (!req.session.host.equals(req.user._id)) {
        return next(new AppError('NOT_SESSION_HOST'))
    }

    next()
}
