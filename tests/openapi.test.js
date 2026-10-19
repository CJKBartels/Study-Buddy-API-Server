import { describe, it, expect } from 'vitest'
import swaggerSpec from '../swagger.js'
import { ERROR_CODES } from '../src/assets/errorCodes.js'
import userRouter from '../src/routers/user.js'
import courseRouter from '../src/routers/course.js'
import assignmentRouter from '../src/routers/assignments.js'
import sessionRouter from '../src/routers/session.js'
import availabilityRouter from '../src/routers/availability.js'

// Keeps /api-docs in step with the code. These checks fail when a route has
// no @openapi block, when a block describes a route that doesn't exist (or
// was silently dropped by swagger-jsdoc over a YAML mistake), or when a new
// error code isn't listed in the shared error responses.

const routers = [userRouter, courseRouter, assignmentRouter, sessionRouter, availabilityRouter]

// Reads each router's registered routes. `stack` is Express internals, not a
// public API, so an Express upgrade could break this helper without the docs
// being wrong. Some routers are express() apps (routes on .router), others
// are express.Router() (routes on the router itself).
function registeredRoutes() {
    return routers.flatMap((router) => (router.router ?? router).stack
        .filter((layer) => layer.route)
        .flatMap((layer) => Object.keys(layer.route.methods).map((method) =>
            `${method.toUpperCase()} ${layer.route.path.replace(/:(\w+)/g, '{$1}')}`)))
}

function documentedOperations() {
    return Object.entries(swaggerSpec.paths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`))
}

describe('OpenAPI spec', () => {
    it('documents every registered route', () => {
        const documented = new Set(documentedOperations())
        const undocumented = registeredRoutes().filter((route) => !documented.has(route))
        expect(undocumented).toEqual([])
    })

    it('documents only routes that exist', () => {
        const registered = new Set(registeredRoutes())
        const phantom = documentedOperations().filter((operation) => !registered.has(operation))
        expect(phantom).toEqual([])
    })

    it('lists every error code in the shared response for its status', () => {
        const responseFor = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict' }
        const unlisted = Object.entries(ERROR_CODES)
            .filter(([, { status }]) => responseFor[status])
            .filter(([code, { status }]) => !swaggerSpec.components.responses[responseFor[status]].description.includes(code))
            .map(([code]) => code)
        expect(unlisted).toEqual([])
    })

    it('gives every operation at least one error response', () => {
        const withoutErrors = Object.entries(swaggerSpec.paths).flatMap(([path, operations]) =>
            Object.entries(operations)
                .filter(([, operation]) => !Object.keys(operation.responses).some((status) => status >= '400'))
                .map(([method]) => `${method.toUpperCase()} ${path}`))
        expect(withoutErrors).toEqual([])
    })
})
