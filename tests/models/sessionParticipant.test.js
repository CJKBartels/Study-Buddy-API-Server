import { describe, it, expect } from 'vitest'
import mongoose from 'mongoose'
import SessionParticipant from '../../src/models/sessionParticipant.js'

const participant = (status) => new SessionParticipant({
    session: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    status
})

describe('SessionParticipant.canMoveTo', () => {
    it.each([
        ['invited', 'accepted'],
        ['invited', 'declined'],
        ['invited', 'removed'],
        ['accepted', 'left'],
        ['accepted', 'removed'],
        ['declined', 'invited'],
        ['left', 'invited'],
        ['removed', 'invited'],
        ['waitlisted', 'accepted'],
        ['waitlisted', 'left'],
        ['waitlisted', 'removed']
    ])('allows %s -> %s', (from, to) => {
        expect(participant(from).canMoveTo(to)).toBe(true)
    })

    it.each([
        ['removed', 'accepted'],
        ['left', 'accepted'],
        ['declined', 'accepted'],
        ['accepted', 'accepted'],
        ['accepted', 'invited'],
        ['invited', 'left']
    ])('refuses %s -> %s', (from, to) => {
        expect(participant(from).canMoveTo(to)).toBe(false)
    })

    it('refuses a status that does not exist', () => {
        expect(participant('accepted').canMoveTo('promoted')).toBe(false)
    })
})
