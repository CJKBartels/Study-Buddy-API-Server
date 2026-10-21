import { connect, Schema } from 'mongoose'

// Global String settings. These must run before any model is defined, which
// is why server.js imports this file first. tests/setup.js repeats them.
console.log('Setting global SchemaType options.')
Schema.Types.String.set('validate', {
    validator: (value) => value == null || value.length > 0,
    message: 'String must be null or non-empty.'
})
Schema.Types.String.set('trim', true)

// Connects to MongoDB, or rejects if it can't. Importing this file no longer
// connects by itself: server.js calls this and waits, so the API never
// listens without a database.
export async function connectDatabase(url = process.env.MONGODB_URL) {
    console.log('Connecting to MongoDB')
    await connect(url)
    console.log('Connection to database successful.')
}
