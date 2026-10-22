// npm run seed: resets the demo data in the database at MONGODB_URL.
// Locally, `npm run seed` reads .env. In a container, run
// `node src/scripts/seed.js` from the platform's console.
import { disconnect } from 'mongoose'
// Before seedDemo.js: it applies the global schema settings before the
// models load
import { connectDatabase } from '../db/mongoose.js'
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from '../db/seedDemo.js'

try {
    await connectDatabase()
    await seedDemo()
    console.log(`Demo data reset. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
} catch (error) {
    console.error('Seeding failed:', error.message)
    process.exitCode = 1
} finally {
    await disconnect()
}
