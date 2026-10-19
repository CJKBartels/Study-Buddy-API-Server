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

const Availability = model('Availability', availabilitySchema)

export default Availability