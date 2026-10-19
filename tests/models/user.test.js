import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import User from '../../src/models/user.js'

const baseUserData = () => ({
    username: 'testuser',
    password: 'password123',
    email: 'test@example.com',
    timezone: 'America/New_York'
})

const saveUser = async (overrides = {}) => {
    const user = new User({ ...baseUserData(), ...overrides })
    await user.save()
    return user
}

describe('User model', () => {
    describe('schema validation', () => {
        it('saves a valid user', async () => {
            const user = await saveUser()
            expect(user._id).toBeDefined()
        })

        it('requires username', async () => {
            await expect(saveUser({ username: undefined })).rejects.toThrow()
        })

        it('requires password', async () => {
            await expect(saveUser({ password: undefined })).rejects.toThrow()
        })

        it('requires email', async () => {
            await expect(saveUser({ email: undefined })).rejects.toThrow()
        })

        it('requires timezone', async () => {
            await expect(saveUser({ timezone: undefined })).rejects.toThrow()
        })

        it('rejects a password shorter than 8 characters', async () => {
            await expect(saveUser({ password: 'short1' })).rejects.toThrow()
        })

        it('rejects an invalid email address', async () => {
            await expect(saveUser({ email: 'not-an-email' })).rejects.toThrow()
        })

        it('rejects an invalid timezone', async () => {
            await expect(saveUser({ timezone: 'Mars/Olympus' })).rejects.toThrow()
        })

        it('accepts a valid IANA timezone', async () => {
            const user = await saveUser({ timezone: 'Europe/London' })
            expect(user.timezone).toBe('Europe/London')
        })

        it('trims whitespace from username', async () => {
            const user = await saveUser({ username: '  trimmed  ' })
            expect(user.username).toBe('trimmed')
        })

        it('lowercases username', async () => {
            const user = await saveUser({ username: 'TestUser' })
            expect(user.username).toBe('testuser')
        })

        it('rejects a duplicate email', async () => {
            await saveUser()
            await expect(
                saveUser({ username: 'otherusername' })
            ).rejects.toThrow()
        })

        it('rejects a duplicate username', async () => {
            await saveUser()
            await expect(
                saveUser({ email: 'other@example.com' })
            ).rejects.toThrow()
        })
    })

    describe('toJSON', () => {
        it('omits password from serialised output', async () => {
            const user = await saveUser()
            expect(user.toJSON().password).toBeUndefined()
        })

        it('omits tokens from serialised output', async () => {
            const user = await saveUser()
            await user.generateAuthToken()
            expect(user.toJSON().tokens).toBeUndefined()
        })

        it('includes username, email, and timezone', async () => {
            const user = await saveUser()
            const json = user.toJSON()
            expect(json.username).toBe('testuser')
            expect(json.email).toBe('test@example.com')
            expect(json.timezone).toBe('America/New_York')
        })

        it('includes _id and createdAt timestamps', async () => {
            const user = await saveUser()
            const json = user.toJSON()
            expect(json._id).toBeDefined()
            expect(json.createdAt).toBeDefined()
        })
    })

    describe('generateAuthToken', () => {
        it('returns a JWT string', async () => {
            const user = await saveUser()
            const token = await user.generateAuthToken()
            expect(typeof token).toBe('string')
            expect(token.split('.')).toHaveLength(3)
        })

        it('signs the JWT with the correct secret and embeds user _id', async () => {
            const user = await saveUser()
            const token = await user.generateAuthToken()
            const decoded = jwt.verify(token, process.env.JSON_WEB_TOKEN_SECRET)
            expect(decoded._id).toBe(user._id.toString())
        })

        it('persists the token to the database', async () => {
            const user = await saveUser()
            const token = await user.generateAuthToken()
            const persisted = await User.findById(user._id)
            expect(persisted.tokens.some(t => t.token === token)).toBe(true)
        })

        it('accumulates multiple tokens across successive calls', async () => {
            const user = await saveUser()
            await user.generateAuthToken()
            await user.generateAuthToken()
            const persisted = await User.findById(user._id)
            expect(persisted.tokens).toHaveLength(2)
        })

        it('issues a different token on every call, even within the same second', async () => {
            const user = await saveUser()
            const [first, second] = await Promise.all([user.generateAuthToken(), user.generateAuthToken()])
            expect(first).not.toBe(second)
        })
    })

    describe('findByCredentials', () => {
        it('returns the user when credentials are valid', async () => {
            await saveUser({ email: 'login@example.com', password: 'goodpass99' })
            const user = await User.findByCredentials('login@example.com', 'goodpass99')
            expect(user).toBeDefined()
            expect(user.email).toBe('login@example.com')
        })

        it('returns null when the email is not registered', async () => {
            expect(await User.findByCredentials('nobody@example.com', 'anypassword')).toBeNull()
        })

        it('returns null when the password is wrong', async () => {
            await saveUser({ email: 'login@example.com', password: 'goodpass99' })
            expect(await User.findByCredentials('login@example.com', 'wrongpassword')).toBeNull()
        })
    })

    describe('publicUserProjection', () => {
        it('returns exactly the public fields projection', async () => {
            const projection = await User.publicUserProjection()
            expect(projection).toEqual({
                _id: 1,
                username: 1,
                createdAt: 1,
                timezone: 1
            })
        })

        it('excludes sensitive fields from the projection', async () => {
            const projection = await User.publicUserProjection()
            expect(projection.password).toBeUndefined()
            expect(projection.tokens).toBeUndefined()
            expect(projection.email).toBeUndefined()
        })
    })

    describe('pre-save password hashing hook', () => {
        it('does not store the plain-text password', async () => {
            const user = await saveUser({ password: 'plaintext1' })
            expect(user.password).not.toBe('plaintext1')
        })

        it('stores a bcrypt hash on create', async () => {
            const user = await saveUser({ password: 'plaintext1' })
            expect(user.password).toMatch(/^\$2b\$/)
        })

        it('re-hashes when the password field is changed', async () => {
            const user = await saveUser()
            const firstHash = user.password
            user.password = 'updatedpass99'
            await user.save()
            expect(user.password).not.toBe('updatedpass99')
            expect(user.password).not.toBe(firstHash)
            expect(user.password).toMatch(/^\$2b\$/)
        })

        it('does not re-hash when an unrelated field is changed', async () => {
            const user = await saveUser()
            const originalHash = user.password
            user.timezone = 'America/Chicago'
            await user.save()
            const refreshed = await User.findById(user._id)
            expect(refreshed.password).toBe(originalHash)
        })
    })
})
