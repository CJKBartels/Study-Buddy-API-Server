import { model, Schema } from 'mongoose'
import isValidTimeZone from '../assets/timezoneValidation.js'

const availabilitySchema = new Schema({
    user: {
        type: Schema.ObjectId,
        ref: 'User',
        unique: true,
        required: true
    },

    timezone: {
        type: String,
        required: true,
        validate: {
            validator: (tz) => isValidTimeZone(tz),
            message: 'Invalid Time Zone'
        }
    },

    blocks: {
        type: [
            {
                day: {
                    type: Number,
                    required: true,
                    enum: [0, 1, 2, 3, 4, 5, 6]
                },
                startMin: {
                    type: Number,
                    required: true,
                    min: 0,
                    max: 1439
                },
                endMin: {
                    type: Number,
                    required: true,
                    min: 1,
                    max: 1440,
                    validate: {
                        // `this` is the block, so the rule can compare two fields.
                        // Only works under document validation (validate/save),
                        // which is why the route validates a draft before writing.
                        validator: function (endMin) {
                            return endMin > this.startMin
                        },
                        message: 'Block must end after it starts'
                    }
                }
            }
        ],
    }

}, { timestamps: true })

// Collapse overlapping or touching blocks on the same day into one, sorted by
// day then start time, so each stretch of free time is stored exactly one way
// (Mon 9-10 + Mon 10-11 is stored as Mon 9-11). Plain data in, plain data out.
export function mergeBlocks(blocks) {
    const sorted = blocks
        .map(({ day, startMin, endMin }) => ({ day, startMin, endMin }))
        .sort((a, b) => a.day - b.day || a.startMin - b.startMin)

    return sorted.reduce((merged, block) => {
        const last = merged.at(-1)

        if (last && last.day === block.day && block.startMin <= last.endMin) {
            const extended = { ...last, endMin: Math.max(last.endMin, block.endMin) }
            return [...merged.slice(0, -1), extended]
        }

        return [...merged, block]
    }, [])
}

const Availability = model('Availability', availabilitySchema)

export default Availability