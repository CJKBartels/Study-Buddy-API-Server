import express from 'express'
import mongoose from 'mongoose'
import AppError from '../assets/AppError.js'

const router = express.Router()

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check that the API is up and connected to MongoDB
 *     description: For uptime monitors and the platform's readiness check. Needs no token. Reads the driver's connection state, so it doesn't query the database.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Up and connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 database: { type: string, example: connected }
 *       503:
 *         description: "Up, but not connected to MongoDB. Code: DATABASE_UNAVAILABLE, with the connection state in `details.database`."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/health', (req, res) => {
    // readyState is a number; STATES maps it to a name like "connected"
    const database = mongoose.STATES[mongoose.connection.readyState]
    if (database !== 'connected') {
        throw new AppError('DATABASE_UNAVAILABLE', { details: { database } })
    }
    res.send({ status: 'ok', database })
})

export default router
