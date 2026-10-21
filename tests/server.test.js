import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'

// Starts the real entry point (node src/server.js) as its own process and
// resolves when it either prints "Listening" or exits.
function startServer(env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['src/server.js'], {
            env: { ...process.env, PORT: '0', JSON_WEB_TOKEN_SECRET: 'test-secret', ...env }
        })
        let output = ''
        const collect = (chunk) => {
            output += chunk
            if (output.includes('Listening')) {
                child.kill()
                resolve({ listened: true, output })
            }
        }
        child.stdout.on('data', collect)
        child.stderr.on('data', collect)
        child.on('exit', (code) => resolve({ listened: output.includes('Listening'), code, output }))
    })
}

describe('server startup', () => {
    it('exits with code 1 and never listens when the database URL is bad', async () => {
        const result = await startServer({ MONGODB_URL: 'not-a-mongodb-url' })
        expect(result.listened).toBe(false)
        expect(result.code).toBe(1)
        expect(result.output).toContain('Could not connect to MongoDB')
    }, 15000)

    it('listens once the database is connected', async () => {
        // globalSetup put the in-memory MongoDB's URL in MONGODB_URL
        const result = await startServer({})
        expect(result.listened).toBe(true)
    }, 15000)
})
