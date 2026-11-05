import { isValidObjectId } from 'mongoose'
import Course from '../models/course.js'
import CourseMembership from '../models/courseMembership.js'
import AppError from '../assets/AppError.js'

export const isCourse = async (req, res, next) => {
    const { params } = req

    if (!isValidObjectId(params.courseId)) {
        return next(new AppError('BAD_REQUEST', { message: 'Invalid course id' }))
    }

    const course = await Course.findById(params.courseId)

    if (!course) {
        return next(new AppError('COURSE_NOT_FOUND'))
    }

    req.course = course

    next()
}

// The caller's active membership of req.course. Anyone without one is turned
// away here, and for a private course the answer is the same as for a course
// that doesn't exist, so the response doesn't confirm that it does.
async function activeMembership(req) {
    const { course, user } = req
    const membership = await CourseMembership.findOne({ course: course._id, user: user._id })

    if (membership?.status === 'active') {
        return membership
    }

    if (!course.isPublic) {
        throw new AppError('COURSE_NOT_FOUND')
    }

    throw new AppError(membership ? 'COURSE_BANNED' : 'NOT_COURSE_MEMBER')
}

// For routes open to anyone who can see the course: everyone for a public
// course, active members for a private one
export const canSeeCourse = async (req, res, next) => {
    if (!req.course.isPublic) {
        await activeMembership(req)
    }

    next()
}

export const isCourseMember = async (req, res, next) => {
    req.courseMembership = await activeMembership(req)

    next()
}

export const isCourseAdmin = async (req, res, next) => {
    const membership = await activeMembership(req)

    if (membership.role != 'admin') {
        return next(new AppError('NOT_COURSE_ADMIN'))
    }

    req.courseMembership = membership

    next()
}

export const isCourseModerator = async (req, res, next) => {
    const membership = await activeMembership(req)

    if (membership.role == 'member') {
        return next(new AppError('NOT_COURSE_MODERATOR'))
    }

    req.courseMembership = membership

    next()
}

