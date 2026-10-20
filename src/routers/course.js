import crypto from 'crypto'
import { Router } from 'express'
import auth from '../middleware/auth.js'
import Course from '../models/course.js'
import CourseMembership from '../models/courseMembership.js'
import Assignment from '../models/assignment.js'
import AssignmentUserState from '../models/assignmentUserState.js'
import Session from '../models/session.js'
import SessionParticipant from '../models/sessionParticipant.js'
import SessionMessage from '../models/sessionMessage.js'
import { isCourseAdmin, isCourse, isCourseMember } from '../middleware/courseAccess.js'
import AppError from '../assets/AppError.js'

const router = new Router()

/**
 * Create Course
 * 
 * @openapi
 * /courses:
 *   post:
 *     summary: Create Course
 *     tags: [Course]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *              $ref: '#/components/schemas/CourseCreateRequest'
 *     responses:
 *       201:
 *         description: User Object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Course'        
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
*/
router.post('/courses', auth, async (req, res) => {
    let { user, body: data } = req

    data.createdBy = user._id
    if (!data.title) {
        data.title = `${data.courseCode} - ${data.courseName}`
    }


    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const joinCode = generateJoinCode(8)
            const course = new Course(data)
            course.joinCode = joinCode

            await course.save()

            const courseMembership = new CourseMembership({
                course: course._id,
                user: user._id,
                role: 'admin',
                status: 'active'
            })

            try {
                await courseMembership.save()
            } catch (memberErr) {
                await course.deleteOne()
                throw memberErr
            }

            return res.status(201).send(course)
        } catch (err) {
            if (err?.code === 11000 && err?.keyPattern?.joinCode) continue
            throw err
        }
    }

    throw new AppError('INTERNAL_ERROR', { message: 'Failed to generate unique join code' })
})

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function generateJoinCode(length = CODE_LENGTH) {
    const bytes = crypto.randomBytes(length)
    let code = ''
    for (let i = 0; i < length; i++) {
        code += ALPHABET[bytes[i] % ALPHABET.length]
    }
    return code
}

/**
 * Get Course Details from Id
 * 
 * @openapi
 * /courses/{courseId}:
 *   get:
 *     summary: Get Course Details from Id
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: courseId
 *        schema:
 *          type: string
 *        description: Id of course in question
 *     responses:
 *       200:
 *         description: Course Object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Course'        
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId', auth, isCourse, async (req, res) => {
    const { course } = req
    const data = course.toObject()
    delete data.joinCode

    res.status(200).send(data)
})

/**
 * Get Join Code
 *
 * @openapi
 * /courses/{courseId}/joinCode:
 *   get:
 *     summary: Get the course join code (admin only)
 *     tags: [Course]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *     responses:
 *       200:
 *         description: The current join code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 joinCode:
 *                   type: string
 *                   example: K7Q2M9XA
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/courses/:courseId/joinCode', auth, isCourse, isCourseAdmin, async (req, res) => {
    res.status(200).send({ joinCode: req.course.joinCode })
})


/**
 * Get Courses
 * 
 * @openapi
 * /courses:
 *   get:
 *     summary: Get Courses
 *     tags: [Course]
 *     responses:
 *       200:
 *         description: Course Objects
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      $ref: '#/components/schemas/Course'        
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
*/
router.get('/courses', auth, async (req, res) => {  //Add more functionality later
    const courses = await Course.find({}, { joinCode: 0 })

    res.status(200).send(courses)
})

