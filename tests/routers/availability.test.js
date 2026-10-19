import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

let userCounter = 0

// Returns { token, user } for a freshly created, signed-in user.
async function createAndSignIn() {
    userCounter += 1
    const data = {
        username: `availuser${userCounter}`,
        email: `avail${userCounter}@example.com`,
        password: 'Password1!'
    }
    await request(app).post('/users').send(data)
    const res = await request(app).post('/user/sign-in').send({ email: data.email, password: data.password })
    return res.body
}

const baseAvailability = () => ({
    timezone: 'America/New_York',
    blocks: [{ day: 1, startMin: 540, endMin: 660 }]  // Monday 9:00-11:00
})

function getAvailability(token) {
    return request(app).get('/availability/me').set('Authorization', `Bearer ${token}`)
}

function putAvailability(token, body) {
    return request(app).put('/availability/me').set('Authorization', `Bearer ${token}`).send(body)
}

describe('GET /availability/me', () => {
    it('returns 404 AVAILABILITY_NOT_FOUND before any availability is set', async () => {
        const { token } = await createAndSignIn()
        const res = await getAvailability(token)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('AVAILABILITY_NOT_FOUND')
    })

    it('returns the availability after it is set', async () => {
        const { token } = await createAndSignIn()
        await putAvailability(token, baseAvailability())
        const res = await getAvailability(token)
        expect(res.status).toBe(200)
        expect(res.body.timezone).toBe('America/New_York')
        expect(res.body.blocks).toMatchObject(baseAvailability().blocks)
    })

    it('returns only the signed-in user\'s availability', async () => {
        const alice = await createAndSignIn()
        const bob = await createAndSignIn()
        await putAvailability(alice.token, baseAvailability())
        const res = await getAvailability(bob.token)
        expect(res.status).toBe(404)
    })

    it('returns 401 UNAUTHORIZED without a token', async () => {
        const res = await request(app).get('/availability/me')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('PUT /availability/me', () => {
    it('replaces earlier availability instead of adding to it', async () => {
        const { token } = await createAndSignIn()
        await putAvailability(token, baseAvailability())
        await putAvailability(token, { timezone: 'Europe/London', blocks: [{ day: 3, startMin: 600, endMin: 720 }] })
        const res = await getAvailability(token)
        expect(res.body.timezone).toBe('Europe/London')
        expect(res.body.blocks).toHaveLength(1)
        expect(res.body.blocks[0].day).toBe(3)
    })

    it('returns 200 with the saved availability', async () => {
        const { token, user } = await createAndSignIn()
        const res = await putAvailability(token, baseAvailability())
        expect(res.status).toBe(200)
        expect(res.body.user).toBe(user._id)
        expect(res.body.timezone).toBe('America/New_York')
        expect(res.body.blocks).toMatchObject(baseAvailability().blocks)
    })

    it.each([
        ['a day outside 0-6', { blocks: [{ day: 9, startMin: 540, endMin: 660 }] }, 'blocks.0.day'],
        ['a start before midnight', { blocks: [{ day: 1, startMin: -5, endMin: 660 }] }, 'blocks.0.startMin'],
        ['an end past midnight', { blocks: [{ day: 1, startMin: 540, endMin: 1500 }] }, 'blocks.0.endMin'],
        ['a block that ends before it starts', { blocks: [{ day: 1, startMin: 900, endMin: 60 }] }, 'blocks.0.endMin'],
        ['a zero-length block', { blocks: [{ day: 1, startMin: 540, endMin: 540 }] }, 'blocks.0.endMin'],
        ['an unknown timezone', { timezone: 'Mars/Olympus' }, 'timezone'],
        ['a missing timezone', { timezone: undefined }, 'timezone']
    ])('returns 400 VALIDATION_ERROR for %s, and saves nothing', async (_, overrides, field) => {
        const { token } = await createAndSignIn()
        const res = await putAvailability(token, { ...baseAvailability(), ...overrides })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.details[field]).toBeDefined()

        const saved = await getAvailability(token)
        expect(saved.status).toBe(404)
    })

    it('keeps the previous availability when a replacement is invalid', async () => {
        const { token } = await createAndSignIn()
        await putAvailability(token, baseAvailability())
        await putAvailability(token, { ...baseAvailability(), timezone: 'Mars/Olympus' })
        const res = await getAvailability(token)
        expect(res.body.timezone).toBe('America/New_York')
    })

    it('returns 401 UNAUTHORIZED without a token', async () => {
        const res = await request(app).put('/availability/me').send(baseAvailability())
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})
