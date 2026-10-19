import { describe, it, expect } from 'vitest'
import request from 'supertest'
import User from '../../src/models/user.js'
import app from '../../src/app.js'

const baseUser = () => ({
    username: 'testuser',
    email: 'test@example.com',
    password: 'Password1!'
})

async function createUser(overrides = {}) {
    const res = await request(app)
        .post('/users')
        .send({ ...baseUser(), ...overrides })
    return res.body
}

async function signIn(email, password) {
    const res = await request(app)
        .post('/user/sign-in')
        .send({ email, password })
    return res.body
}

async function createAndSignIn(overrides = {}) {
    const data = { ...baseUser(), ...overrides }
    await createUser(overrides)
    return signIn(data.email, data.password)
}

describe('POST /users', () => {
    it('returns 201 with user and token on valid body', async () => {
        const res = await request(app).post('/users').send(baseUser())
        expect(res.status).toBe(201)
        expect(res.body.user).toBeDefined()
        expect(res.body.token).toBeDefined()
        expect(res.body.user.email).toBe(baseUser().email)
        expect(res.body.user.username).toBe(baseUser().username)
    })

    it('omits password from the response body', async () => {
        const res = await request(app).post('/users').send(baseUser())
        expect(res.body.user.password).toBeUndefined()
    })

    it('omits tokens from the response body', async () => {
        const res = await request(app).post('/users').send(baseUser())
        expect(res.body.user.tokens).toBeUndefined()
    })

    it('returns 400 VALIDATION_ERROR when username is missing', async () => {
        const res = await request(app)
            .post('/users')
            .send({ email: 'a@example.com', password: 'Password1!' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when email is missing', async () => {
        const res = await request(app)
            .post('/users')
            .send({ username: 'user', password: 'Password1!' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when password is missing', async () => {
        const res = await request(app)
            .post('/users')
            .send({ username: 'user', email: 'a@example.com' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR for an invalid email format', async () => {
        const res = await request(app)
            .post('/users')
            .send({ ...baseUser(), email: 'not-an-email' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR for a password shorter than 8 characters', async () => {
        const res = await request(app)
            .post('/users')
            .send({ ...baseUser(), password: 'short1' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 409 DUPLICATE_ACCOUNT on duplicate email', async () => {
        await createUser()
        const res = await request(app)
            .post('/users')
            .send({ ...baseUser(), username: 'differentuser' })
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('DUPLICATE_ACCOUNT')
    })

    it('error response matches { error: { code, message } } envelope', async () => {
        const res = await request(app).post('/users').send({})
        expect(res.body.error).toBeDefined()
        expect(typeof res.body.error.code).toBe('string')
        expect(typeof res.body.error.message).toBe('string')
    })
})

describe('GET /users/me', () => {
    it('returns 200 with the authenticated user', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/users/me')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(res.body.email).toBe(baseUser().email)
        expect(res.body.username).toBe(baseUser().username)
    })

    it('omits password and tokens from response', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/users/me')
            .set('Authorization', `Bearer ${token}`)
        expect(res.body.password).toBeUndefined()
        expect(res.body.tokens).toBeUndefined()
    })

    it('returns 401 UNAUTHORIZED when no token is provided', async () => {
        const res = await request(app).get('/users/me')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 UNAUTHORIZED when token is invalid', async () => {
        const res = await request(app)
            .get('/users/me')
            .set('Authorization', 'Bearer invalidtoken')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 UNAUTHORIZED when token has been revoked via sign-out', async () => {
        const { token } = await createAndSignIn()
        await request(app)
            .post('/user/sign-out')
            .set('Authorization', `Bearer ${token}`)
        const res = await request(app)
            .get('/users/me')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})

describe('GET /users', () => {
    it('returns 200 with an array of users when authenticated', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/users?offset=0&limit=10')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).get('/users')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('filters results by username with ?q= (case-insensitive)', async () => {
        const { token } = await createAndSignIn()
        await createUser({ username: 'alice', email: 'alice@example.com' })
        await createUser({ username: 'bob', email: 'bob@example.com' })

        const res = await request(app)
            .get('/users?q=ALI&offset=0&limit=10')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        const usernames = res.body.map((u) => u.username)
        expect(usernames).toContain('alice')
        expect(usernames).not.toContain('bob')
    })

    it('?limit restricts the number of results returned', async () => {
        const { token } = await createAndSignIn()
        await createUser({ username: 'extra1', email: 'extra1@example.com' })
        await createUser({ username: 'extra2', email: 'extra2@example.com' })

        const res = await request(app)
            .get('/users?offset=0&limit=1')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(res.body.length).toBeLessThanOrEqual(1)
    })

    it('?offset skips the specified number of results', async () => {
        const { token } = await createAndSignIn()
        await createUser({ username: 'extra1', email: 'extra1@example.com' })
        await createUser({ username: 'extra2', email: 'extra2@example.com' })

        const allRes = await request(app)
            .get('/users?offset=0&limit=10')
            .set('Authorization', `Bearer ${token}`)
        const offsetRes = await request(app)
            .get('/users?offset=1&limit=10')
            .set('Authorization', `Bearer ${token}`)
        expect(offsetRes.body.length).toBe(allRes.body.length - 1)
    })

    it('results do not contain password or tokens fields', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/users?offset=0&limit=10')
            .set('Authorization', `Bearer ${token}`)
        for (const user of res.body) {
            expect(user.password).toBeUndefined()
            expect(user.tokens).toBeUndefined()
        }
    })
})

describe('GET /user/:userId', () => {
    it('returns 200 with { user } for a valid user id', async () => {
        const { user, token } = await createAndSignIn()
        const res = await request(app)
            .get(`/user/${user._id}`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        expect(res.body.user).toBeDefined()
        expect(res.body.user._id).toBe(user._id)
    })

    it('does not include password or tokens in the response', async () => {
        const { user, token } = await createAndSignIn()
        const res = await request(app)
            .get(`/user/${user._id}`)
            .set('Authorization', `Bearer ${token}`)
        expect(res.body.user.password).toBeUndefined()
        expect(res.body.user.tokens).toBeUndefined()
    })

    it('returns 404 USER_NOT_FOUND for a valid ObjectId with no matching user', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/user/000000000000000000000001')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('USER_NOT_FOUND')
    })

    it('returns 400 BAD_REQUEST for a malformed ObjectId', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/user/not-an-id')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('BAD_REQUEST')
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const { user } = await createAndSignIn()
        const res = await request(app).get(`/user/${user._id}`)
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('error response matches { error: { code, message } } envelope', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .get('/user/not-an-id')
            .set('Authorization', `Bearer ${token}`)
        expect(res.body.error).toBeDefined()
        expect(typeof res.body.error.code).toBe('string')
        expect(typeof res.body.error.message).toBe('string')
    })
})

describe('POST /user/sign-in', () => {
    it('returns 200 with { user, token } on valid credentials', async () => {
        await createUser()
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: baseUser().email, password: baseUser().password })
        expect(res.status).toBe(200)
        expect(res.body.user).toBeDefined()
        expect(res.body.token).toBeDefined()
        expect(res.body.user.email).toBe(baseUser().email)
    })

    it('omits password from the response body', async () => {
        await createUser()
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: baseUser().email, password: baseUser().password })
        expect(res.body.user.password).toBeUndefined()
    })

    it('omits tokens from the response body', async () => {
        await createUser()
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: baseUser().email, password: baseUser().password })
        expect(res.body.user.tokens).toBeUndefined()
    })

    it('returns 400 INVALID_CREDENTIALS on wrong password', async () => {
        await createUser()
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: baseUser().email, password: 'WrongPassword1!' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('returns 400 INVALID_CREDENTIALS on unknown email', async () => {
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: 'nobody@example.com', password: 'Password1!' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('error response matches { error: { code, message } } envelope', async () => {
        const res = await request(app)
            .post('/user/sign-in')
            .send({ email: 'nobody@example.com', password: 'Password1!' })
        expect(res.body.error).toBeDefined()
        expect(typeof res.body.error.code).toBe('string')
        expect(typeof res.body.error.message).toBe('string')
    })

    it('keeps every token when two devices sign in at the same moment', async () => {
        const created = await createUser()
        const [phone, laptop] = await Promise.all([
            signIn(baseUser().email, baseUser().password),
            signIn(baseUser().email, baseUser().password)
        ])
        expect(phone.token).not.toBe(laptop.token)

        const persisted = await User.findById(created.user._id)
        const stored = persisted.tokens.map((t) => t.token)
        expect(stored).toContain(phone.token)
        expect(stored).toContain(laptop.token)
    })
})

describe('POST /user/sign-out', () => {
    it('returns 200 and removes the token from the database', async () => {
        const { token, user } = await createAndSignIn()
        const res = await request(app)
            .post('/user/sign-out')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        const persisted = await User.findById(user._id)
        expect(persisted.tokens.some((t) => t.token === token)).toBe(false)
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).post('/user/sign-out')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('removes both tokens when two devices sign out at the same moment', async () => {
        const created = await createUser()
        const phone = await signIn(baseUser().email, baseUser().password)
        const laptop = await signIn(baseUser().email, baseUser().password)

        await Promise.all([phone, laptop].map(({ token }) =>
            request(app).post('/user/sign-out').set('Authorization', `Bearer ${token}`)))

        const persisted = await User.findById(created.user._id)
        const stored = persisted.tokens.map((t) => t.token)
        expect(stored).not.toContain(phone.token)
        expect(stored).not.toContain(laptop.token)
    })
})

describe('PATCH /users/me', () => {
    it('returns 200 and applies a valid username update', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ username: 'newusername' })
        expect(res.status).toBe(200)
        expect(res.body.username).toBe('newusername')
    })

    it('returns 200 and applies a valid email update', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'updated@example.com' })
        expect(res.status).toBe(200)
        expect(res.body.email).toBe('updated@example.com')
    })

    it('returns 200 and applies a valid timezone update', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ timezone: 'Europe/London' })
        expect(res.status).toBe(200)
        expect(res.body.timezone).toBe('Europe/London')
    })

    it('omits password and tokens from the response body', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ username: 'patcheduser' })
        expect(res.body.password).toBeUndefined()
        expect(res.body.tokens).toBeUndefined()
    })

    it('returns 400 INVALID_UPDATES when body is empty', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({})
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 INVALID_UPDATES for a non-modifiable field', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ _id: '000000000000000000000001' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('INVALID_UPDATES')
    })

    it('returns 400 VALIDATION_ERROR for an invalid email format', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'not-an-email' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR for an invalid timezone', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ timezone: 'Mars/Olympus' })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('stores a new bcrypt hash after a password update', async () => {
        const { token, user } = await createAndSignIn()
        const before = await User.findById(user._id)
        const hashBefore = before.password

        await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'NewPassword99!' })

        const after = await User.findById(user._id)
        expect(after.password).not.toBe(hashBefore)
        expect(after.password).not.toBe('NewPassword99!')
        expect(after.password).toMatch(/^\$2b\$/)
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app)
            .patch('/users/me')
            .send({ username: 'newusername' })
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('error response matches { error: { code, message } } envelope', async () => {
        const { token } = await createAndSignIn()
        const res = await request(app)
            .patch('/users/me')
            .set('Authorization', `Bearer ${token}`)
            .send({})
        expect(res.body.error).toBeDefined()
        expect(typeof res.body.error.code).toBe('string')
        expect(typeof res.body.error.message).toBe('string')
    })
})

describe('DELETE /users/me', () => {
    it('returns 200 and removes the user from the database', async () => {
        const { token, user } = await createAndSignIn()
        const res = await request(app)
            .delete('/users/me')
            .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
        const deleted = await User.findById(user._id)
        expect(deleted).toBeNull()
    })

    it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
        const res = await request(app).delete('/users/me')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
})
