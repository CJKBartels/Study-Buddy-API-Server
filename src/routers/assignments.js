import Router from 'express'
import auth from '../middleware/auth.js'
import Assignment from '../models/assignment.js'
import { isCourse, isCourseMember, isCourseModerator } from '../middleware/courseAccess.js'
import { isAssignment } from '../middleware/assignmentAccess.js'
import AssignmentUserState, { withUserState } from '../models/assignmentUserState.js'
import CourseMembership from '../models/courseMembership.js'
import AppError from '../assets/AppError.js'

const router = new Router()

/**
 * Create Assignment
 * 
 * @openapi
 * /courses/{courseId}/assignments:
 *   post:
 *     summary: Create Assignment
 *     description: The server sets createdBy, course, and source (community for members, moderator for moderators and admins), overriding any values sent.
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssignmentCreateRequest'
 *     responses:
 *       200:
 *         description: The created assignment
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Assignment'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.post('/courses/:courseId/assignments',
    auth, isCourse, isCourseMember,
    async (req, res) => {
        const { body: data, user, course, courseMembership } = req

        data.createdBy = user._id
        data.course = course._id
        data.source = courseMembership.role == 'member' ? 'community' : 'moderator'

        // A ValidationError from create() propagates to the central handler as a
        // 400 VALIDATION_ERROR with per-field details.
        const assignment = await Assignment.create(data)
        res.status(200).send(assignment)
    })

/**
 * Get Assignments
 * 
 * @openapi
 * /courses/{courseId}/assignments:
 *   get:
 *     summary: Get Assignments
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - in: query
 *        name: status
 *        schema:
 *          type: string
 *          enum:
 *           - active
 *           - archived
 *           - all
 *          default: active
 *        description: Filter between active and archived assignments
 *      - in: query
 *        name: source
 *        schema:
 *          type: string
 *          enum:
 *           - community
 *           - moderator
 *        description: Filter between community-made and moderator-made assignments
 *     responses:
 *       200:
 *         description: Array of Assignment Objects, without the course field
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      $ref: '#/components/schemas/Assignment'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId/assignments',
    auth, isCourse, isCourseMember,
    async (req, res) => {
        const { course, query } = req

        const filter = {
            course: course._id,
            status: 'active'
        }

        if (query?.source) {
            filter.source = query.source
        }

        if (query?.status) {
            filter.status = query.status
        }

        if (query?.status == 'all') {
            delete filter.status
        }

        const assignments = await Assignment.find(filter, { course: 0 })
        res.status(200).send(assignments)
    })

/**
 * Get Assignment from Id
 * 
 * @openapi
 * /courses/{courseId}/assignments/{assignmentId}:
 *   get:
 *     summary: Get Assignment from Id
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - $ref: '#/components/parameters/AssignmentId'
 *     responses:
 *       200:
 *         description: Assignment Object with createdBy and course populated
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/AssignmentDetail'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId/assignments/:assignmentId',
    auth, isCourse, isCourseMember, isAssignment,
    async (req, res) => {
        const { assignment } = req

        await assignment.populate('createdBy', 'username')
        await assignment.populate('course', 'title')

        res.status(200).send(assignment)
    })

/**
 * Update Assignment
 * 
 * @openapi
 * /courses/{courseId}/assignments/{assignmentId}:
 *   patch:
 *     summary:  Update Assignment
 *     description: Members may edit only assignments they created. An edit by a moderator or admin sets source to moderator.
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - $ref: '#/components/parameters/AssignmentId'
 *     requestBody:
 *      required: true
 *      content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/AssignmentPatchRequest'
 *                  
 *     responses:
 *       200:
 *         description: Assignment Object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Assignment'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.patch('/courses/:courseId/assignments/:assignmentId',
    auth, isCourse, isCourseMember, isAssignment,
    async (req, res) => {
        const { body: mods, courseMembership, user, assignment } = req

        if (Object.keys(mods).length === 0) {
            throw new AppError('INVALID_UPDATES', { message: 'Missing updates' })
        }

        const props = Object.keys(mods)
        const modifiable = ['title', 'description', 'dueAt']

        const isValid = props.every((prop) => modifiable.includes(prop))

        if (!isValid) {
            throw new AppError('INVALID_UPDATES')
        }

        if (!user._id.equals(assignment.createdBy) && courseMembership.role == 'member') {
            throw new AppError('FORBIDDEN', { message: 'Insufficient authorization to edit this assignment' })
        }

        if (courseMembership.role != 'member') {
            assignment.source = 'moderator'
        }

        props.forEach((prop) => assignment[prop] = mods[prop])

        // A ValidationError from save() propagates to the central handler as a
        // 400 VALIDATION_ERROR with per-field details.
        await assignment.save()
        res.status(200).send(assignment)
    })

/**
 * Moderator Stamp
 * 
 * @openapi
 * /courses/{courseId}/assignments/{assignmentId}/stamp:
 *   post:
 *     summary:  Verify assignment
 *     description: Moderators and admins only. Sets source to moderator.
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - $ref: '#/components/parameters/AssignmentId'
 *     responses:
 *       200:
 *         description: Assignment Object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/Assignment'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.post('/courses/:courseId/assignments/:assignmentId/stamp',
    auth, isCourse, isCourseModerator, isAssignment,
    async (req, res) => {
        const { assignment } = req

        assignment.source = 'moderator'
        await assignment.save()
        res.status(200).send(assignment)
    })

/**
* Archive Assignment
* 
* @openapi
* /courses/{courseId}/assignments/{assignmentId}:
*   delete:
*     summary:  Archive assignment
*     description: Members may archive only assignments they created.
*     tags: [Assignments]
*     parameters:
*      - $ref: '#/components/parameters/CourseId'
*      - $ref: '#/components/parameters/AssignmentId'
*     responses:
*       200:
*         description: Assignment Archived Successfully
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
router.delete('/courses/:courseId/assignments/:assignmentId',
    auth, isCourse, isCourseMember, isAssignment,
    async (req, res) => {
        const { courseMembership, assignment, user } = req

        if (!user._id.equals(assignment.createdBy) && courseMembership.role == 'member') {
            throw new AppError('FORBIDDEN', { message: 'Insufficient authorization to archive this assignment' })
        }

        if (assignment.status == 'archived') {
            throw new AppError('CONFLICT', { message: 'Assignment already archived' })
        }

        assignment.status = 'archived'
        await assignment.save()

        res.status(200).send('Assignment Archived Successfully')
    })

/**
 * Get Assignments with user states
 * 
 * @openapi
 * /courses/{courseId}/my/assignments:
 *   get:
 *     summary: Get Assignments
 *     tags: [Assignments]
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - in: query
 *        name: status
 *        schema:
 *          type: string
 *          enum:
 *           - active
 *           - archived
 *           - all
 *          default: active
 *        description: Filter between active and archived assignments
 *      - in: query
 *        name: source
 *        schema:
 *          type: string
 *          enum:
 *           - community
 *           - moderator
 *        description: Filter between community-made and moderator-made assignments
 *     responses:
 *       200:
 *         description: Array of Assignment Objects, each with this user's state attached
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      allOf:
 *                          - $ref: '#/components/schemas/AssignmentWithUserState'
 *                          - type: object
 *                            properties:
 *                                course:
 *                                    type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.get('/courses/:courseId/my/assignments',
    auth, isCourse, isCourseMember,
    async (req, res) => {
        const { course, user, query } = req

        const filter = {
            course: course._id,
            status: 'active'
        }

        if (query?.source) {
            filter.source = query.source
        }

        if (query?.status) {
            filter.status = query.status
        }

        if (query?.status == 'all') {
            delete filter.status
        }

        const assignments = await Assignment.find(filter, { __v: 0, updatedAt: 0 }).lean()

        // Only this user's states. A missing one means the defaults, so listing
        // never writes (see withUserState).
        const states = await AssignmentUserState.find({
            user: user._id,
            assignment: { $in: assignments.map((assignment) => assignment._id) }
        }).lean()

        res.status(200).send(withUserState(assignments, states))
    })

/**
 * Edit personal assignment metadata
 * 
 * @openapi
 * /courses/{courseId}/assignments/{assignmentId}/my-state:
 *   patch:
 *     summary: Edit personal assignment metadata
 *     tags: [Assignments]
 *     description: Creates the state with defaults on first use. With no body, returns the current state unchanged.
 *     parameters:
 *      - $ref: '#/components/parameters/CourseId'
 *      - $ref: '#/components/parameters/AssignmentId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *              type: object
 *              description: Any other field is rejected with INVALID_UPDATES.
 *              additionalProperties: false
 *              properties:
 *                  state:
 *                      type: string
 *                      enum:
 *                       - not_started
 *                       - in_progress
 *                       - complete
 *                  personalNotes:
 *                      type: string
 *                  personalDueAt:
 *                      type: string
 *                      format: date-time
 *                      nullable: true
 *                      description: null clears it, so the assignment's dueAt is shown again
 *                  completedAt:
 *                      type: string
 *                      format: date-time
 *     responses:
 *       200:
 *         description: This user's state for the assignment. personalDueAt falls back to the assignment's dueAt.
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/AssignmentUserState'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
*/
router.patch('/courses/:courseId/assignments/:assignmentId/my-state',
    auth, isCourse, isCourseMember, isAssignment,
    async (req, res) => {
        const { body: mods, course, user, assignment } = req

        const userState = await AssignmentUserState.findOrCreate(assignment._id, user._id, course._id)

        // Same rule as the lists: show the user's own due date, or the
        // official one if they never picked (or cleared theirs with null)
        const withEffectiveDueAt = (state) => ({
            ...state.toJSON(),
            personalDueAt: state.personalDueAt ?? assignment.dueAt
        })

        if (!mods) {
            return res.status(200).send(withEffectiveDueAt(userState))
        }

        const props = Object.keys(mods)
        const modifiable = ['state', 'personalNotes', 'personalDueAt', 'completedAt']

        const isValid = props.every((prop) => modifiable.includes(prop))

        if (!isValid) {
            throw new AppError('INVALID_UPDATES')
        }

        props.forEach((prop) => userState[prop] = mods[prop])

        // A ValidationError from save() propagates to the central handler as a
        // 400 VALIDATION_ERROR with per-field details.
        await userState.save()
        return res.status(200).send(withEffectiveDueAt(userState))
    })

