import { describe, it, expect } from 'vitest'
import { mergeBlocks } from '../../src/models/availability.js'

const block = (day, startMin, endMin) => ({ day, startMin, endMin })

describe('mergeBlocks', () => {
    it('merges overlapping blocks on the same day', () => {
        expect(mergeBlocks([block(1, 540, 660), block(1, 600, 720)]))
            .toEqual([block(1, 540, 720)])
    })

    it('merges blocks that only touch', () => {
        expect(mergeBlocks([block(1, 540, 600), block(1, 600, 660)]))
            .toEqual([block(1, 540, 660)])
    })

    it('swallows a block contained in another', () => {
        expect(mergeBlocks([block(1, 540, 720), block(1, 600, 630)]))
            .toEqual([block(1, 540, 720)])
    })

    it('merges a chain of blocks into one', () => {
        expect(mergeBlocks([block(1, 540, 600), block(1, 590, 650), block(1, 650, 700)]))
            .toEqual([block(1, 540, 700)])
    })

    it('keeps blocks with a gap between them separate', () => {
        expect(mergeBlocks([block(1, 540, 600), block(1, 601, 660)]))
            .toEqual([block(1, 540, 600), block(1, 601, 660)])
    })

    it('never merges across days', () => {
        expect(mergeBlocks([block(1, 1380, 1440), block(2, 0, 60)]))
            .toEqual([block(1, 1380, 1440), block(2, 0, 60)])
    })

    it('sorts by day, then start time', () => {
        expect(mergeBlocks([block(3, 600, 660), block(1, 700, 760), block(1, 540, 600)]))
            .toEqual([block(1, 540, 600), block(1, 700, 760), block(3, 600, 660)])
    })

    it('returns an empty list for no blocks', () => {
        expect(mergeBlocks([])).toEqual([])
    })

    it('does not change the array it was given', () => {
        const input = [block(1, 600, 720), block(1, 540, 660)]
        mergeBlocks(input)
        expect(input).toEqual([block(1, 600, 720), block(1, 540, 660)])
    })
})
