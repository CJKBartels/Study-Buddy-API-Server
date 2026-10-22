import swaggerJSDoc from 'swagger-jsdoc'
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Study Buddy API',
            version: '1.0.0',
        },
        components: {
            schemas: {
                UserPublic: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        username: { type: 'string' },
                        timezone: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },

                // The signed-in user's own record. password and tokens are
                // stripped by the model's toJSON.
                UserPrivate: {
                    allOf: [
                        { $ref: '#/components/schemas/UserPublic' },
                        {
                            type: 'object',
                            properties: {
                                email: { type: 'string', format: 'email' },
                                updatedAt: { type: 'string', format: 'date-time' },
                            }
                        }
                    ]
                },

                // Returned by sign-up and sign-in
                AuthResponse: {
                    type: 'object',
                    properties: {
                        user: { $ref: '#/components/schemas/UserPrivate' },
                        token: { type: 'string', description: 'JWT for the Authorization header, valid for 7 days' },
                    }
                },

                UserCreateRequest: {
                    type: 'object',
                    required: [
                        'username',
                        'email',
                        'password'
                    ],
                    properties: {
                        username: { type: 'string', description: 'Stored lowercase' },
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string', format: 'password', minLength: 8 },
                    },
                },

                Course: {
                    type: 'object',

                    properties: {
                        title: { type: 'string' },
                        courseName: { type: 'string' },
                        courseCode: { type: 'string' },
                        school: { type: 'string' },
                        createdBy: { type: 'string' },
                        joinCode: { type: 'string' },
                        isPublic: { type: 'boolean' },
                    }
                },

                CourseCreateRequest: {
                    type: 'object',

                    required: [
                        'courseName',
                        'courseCode'
                    ],

                    properties: {
                        title: { type: 'string' },
                        courseName: { type: 'string' },
                        courseCode: { type: 'string' },
                        school: { type: 'string' },
                        isPublic: { type: 'boolean' },
                    }
                },

                AssignmentCreateRequest: {
                    type: 'object',

                    required: [
                        'title',
                        'dueAt'
                    ],

                    properties: {
                        title: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string', enum: ['active', 'archived'] },
                        dueAt: { type: 'string' },
                    }

                },

                Assignment: {
                    allOf: [
                        { $ref: '#/components/schemas/AssignmentCreateRequest' },
                        {
                            type: 'object',
                            properties: {
                                _id: { type: 'string' },
                                createdBy: { type: 'string' },
                                course: { type: 'string' },
                                source: { type: 'string', enum: ['community', 'moderator'] },
                                createdAt: { type: 'string' },
                                updatedAt: { type: 'string' },
                            }
                        }
                    ]
                },

                // One assignment with createdBy and course populated (GET by id)
                AssignmentDetail: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string', enum: ['active', 'archived'] },
                        dueAt: { type: 'string', format: 'date-time' },
                        source: { type: 'string', enum: ['community', 'moderator'] },
                        createdBy: {
                            type: 'object',
                            properties: {
                                _id: { type: 'string' },
                                username: { type: 'string' },
                            }
                        },
                        course: {
                            type: 'object',
                            properties: {
                                _id: { type: 'string' },
                                title: { type: 'string' },
                            }
                        },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    }
                },

                AssignmentPatchRequest: {
                    type: 'object',
                    description: 'At least one field. Any other field is rejected with INVALID_UPDATES.',
                    minProperties: 1,
                    additionalProperties: false,

                    properties: {
                        title: { type: 'string' },
                        description: { type: 'string' },
                        dueAt: { type: 'string' },
                    }
                },

                AssignmentUserState: {
                    type: 'object',

                    required: [
                        'assignment',
                        'course',
                        'user'
                    ],

                    properties: {
                        _id: { type: 'string' },
                        assignment: { type: 'string' },
                        course: { type: 'string' },
                        user: { type: 'string' },
                        state: { type: 'string', enum: ['not_started', 'in_progress', 'complete'] },
                        personalNotes: { type: 'string' },
                        personalDueAt: { type: 'string' },
                        completedAt: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    }

                },

                // The userState attached to each assignment in the "with user
                // states" lists. Defaults are filled in when the user has none.
                AssignmentUserStateSummary: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string', nullable: true, description: 'null when the user has no saved state yet' },
                        state: { type: 'string', enum: ['not_started', 'in_progress', 'complete'], default: 'not_started' },
                        personalNotes: { type: 'string' },
                        personalDueAt: { type: 'string', format: 'date-time', description: 'The user\'s own due date, or the assignment\'s dueAt if they never set one' },
                        completedAt: { type: 'string', format: 'date-time' },
                    }
                },

                // An assignment with this user's state attached. `course` is left
                // out because its shape differs by route; each route adds it.
                AssignmentWithUserState: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string', enum: ['active', 'archived'] },
                        dueAt: { type: 'string', format: 'date-time' },
                        source: { type: 'string', enum: ['community', 'moderator'] },
                        createdBy: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        userState: { $ref: '#/components/schemas/AssignmentUserStateSummary' },
                    }
                },

                // Every error response uses this shape (built by errorHandler)
                Error: {
                    type: 'object',
                    required: ['error'],
                    properties: {
                        error: {
                            type: 'object',
                            required: ['code', 'message'],
                            properties: {
                                code: { type: 'string', description: 'Stable, machine-readable code to branch on', example: 'COURSE_NOT_FOUND' },
                                message: { type: 'string', description: 'Safe to show to users', example: 'Course does not exist' },
                                details: {
                                    type: 'object',
                                    description: 'Per-field messages, only on VALIDATION_ERROR',
                                    additionalProperties: { type: 'string' },
                                    example: { title: 'Path `title` is required.' }
                                },
                            }
                        }
                    }
                },

                SessionCreateRequest: {
                    type: 'object',
                    required: ['title', 'goal', 'startsAt', 'endsAt'],
                    properties: {
                        title: { type: 'string' },
                        goal: { type: 'string' },
                        description: { type: 'string' },
                        startsAt: { type: 'string', format: 'date-time' },
                        endsAt: { type: 'string', format: 'date-time' },
                        location: { type: 'string' },
                        locationType: { type: 'string' },
                        capacity: { type: 'integer', description: 'Max accepted participants, host included. Omit for no limit.' },
                        joinPolicy: { type: 'string', enum: ['invite_only', 'course_open'], default: 'course_open' },
                    }
                },

                SessionPatchRequest: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        goal: { type: 'string' },
                        description: { type: 'string' },
                        startsAt: { type: 'string', format: 'date-time' },
                        endsAt: { type: 'string', format: 'date-time' },
                        location: { type: 'string' },
                        locationType: { type: 'string' },
                        capacity: { type: 'integer' },
                        joinPolicy: { type: 'string', enum: ['invite_only', 'course_open'] },
                        status: { type: 'string', enum: ['scheduled', 'cancelled'] },
                    }
                },

                Session: {
                    allOf: [
                        { $ref: '#/components/schemas/SessionCreateRequest' },
                        {
                            type: 'object',
                            properties: {
                                _id: { type: 'string' },
                                course: { type: 'string' },
                                host: { type: 'string' },
                                timezone: { type: 'string', example: 'America/New_York' },
                                status: { type: 'string', enum: ['scheduled', 'cancelled'] },
                                createdAt: { type: 'string', format: 'date-time' },
                                updatedAt: { type: 'string', format: 'date-time' },
                            }
                        }
                    ]
                },

                SessionParticipant: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        session: { type: 'string' },
                        user: { type: 'string' },
                        invitedBy: { type: 'string' },
                        status: { type: 'string', enum: ['invited', 'accepted', 'declined', 'waitlisted', 'removed', 'left'] },
                        respondedAt: { type: 'string', format: 'date-time' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    }
                },

                SessionMessage: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        session: { type: 'string' },
                        course: { type: 'string' },
                        sender: { type: 'string' },
                        body: { type: 'string' },
                        edited: { type: 'boolean' },
                        deletedAt: { type: 'string', format: 'date-time', nullable: true },
                        sentAt: { type: 'string', format: 'date-time' },
                        editedAt: { type: 'string', format: 'date-time' },
                    }
                },

                AvailabilityBlock: {
                    type: 'object',
                    required: ['day', 'startMin', 'endMin'],
                    properties: {
                        day: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday' },
                        startMin: { type: 'integer', minimum: 0, maximum: 1439, description: 'Minutes after midnight', example: 540 },
                        endMin: { type: 'integer', minimum: 1, maximum: 1440, description: 'Must be after startMin', example: 660 },
                    }
                },

                AvailabilityPutRequest: {
                    type: 'object',
                    required: ['timezone'],
                    properties: {
                        timezone: { type: 'string', example: 'America/New_York' },
                        blocks: { type: 'array', items: { $ref: '#/components/schemas/AvailabilityBlock' } },
                    }
                },

                Availability: {
                    allOf: [
                        { $ref: '#/components/schemas/AvailabilityPutRequest' },
                        {
                            type: 'object',
                            properties: {
                                _id: { type: 'string' },
                                user: { type: 'string' },
                                createdAt: { type: 'string', format: 'date-time' },
                                updatedAt: { type: 'string', format: 'date-time' },
                            }
                        }
                    ]
                }
            },

            // Reusable path parameters, so routes don't repeat them
            parameters: {
                CourseId: { in: 'path', name: 'courseId', required: true, schema: { type: 'string' }, description: 'Id of course' },
                AssignmentId: { in: 'path', name: 'assignmentId', required: true, schema: { type: 'string' }, description: 'Id of assignment' },
                SessionId: { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' }, description: 'Id of session' },
                UserId: { in: 'path', name: 'userId', required: true, schema: { type: 'string' }, description: 'Id of user' },
                MessageId: { in: 'path', name: 'messageId', required: true, schema: { type: 'string' }, description: 'Id of message' },
            },

            // Reusable error responses. Routes reference the statuses they can
            // return; the description lists the common codes for each.
            responses: {
                BadRequest: {
                    description: 'Invalid request. Codes: VALIDATION_ERROR (see `details`), BAD_REQUEST, INVALID_UPDATES, INVITEE_NOT_IN_COURSE, INVALID_CREDENTIALS.',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                Unauthorized: {
                    description: 'Missing, invalid, or signed-out token. Code: UNAUTHORIZED.',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                Forbidden: {
                    description: 'Signed in but not allowed. Codes: FORBIDDEN, NOT_COURSE_MEMBER, COURSE_BANNED, NOT_COURSE_ADMIN, NOT_COURSE_MODERATOR, NOT_SESSION_PARTICIPANT, NOT_SESSION_HOST, SESSION_NOT_OPEN, NOT_INVITED, CANNOT_MODIFY_MESSAGE.',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                NotFound: {
                    description: 'Resource does not exist. Codes: NOT_FOUND, USER_NOT_FOUND, COURSE_NOT_FOUND, ASSIGNMENT_NOT_FOUND, SESSION_NOT_FOUND, PARTICIPANT_NOT_FOUND, MESSAGE_NOT_FOUND, AVAILABILITY_NOT_FOUND.',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                Conflict: {
                    description: 'Clashes with current state. Codes: CONFLICT, DUPLICATE_ACCOUNT, ALREADY_PARTICIPANT, INVALID_STATUS_CHANGE.',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
            },
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [{ bearerAuth: [] }],
    },
    apis: ['./src/routers/**/*.js'],
}

const swaggerSpec = swaggerJSDoc(options)
export default swaggerSpec