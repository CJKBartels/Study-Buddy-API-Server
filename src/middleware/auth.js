import User from '../models/user.js'
import jwt from 'jsonwebtoken'
import AppError from '../assets/AppError.js'

const auth = async (req, res, next) => {
    try {
        const header = req.header('Authorization')
        if (!header) {
            throw new AppError('UNAUTHORIZED')
        }
        const token = header.replace('Bearer ', '')

        // verify rejects expired tokens (TokenExpiredError -> 401 below)
        const decoded = jwt.verify(token, process.env.JSON_WEB_TOKEN_SECRET)

        // Tokens issued before expiry existed have no exp and would be valid
        // forever, so they're refused; those users sign in again once
        if (!decoded.exp) {
            throw new AppError('UNAUTHORIZED')
        }

        const user = await User.findOne({ _id: decoded._id, 'tokens.token': token })

        if (!user) {
            throw new AppError('UNAUTHORIZED')
        }

        req.token = token
        req.user = user

        next()

    } catch (error) {
        // Token problems (missing header, bad/expired JWT) -> 401. Anything else
        // (e.g. a DB failure) is unexpected and must reach the central handler as
        // a 500 rather than be masked as an auth failure.
        if (
            error instanceof AppError ||
            error?.name === 'JsonWebTokenError' ||
            error?.name === 'TokenExpiredError'
        ) {
            return next(new AppError('UNAUTHORIZED'))
        }
        next(error)
    }
}

export default auth