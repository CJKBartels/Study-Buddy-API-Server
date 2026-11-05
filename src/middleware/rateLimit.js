import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import AppError from '../assets/AppError.js'

// Counts live in memory: one API instance, and a restart resetting them is
// acceptable. Behind proxies, req.ip is only the visitor's address when
// app.js sets trust proxy correctly (TRUST_PROXY).

const WINDOW_15_MIN = 15 * 60 * 1000
const WINDOW_1_HOUR = 60 * 60 * 1000

// Over the limit: the usual error envelope, through errorHandler
function tooManyRequests(req, res, next) {
    next(new AppError('TOO_MANY_REQUESTS'))
}

// Sign-in attempts per IP and email. Keying on both slows password guessing
// on one account, without letting an attacker lock a user out from another
// network or making a shared campus IP share one limit.
export function signInLimiter({ limit = Number(process.env.SIGN_IN_LIMIT ?? 10) } = {}) {
    return rateLimit({
        windowMs: WINDOW_15_MIN,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // ipKeyGenerator groups IPv6 addresses by network, since one user
        // can hold a whole block of them
        keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
        handler: tooManyRequests
    })
}

// New accounts per IP
export function signUpLimiter({ limit = Number(process.env.SIGN_UP_LIMIT ?? 5) } = {}) {
    return rateLimit({
        windowMs: WINDOW_1_HOUR,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: tooManyRequests
    })
}
