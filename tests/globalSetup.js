import { MongoMemoryServer } from 'mongodb-memory-server'

let mongod

export async function setup() {
    mongod = await MongoMemoryServer.create()
    process.env.MONGODB_URL = mongod.getUri()
    process.env.JSON_WEB_TOKEN_SECRET = 'test-secret'
    // Tests sign up and sign in far more often than any real client, all
    // from one address. tests/rateLimit.test.js checks the real limits.
    process.env.SIGN_IN_LIMIT = '100000'
    process.env.SIGN_UP_LIMIT = '100000'
}

export async function teardown() {
    await mongod.stop()
}