/**
 * Delete Course
 * 
 * @openapi
 * /courses/{courseId}:
 *    delete:
 *     summary: Delete Course
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: courseId
 *        schema:
 *          type: string
 *        description: Id of course in question
 *     responses:
 *       204:
 *         description: Course and everything in it deleted (no body)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.delete('/courses/:courseId', auth, isCourse, isCourseAdmin, async (req, res) => {
    const courseId = req.course._id

    const sessions = await Session.find({ course: courseId }, '_id')
    const sessionIds = sessions.map((s) => s._id)

    await Promise.all([
        SessionParticipant.deleteMany({ session: { $in: sessionIds } }),
        SessionMessage.deleteMany({ course: courseId }),
        AssignmentUserState.deleteMany({ course: courseId }),
    ])

    await Promise.all([
        Session.deleteMany({ course: courseId }),
        Assignment.deleteMany({ course: courseId }),
        CourseMembership.deleteMany({ course: courseId }),
    ])

    await req.course.deleteOne()

    res.status(204).send()
})

/**
 * Update Course
 * 
 * @openapi
 * /courses/{courseId}:
 *    patch:
 *     summary: Update Course
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: courseId
 *        schema:
 *          type: string
 *        description: Id of course in question
 *     requestBody:
 *      required: true
 *      content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                  title:
 *                      type: string
 *                  courseName:
 *                      type: string
 *                  courseCode:
 *                      type: string
 *                  school:
 *                      type: string
 *                  isPublic:
 *                      type: boolean          
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Course'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.patch('/courses/:courseId', auth, isCourse, isCourseAdmin, async (req, res) => {
    const { body: updates, course } = req

    const modifiable = ['title', 'courseName', 'courseCode', 'school', 'isPublic']
    const isValid = Object.keys(updates).every((key) => {
        return modifiable.includes(key)
    })

    if (!isValid) {
        throw new AppError('INVALID_UPDATES')
    }

    if ((updates.courseName || updates.courseCode) && !updates.title) {
        const newCode = updates.courseCode ?? course.courseCode
        const newName = updates.courseName ?? course.courseName
        updates.title = `${newCode} - ${newName}`
    }

    // A ValidationError from save() propagates to the central handler as a
    // 400 VALIDATION_ERROR with per-field details.
    Object.keys(updates).forEach((key) => {
        course[key] = updates[key]
    })
    await course.save()
    res.status(200).send(course)
})

/**
 * Join with joinCode
 * 
 * @openapi
 * /courses/join/{joinCode}:
 *    post:
 *     summary: Join course with code
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: joinCode
 *        schema:
 *          type: string
 *        description: joinCode of Course
 *     responses:
 *       201:
 *         description: Joined as a member
 *         content:
 *          text/plain:
 *              schema:
 *                  type: string
 *                  example: User has joined successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
*/
router.post('/courses/join/:joinCode', auth, async (req, res) => {
    const course = await Course.findOne({ joinCode: req.params.joinCode })
    const { user } = req

    if (!course) {
        throw new AppError('COURSE_NOT_FOUND', { message: 'No course found for code' })
    }

    const data = {
        course: course._id,
        user: user._id,
        role: 'member',
        status: 'active'
    }

    try {
        const membership = new CourseMembership(data)
        await membership.save()
        res.status(201).send('User has joined successfully')
    } catch (err) {
        if (err?.code !== 11000) throw err

        const membership = await CourseMembership.findOne({ course: course._id, user: user._id })
        if (membership.status == 'banned') {
            throw new AppError('COURSE_BANNED')
        }
        throw new AppError('CONFLICT', { message: 'User is already a member' })
    }
})

