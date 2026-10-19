import { model, Schema } from 'mongoose'

const sessionParticipantSchema = new Schema({
    session: {
        type: Schema.ObjectId,
        ref: 'Session',
        required: true,
        index: true
    },

    user: {
        type: Schema.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    invitedBy: {
        type: Schema.ObjectId,
        ref: 'User'
    },

    status: {
        type: String,
        enum: ['invited', 'accepted', 'declined', 'waitlisted', 'removed', 'left'],
        required: true
    },

    respondedAt: Date
}, { timestamps: true })

sessionParticipantSchema.index({ session: 1, user: 1 }, { unique: true })

// The status changes a participant may make. Any change not listed here is
// refused, so this table is the one place that answers "can X become Y?".
// Who may make a change (e.g. only the host re-invites a removed user) is
// checked by the route, since the table only knows statuses.
const ALLOWED_MOVES = Object.freeze({
    invited: ['accepted', 'waitlisted', 'declined', 'removed'],
    accepted: ['left', 'removed'],
    declined: ['invited'],
    left: ['invited'],
    waitlisted: ['accepted', 'left', 'removed'],
    removed: ['invited']
})

sessionParticipantSchema.methods.canMoveTo = function (status) {
    return ALLOWED_MOVES[this.status]?.includes(status) ?? false
}

const SessionParticipant = model('SessionParticipant', sessionParticipantSchema)

export default SessionParticipant