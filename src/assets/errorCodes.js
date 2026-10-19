// Central registry of error codes -> default { status, message }.
// AppError and the error-handling middleware both read from this map, so adding
// a new error means adding one line here. Codes are stable, machine-readable
// strings the SPA can branch on; messages are safe to show to users.
export const ERROR_CODES = Object.freeze({
    // Generic, HTTP-aligned
    VALIDATION_ERROR: { status: 400, message: 'Validation failed' },
    BAD_REQUEST: { status: 400, message: 'Bad request' },
    UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
    FORBIDDEN: { status: 403, message: 'Forbidden' },
    NOT_FOUND: { status: 404, message: 'Resource not found' },
    CONFLICT: { status: 409, message: 'Conflict' },
    INTERNAL_ERROR: { status: 500, message: 'Internal server error' },

    // Domain-specific (needed by user.js + middleware now; grow as routers migrate)
    DUPLICATE_ACCOUNT: { status: 409, message: 'An account with that email already exists' },
    INVALID_CREDENTIALS: { status: 400, message: 'Invalid email or password' },
    INVALID_UPDATES: { status: 400, message: 'Invalid updates' },
    USER_NOT_FOUND: { status: 404, message: 'User does not exist' },
    COURSE_NOT_FOUND: { status: 404, message: 'Course does not exist' },
    ASSIGNMENT_NOT_FOUND: { status: 404, message: 'Assignment does not exist' },
    NOT_COURSE_MEMBER: { status: 403, message: 'User is not a member of course' },
    NOT_COURSE_ADMIN: { status: 403, message: 'User is not an admin of course' },
    NOT_COURSE_MODERATOR: { status: 403, message: 'User is not a moderator of course' },
    COURSE_BANNED: { status: 403, message: 'User has been banned from course' },
    SESSION_NOT_FOUND: { status: 404, message: 'Session does not exist' },
    NOT_SESSION_PARTICIPANT: { status: 403, message: 'User is not a participant of session' },
    NOT_SESSION_HOST: { status: 403, message: 'User is not host of session' },
    SESSION_NOT_OPEN: { status: 403, message: 'Session is invite only' },
    NOT_INVITED: { status: 403, message: 'User was not invited to session' },
    ALREADY_PARTICIPANT: { status: 409, message: 'User is already a participant' },
    INVALID_STATUS_CHANGE: { status: 409, message: 'Participant status cannot change this way' },
    PARTICIPANT_NOT_FOUND: { status: 404, message: 'User is not part of session' },
})