/**
 * Rotate joinCode
 * 
 * @openapi
 * /courses/{courseId}/joinCode:
 *    patch:
 *     summary: Rotate join code
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: courseId
 *        schema:
 *          type: string
 *        description: id of course
 *     responses:
 *       201:
 *         description: The new join code
 *         content:
 *          text/plain:
 *              schema:
 *                  type: string
 *                  example: K7Q2M9XA
 *       500:
 *          description: Failed to generate unique join code
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.patch('/courses/:courseId/joinCode', auth, isCourse, isCourseAdmin, async (req, res) => {
    const { course } = req

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const joinCode = generateJoinCode(8)
            course.joinCode = joinCode

            await course.save()
            return res.status(201).send(joinCode)
        } catch (err) {
            if (err?.code === 11000 && err?.keyPattern?.joinCode) continue
            throw err
        }
    }

    throw new AppError('INTERNAL_ERROR', { message: 'Failed to generate unique join code' })
})

/**
 * Get Members
 * 
 * @openapi
 * /courses/{courseId}/members:
 *    get:
 *     summary: Get course members
 *     tags: [Course]
 *     parameters:
 *      - in: path
 *        required: true
 *        name: courseId
 *        schema:
 *          type: string
 *        description: id of course
 *     responses:
 *       200:
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      type: object
 *                      properties:
 *                          id: 
 *                              type: string
 *                          course:
 *                              type: string
 *                          user:
 *                              type: object
 *                              properties:
 *                                  id:
 *                                      type: string
 *                                  username:
 *                                      type: string
 *                          role:
 *                              type: string
 *                          joinedAt:
 *                              type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId/members', auth, isCourse, isCourseMember, async (req, res) => {
    const { course } = req

    const members = await CourseMembership.find(
        { course: course._id, status: 'active' },
        { status: 0, courseId: 0, updatedAt: 0, __v: 0 })
        .populate('user', 'username')

    res.status(200).send(members)
})

/**
* Get Member
* 
* @openapi
* /courses/{courseId}/members/{userId}:
*    get:
*     summary: Get member details
*     tags: [Course]
*     parameters:
*      - in: path
*        required: true
*        name: courseId
*        schema:
*          type: string
*        description: id of course
*      - in: path
*        required: true
*        name: userId
*        schema:
*          type: string
*        description: id of member
*     responses:
*       200:
*         content:
*          application/json:
*              schema:
*               type: object
*               properties:
*                   id: 
*                       type: string
*                   user:
*                       type: object
*                       properties:
*                           id:
*                               type: string
*                           username:
*                               type: string
*                   role:
*                       type: string
*                   status:
*                       type: string
*                   joinedAt:
*                       type: string
*                   updatedAt:
*                       type: string
*       400:
*         $ref: '#/components/responses/BadRequest'
*       401:
*         $ref: '#/components/responses/Unauthorized'
*       403:
*         $ref: '#/components/responses/Forbidden'
*       404:
*         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId/members/:userId', auth, isCourse, isCourseMember, async (req, res) => {
    const { params } = req
    const membership = await CourseMembership.findOne({ course: params.courseId, user: params.userId }, { course: 0, __v: 0 }).populate('user', 'username')

    if (!membership) {
        throw new AppError('NOT_FOUND', { message: 'User specified is not a member of course' })
    }

    res.status(200).send(membership)
})

/**
 * Change Member Role or Status
 *
 * @openapi
 * /courses/{courseId}/members/{userId}:
 *   patch:
 *     summary: Change a member's role or ban status (admin only)
 *     tags: [Course]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [member, moderator, admin]
 *               status:
 *                 type: string
 *                 enum: [active, banned]
 *     responses:
 *       200:
 *         description: The updated membership
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 course:
 *                   type: string
 *                 user:
 *                   type: string
 *                 role:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/courses/:courseId/members/:userId', auth, isCourse, isCourseAdmin, async (req, res) => {
    const { body: updates, course, params } = req

    const modifiable = ['role', 'status']

    if (!updates) {
        throw new AppError('INVALID_UPDATES', { message: 'No updates sent' })
    }

    const isValid = Object.keys(updates).every((key) => {
        return modifiable.includes(key)
    })

    if (!isValid) {
        throw new AppError('INVALID_UPDATES')
    }

    const membership = await CourseMembership.findOneAndUpdate(
        { course: course._id, user: params.userId },
        updates,
        { runValidators: true, new: true })

    if (!membership) {
        throw new AppError('NOT_FOUND', { message: 'User specified is not a member of course' })
    }

    res.status(200).send(membership)
})

/**
 * Leave Course
 *
 * @openapi
 * /courses/{courseId}/members/me:
 *   delete:
 *     summary: Leave a course
 *     tags: [Course]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *     responses:
 *       204:
 *         description: Left the course (no body)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/courses/:courseId/members/me', auth, isCourse, isCourseMember, async (req, res) => {
    const { course, user } = req

    await CourseMembership.deleteOne({ course: course._id, user: user._id })
    res.status(204).send()
})

/**
 * Remove Member
 *
 * @openapi
 * /courses/{courseId}/members/{userId}:
 *   delete:
 *     summary: Remove a member from the course (admin only)
 *     tags: [Course]
 *     parameters:
 *       - $ref: '#/components/parameters/CourseId'
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       204:
 *         description: Member removed (no body)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/courses/:courseId/members/:userId', auth, isCourse, isCourseAdmin, async (req, res) => {
    const { course, params } = req

    const { deletedCount } = await CourseMembership.deleteOne({ course: course._id, user: params.userId })

    if (deletedCount === 0) {
        throw new AppError('NOT_FOUND', { message: 'User specified is not a member of course' })
    }

    res.status(204).send()
})

export default router