import Router from 'express'
import User from '../models/user.js'
import auth from '../middleware/auth.js'
import AppError from '../assets/AppError.js'

const router = new Router()

/**
 * Create User
 * 
 * @openapi
 * /users:
 *   post:
 *     summary: Create User
 *     tags: [User]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             $ref: '#/components/schemas/UserCreateRequest'
 *     responses:
 *       201:
 *         description: User Object
 *         content:
 *          application/json:
 *              schema:
 *                  type: object
 *                  properties:
 *                      user:
 *                          $ref: '#/components/schemas/UserPrivate'
 *                      token: 
 *                          type: string
 *                          
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
*/
router.post('/users', async (req, res) => {
    const { body: data } = req

    data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const user = new User(data)

    // A Mongoose ValidationError or an E11000 duplicate-key error here propagates
    // to the central error handler, which maps them to VALIDATION_ERROR (with
    // field details) and DUPLICATE_ACCOUNT respectively.

    await user.save()
    const token = await user.generateAuthToken()

    res.status(201).send({ user, token })
})

/**
 * Get User
 * 
 * @openapi
 * /users/me:
 *   get:
 *     summary: Get current user
 *     tags: [User]
 *     responses:
 *       200:
 *         description: User object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/UserPrivate'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *                  
*/
router.get('/users/me', auth, async (req, res) => {
    const user = req.user
    res.status(200).send(user)
})

/**
 * Get Users
 * 
 * @openapi
 * /users:
 *   get:
 *     summary: Get users
 *     tags: [User]
 *     parameters:
 *      - in: query
 *        name: offset
 *        schema:
 *          type: integer
 *        description: The number of users to skip before starting to collect the result
 *          
 *     responses:
 *       200:
 *         description: User objects
 *         content:
 *          application/json:
 *              schema:
 *                  type: array
 *                  items:
 *                      $ref: '#/components/schemas/UserPublic'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *                  
*/
router.get('/users', auth, async (req, res) => {
    const { query } = req

    const filter = {}

    if (query.q) {
        filter.username = { $regex: query.q, $options: 'i' }
    }

    const users = await User.find(filter, await User.publicUserProjection())
        .skip(parseInt(query.offset))
        .limit(parseInt(query.limit))

    res.status(200).send(users)
})

/**
 * Get User by Id
 * 
 * @openapi
 * /user/{userId}:
 *   get:
 *     summary: Get 'User By Id'
 *     tags: [User]
 *     parameters:
 *      - in: path
 *        name: userId
 *        schema:
 *          type: string
 *        description: Id of User you want details of
 *        required: true
 *     responses:
 *       200:
 *         description: User object
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/UserPublic'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *                  
*/
router.get('/user/:userId', auth, async (req, res) => {
    const user = await User.findById(
        { _id: req.params.userId },
        await User.publicUserProjection()
    )

    // A malformed ObjectId throws a Mongoose CastError, which the central
    // handler maps to 400 BAD_REQUEST.
    if (!user) {
        throw new AppError('USER_NOT_FOUND')
    }

    res.status(200).send({ user })
})

/**
 * Sign In
 * 
 * @openapi
 * /user/sign-in:
 *   post:
 *     summary: Sign In and receive JWT
 *     tags: [User]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: demo@studybuddy.com
 *               password:
 *                 type: string
 *                 example: DemoPassword123!
 *     responses:
 *       200:
 *         description: Successful login
 *         content:
 *          application/json:
 *              schema:
 *                  type: object
 *                  properties:
 *                      user:
 *                          $ref: '#/components/schemas/UserPrivate'
 *                      token:
 *                          type: string
 *       400:
 *          $ref: '#/components/responses/BadRequest'
 */
router.post('/user/sign-in', async (req, res) => {
    const user = await User.findByCredentials(req.body.email, req.body.password)

    // Same error for a wrong email or a wrong password, so callers can't
    // probe which emails have accounts
    if (!user) {
        throw new AppError('INVALID_CREDENTIALS')
    }

    const token = await user.generateAuthToken()
    res.status(200).send({ user, token })
})


/**
 * Sign Out
 * 
 * @openapi
 * /user/sign-out:
 *   post:
 *     summary: Sign Out and delete JWT
 *     tags: [User]
 *  
 *     responses:
 *       200:
 *         description: Signed Out Successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
*/
router.post('/user/sign-out', auth, async (req, res) => {
    // $pull removes just this token without reading the list first, so
    // simultaneous sign-outs (or a sign-in) can't overwrite each other
    await User.updateOne({ _id: req.user._id }, { $pull: { tokens: { token: req.token } } })

    res.status(200).send('Signed Out Successfully')
})

/**
 * Update User
 * 
 * @openapi
 * /users/me:
 *   patch:
 *     summary: Update User
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: demo2
 *               timezone:
 *                 type: string
 *                 example: Pacific/Tahiti
 *               email:
 *                 type: string
 *                 example: demo@studybuddy.com
 *               password:
 *                 type: string
 *                 example: DemoPassword123!
 *     responses:
 *       200:
 *         description: Successful login
 *         content:
 *          application/json:
 *              schema:
 *                  $ref: '#/components/schemas/UserPrivate'
 *       400:
 *          $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.patch('/users/me', auth, async (req, res) => {
    const mods = req.body
    const props = Object.keys(mods)

    if (props.length === 0) {
        throw new AppError('INVALID_UPDATES', { message: 'No updates provided' })
    }

    const modifiable = ['username', 'password', 'email', 'timezone']
    const isValid = props.every((prop) => modifiable.includes(prop))

    if (!isValid) {
        throw new AppError('INVALID_UPDATES')
    }

    // A ValidationError from save() propagates to the central handler as a
    // 400 VALIDATION_ERROR with per-field details.
    const user = req.user
    props.forEach((prop) => user[prop] = mods[prop])
    await user.save()

    res.status(200).send(user)
})


/**
 * Delete Account
 * 
 * @openapi
 * /users/me:
 *   delete:
 *     summary: Delete Account
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Account Deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.delete('/users/me', auth, async (req, res) => {
    await req.user.deleteOne()

    res.status(200).send('Account Deleted')
})



export default router
