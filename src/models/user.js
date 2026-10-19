import { model, Schema } from 'mongoose'
import validator from 'validator'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import isValidTimeZone from '../assets/timezoneValidation.js'
import { randomUUID } from 'crypto'

const { sign } = jwt

const userSchema = new Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },

    password: {
        type: String,
        required: true,
        trim: true,
        minLength: 8
    },

    email: {
        type: String,
        required: true,
        validate: {
            validator: (value) => validator.isEmail(value),
            message: 'Invalid Email address'
        },
        unique: true
    },

    tokens: [{
        token: {
            type: String,
            required: false
        }
    }],

    timezone: {
        type: String,
        required: true,
        validate: {
            validator: (tz) => isValidTimeZone(tz),
            message: 'Invalid Time Zone'
        }
    }
}, { timestamps: true })

userSchema.methods.toJSON = function () {
    const user = this

    const userObject = user.toObject()

    delete userObject.password
    delete userObject.tokens

    return userObject
}

userSchema.methods.generateAuthToken = async function () {
    // jwtid gives every token a unique id, so two sign-ins in the same second
    // don't produce the same token (signing out of one would end both)
    const token = sign({ _id: this._id.toString() }, process.env.JSON_WEB_TOKEN_SECRET, { jwtid: randomUUID() })

    // $push adds the token without reading the list first. concat + save()
    // replaced the whole list, so simultaneous sign-ins overwrote each other.
    // The in-memory doc is left alone on purpose: changing it would make a
    // later save() on this doc write the whole list back.
    await User.updateOne({ _id: this._id }, { $push: { tokens: { token } } })

    return token
}

// Returns the user, or null when the email or password is wrong (the caller
// can't tell which, on purpose). Real failures, like a database error, still
// throw, so they aren't mistaken for bad credentials.
userSchema.statics.findByCredentials = async (email, password) => {
    const user = await User.findOne({ email })

    if (!user) {
        return null
    }

    const isMatch = await bcrypt.compare(password, user.password)

    return isMatch ? user : null
}

userSchema.statics.publicUserProjection = async function () {
    return {
        _id: 1,
        username: 1,
        createdAt: 1,
        timezone: 1
    }
}

userSchema.pre('save', async function (next) {
    const user = this

    if (user.isModified('password')) {
        user.password = await bcrypt.hash(user.password, 8)
    }

    next()
})


userSchema.index({ 'tokens.token': 1 })

const User = model('User', userSchema)

export default User