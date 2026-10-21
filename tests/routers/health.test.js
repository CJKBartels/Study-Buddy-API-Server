import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../../src/app.js'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('GET /health', () => {
    it('returns 200 without a token when the database is connected', async () => {
        const res = await request(app).get('/health')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'ok', database: 'connected' })
    })

    it('returns 503 with the connection state when the database is not connected', async () => {
        // Pretend the driver lost the connection, without really closing the
        // shared test connection. 0 is "disconnected" in mongoose.STATES.
        vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0)
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const res = await request(app).get('/health')
        expect(res.status).toBe(503)
        expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE')
        expect(res.body.error.details).toEqual({ database: 'disconnected' })
    })
})
