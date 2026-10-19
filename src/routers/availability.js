import Router from 'express'
import auth from '../middleware/auth.js'
import Availability from '../models/availability.js'
import AppError from '../assets/AppError.js'

const router = new Router()

//Get Availability
router.get('/availability/me', auth, async (req, res) => {
    const { user } = req

    const availability = await Availability.findOne({ user: user._id })

    if (!availability) {
        throw new AppError('AVAILABILITY_NOT_FOUND')
    }

    res.status(200).send(availability)
})

//Replace Availability
router.put('/availability/me', auth, async (req, res) => {
    const { user, body } = req
    const { timezone, blocks } = body

    const availability = await Availability.updateOne(
        { user: user._id },
        { $set: { timezone, blocks } },
        { upsert: true }
    )

    res.status(201).send(availability)
})

export default router
