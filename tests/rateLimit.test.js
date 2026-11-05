import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import app from '../src/app.js'
import { signInLimiter, signUpLimiter } from '../src/middleware/rateLimit.js'
import { errorHandler } from '../src/middleware/errorHandler.js'

// A tiny app with its own limiter and a low limit, so these tests don't
// depend on the raised limits the rest of the suite uses (globalSetup).
// trust proxy 2 matches App Platform: DigitalOcean's router, then Cloudflare.
function appWith(limiter) {
    const testApp = express()
    testApp.set('trust proxy', 2)
    testApp.use(express.json())
    testApp.post('/limited', limiter, (req, res) => res.send({ ok: true }))
    testApp.use(errorHandler)
    return testApp
}

// What App Platform delivers: anything the client sent, then the visitor's
// real address (added by Cloudflare), then Cloudflare's (added by the router)
const forwardedFor = (visitor, clientSent = []) => [...clientSent, visitor, '104.23.209.206'].join(', ')

function signIn(testApp, { visitor, email, clientSent }) {
    return request(testApp)
        .post('/limited')
        .set('X-Forwarded-For', forwardedFor(visitor, clientSent))
        .send({ email, password: 'wrong-password' })
}

describe('signInLimiter', () => {
    it('answers 429 in the error envelope once one IP and email reach the limit', async () => {
        const testApp = appWith(signInLimiter({ limit: 2 }))
        const attempt = { visitor: '203.0.113.5', email: 'a@example.com' }

        expect((await signIn(testApp, attempt)).status).toBe(200)
        expect((await signIn(testApp, attempt)).status).toBe(200)
        const blocked = await signIn(testApp, attempt)

        expect(blocked.status).toBe(429)
        expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS')
    })

    it('counts each email separately on the same IP', async () => {
        const testApp = appWith(signInLimiter({ limit: 1 }))
        await signIn(testApp, { visitor: '203.0.113.5', email: 'a@example.com' })

        expect((await signIn(testApp, { visitor: '203.0.113.5', email: 'b@example.com' })).status).toBe(200)
    })

    it('treats emails that differ only in case or spaces as the same', async () => {
        const testApp = appWith(signInLimiter({ limit: 1 }))
        await signIn(testApp, { visitor: '203.0.113.5', email: 'a@example.com' })

        expect((await signIn(testApp, { visitor: '203.0.113.5', email: ' A@Example.com ' })).status).toBe(429)
    })

    it('does not lock a user out from another IP', async () => {
        const testApp = appWith(signInLimiter({ limit: 1 }))
        await signIn(testApp, { visitor: '198.51.100.7', email: 'victim@example.com' })

        expect((await signIn(testApp, { visitor: '203.0.113.5', email: 'victim@example.com' })).status).toBe(200)
    })

    it('ignores fake X-Forwarded-For entries the client adds', async () => {
        const testApp = appWith(signInLimiter({ limit: 1 }))
        await signIn(testApp, { visitor: '198.51.100.7', email: 'a@example.com', clientSent: ['1.1.1.1'] })

        const retry = await signIn(testApp, { visitor: '198.51.100.7', email: 'a@example.com', clientSent: ['2.2.2.2'] })
        expect(retry.status).toBe(429)
    })
})

describe('signUpLimiter', () => {
    it('answers 429 once one IP reaches the limit, whatever the body', async () => {
        const testApp = appWith(signUpLimiter({ limit: 1 }))
        await signIn(testApp, { visitor: '203.0.113.5', email: 'a@example.com' })

        expect((await signIn(testApp, { visitor: '203.0.113.5', email: 'b@example.com' })).status).toBe(429)
    })
})

describe('the user routes', () => {
    it('put the limiters in front of sign-up and sign-in', async () => {
        const signUp = await request(app).post('/users').send({})
        const signInRes = await request(app).post('/user/sign-in').send({})

        // The limiter adds this header to every response it lets through
        expect(signUp.headers['ratelimit-policy']).toBeDefined()
        expect(signInRes.headers['ratelimit-policy']).toBeDefined()
    })
})