/**
 * Get all assignments with user states
 * 
 * @openapi
 * /assignments:
 *   get:
 *     summary: Get all assignments with user states
 *     description: Assignments from every course where the user is an active member.
 *     tags: [Assignments]
 *     parameters:
 *      - in: query
 *        name: status
 *        schema:
 *          type: string
 *          enum:
 *           - active
 *           - archived
 *           - all
 *          default: active
 *        description: Filter between active and archived assignments
 *      - in: query
 *        name: source
 *        schema:
 *          type: string
 *          enum:
 *           - community
 *           - moderator
 *        description: Filter between community-made and moderator-made assignments
 *     responses:
 *       200:
 *         description: Array of Assignment Objects, each with its course (without joinCode) and this user's state
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      allOf:
 *                          - $ref: '#/components/schemas/AssignmentWithUserState'
 *                          - type: object
 *                            properties:
 *                                course:
 *                                    $ref: '#/components/schemas/Course'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
*/
router.get('/assignments', auth, async (req, res) => {
    const { user, query } = req

    let courses = await CourseMembership.find({ user: user._id, status: 'active' }, { course: 1 })
    courses = courses.map(course => course.course)

    const filter = {
        status: 'active',
        course: { $in: courses }
    }

    if (query?.source) {
        filter.source = query.source
    }

    if (query?.status) {
        filter.status = query.status
    }

    if (query?.status == 'all') {
        delete filter.status
    }

    // The course is shown with each assignment, but never its join code,
    // which only admins may see
    const assignments = await Assignment.find(filter, { __v: 0, updatedAt: 0 })
        .populate('course', '-joinCode -__v')
        .lean()

    // Only this user's states. A missing one means the defaults, so listing
    // never writes (see withUserState).
    const states = await AssignmentUserState.find({
        user: user._id,
        assignment: { $in: assignments.map((assignment) => assignment._id) }
    }).lean()

    res.status(200).send(withUserState(assignments, states))
}
)
export default router