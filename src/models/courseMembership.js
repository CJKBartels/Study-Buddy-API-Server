import { model, Schema } from 'mongoose'

const courseMembershipSchema = new Schema({
    course: {
        type: Schema.ObjectId,
        ref: 'Course',
        index: true,
        required: true
    },

    user: {
        type: Schema.ObjectId,
        ref: 'User',
        index: true,
        required: true
    },

    role: {
        type: String,
        enum: ['member', 'moderator', 'admin'],
    },

    status: {
        type: String,
        enum: ['active', 'banned'],
        required: true
    },
}, {
    timestamps: {
        createdAt: 'joinedAt',
        updatedAt: true
    },
})

courseMembershipSchema.index({ course: 1, user: 1 }, { unique: true })

// True when this user is the course's only active admin. Lives on the model,
// not in middleware, because account deletion needs it too. Counting and then
// writing leaves a small gap: two admins leaving in the same instant could both
// pass. Accepted, since closing it would need a second copy of the admin count.
courseMembershipSchema.statics.isLastAdmin = async function (courseId, userId) {
    const admins = await this.find({ course: courseId, role: 'admin', status: 'active' }, { user: 1 }).limit(2)

    return admins.length === 1 && admins[0].user.equals(userId)
}

const CourseMembership = model('CourseMembership', courseMembershipSchema)

export default CourseMembership