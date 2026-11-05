import AppError from '../assets/AppError.js'

// Takes the fields a route accepts and returns a middleware for its chain. Put
// it after the access checks, so outsiders get a 401 or 403, not a hint about
// which fields exist. atLeastOne is for update routes: an empty body is a
// mistake there, because there's nothing to change.
export function acceptFields(allowed, { atLeastOne = false } = {}) {
    return (req, res, next) => {
        const fields = Object.keys(req.body)

        if (atLeastOne && fields.length === 0) {
            throw new AppError('INVALID_UPDATES', { message: 'Missing updates' })
        }

        const rejected = fields.filter((field) => !allowed.includes(field))

        if (rejected.length > 0) {
            const details = Object.fromEntries(rejected.map((field) => [field, 'Field cannot be set']))
            throw new AppError('VALIDATION_ERROR', { details })
        }

        next()
    }
}
