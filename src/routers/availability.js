import Router from 'express'
import auth from '../middleware/auth.js'
import Availability, { mergeBlocks } from '../models/availability.js'
import AppError from '../assets/AppError.js'

const router = new Router()

/**
 * Get Availability
 *
 * @openapi
 * /availability/me:
 *   get:
 *     summary: Get your weekly availability
 *     tags: [Availability]
 *     responses:
 *       200:
 *         description: Your availability
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Availability'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/availability/me', auth, async (req, res) => {
    const { user } = req

    const availability = await Availability.findOne({ user: user._id })

    if (!availability) {
        throw new AppError('AVAILABILITY_NOT_FOUND')
    }

    res.status(200).send(availability)
})

/**
 * Replace Availability
 *
 * @openapi
 * /availability/me:
 *   put:
 *     summary: Replace your weekly availability
 *     description: Replaces all blocks. Blocks that overlap or touch on the same day are merged, and the result is sorted by day, then start time.
 *     tags: [Availability]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AvailabilityPutRequest'
 *     responses:
 *       200:
 *         description: The saved availability, with blocks merged
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Availability'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.put('/availability/me', auth, async (req, res) => {
    const { user, body } = req
    const { timezone, blocks } = body

    // Updates skip most schema rules (and can't run rules that compare two
    // fields), so validate the full document as a draft first. It's never
    // saved: the write below stays one atomic upsert, the only code path that
    // writes Availability (user is unique).
    const draft = new Availability({ user: user._id, timezone, blocks })
    await draft.validate()

    const availability = await Availability.findOneAndUpdate(
        { user: user._id },
        // Merge after validating, so invalid blocks are rejected, not merged
        { timezone: draft.timezone, blocks: mergeBlocks(draft.blocks) },
        { upsert: true, new: true }
    )

    res.status(200).send(availability)
})

export default router
