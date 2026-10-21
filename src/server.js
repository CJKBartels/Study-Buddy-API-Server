// Imported first: it applies the global schema settings before app.js loads
// the models
import { connectDatabase } from './db/mongoose.js'
import app from './app.js'

// Fail fast: with no database, every request would fail, so exit instead of
// listening. A non-zero exit shows up in the platform's logs, and its restart
// policy decides whether to try again.
try {
    await connectDatabase()
} catch (error) {
    console.error('Could not connect to MongoDB, exiting:', error.message)
    process.exit(1)
}

const port = process.env.PORT
app.listen(port, () => {
    console.log('Listening on port ' + port)
})
