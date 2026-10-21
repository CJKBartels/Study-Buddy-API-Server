import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import healthRouter from './routers/health.js'
import userRouter from './routers/user.js'
import assignmentRouter from './routers/assignments.js'
import sessionRouter from './routers/session.js'
import courseRouter from './routers/course.js'
import availabilityRouter from './routers/availability.js'
import swaggerSpec from '../swagger.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

const app = express()

app.use(express.json())
app.use(cors())

app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
})

// First, so monitors get a fast answer without going through other routers
app.use(healthRouter)
app.use(userRouter)
app.use(assignmentRouter)
app.use(sessionRouter)
app.use(courseRouter)
app.use(availabilityRouter)

app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
        swaggerOptions: {
            persistAuthorization: true,
        },
    }))

// Normalization layer — must be mounted last: the 404 catch-all turns unmatched
// routes into an AppError, then errorHandler converts everything into the
// { error: { code, message } } envelope.
app.use(notFoundHandler)
app.use(errorHandler)

export default app