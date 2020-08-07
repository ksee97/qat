const mongoose = require('mongoose');

const aiessSchema = new mongoose.Schema({
    beatmapsetId: { type: Number },
    userId: { type: Number },
    discussionId: { type: Number },
    artistTitle: { type: String },
    modes: [{ type: String, enum: ['osu', 'taiko', 'catch', 'mania'] }],
    type: { type: String, enum: ['nominate', 'qualify', 'disqualify', 'nomination_reset', 'rank'] },
    content: { type: String },
    time: { type: Date },
    creatorId: { type: Number },
    creatorName: { type: String },

    valid: { type: Number, enum: [1, 2, 3] }, // TODO check if not used anymore?
    obviousness: { type: Number, default: null },
    severity: { type: Number, default: null },
    mapperId: { type: Number },
    mapperTotalRanked: { type: Number },
    isBnOrNat: { type: Boolean, default: false },
    isUnique: { type: Boolean, default: false },
    effortBonus: { type: Number }, //multiplier combining drain per diff, # diffs, and difficulty of each diff
    responsibleNominators: [{ type: Number }],
    qualityAssuranceCheckers: [{ type: 'ObjectId', ref: 'User' }],
    qualityAssuranceComments: [{ type: 'ObjectId', ref: 'Mediation' }],
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

class AiessService extends mongoose.Model
{

    /**
     * Get unique events from an user
     * @param {number} userId
     * @param {Date} minDate
     * @param {Date} maxDate
     * @param {array} modes
     * @param {array} types
     * @returns {mongoose.Aggregate} aggregation query
     */
    static getUniqueUserEvents (userId, minDate, maxDate, modes, types) {
        const aggregation = this.getUserEvents(userId, minDate, maxDate, modes, types);

        aggregation
            .group({
                _id: '$beatmapsetId',
                event: { $first: '$$ROOT' },
            })
            .replaceRoot('event')
            .sort({
                time: 1,
            });

        return aggregation;
    }

    /**
     * Get all the specified events from an user
     * @param {number} userId
     * @param {Date} minDate
     * @param {Date} maxDate
     * @param {array} modes
     * @param {array} types
     * @returns {mongoose.Aggregate} aggregation query
     */
    static getUserEvents (userId, minDate, maxDate, modes, types) {
        return this.aggregate([
            {
                $match: {
                    userId,
                    type: {
                        $in: types,
                    },
                    $and: [
                        { time: { $gte: minDate } },
                        { time: { $lte: maxDate } },
                    ],
                    modes: { $in: modes },
                },
            },
            {
                $sort: {
                    time: 1,
                    beatmapsetId: -1,
                },
            },
        ]);
    }

    /**
     * Get all the specified events from an user related to a group of beatmapsets
     * @param {number} userId
     * @param {array} beatmapsetIds
     * @param {Date} minDate
     * @param {Date} maxDate
     * @param {array} modes
     * @param {string} type
     * @returns {object} aggregation query
     */
    static getRelatedBeatmapsetEvents (userId, beatmapsetIds, minDate, maxDate, modes, type) {
        const aggregation = this.aggregate([
            {
                $match: {
                    userId: { $ne: userId },
                    beatmapsetId: {
                        $in: beatmapsetIds,
                    },
                    type,
                    $and: [
                        { time: { $gte: minDate } },
                        { time: { $lte: maxDate } },
                    ],
                    modes: { $in: modes },
                },
            },
            {
                $sort: {
                    time: 1,
                    beatmapsetId: -1,
                },
            },
        ]);

        return aggregation;
    }

    /**
     * Group all data by event without mode and including nominations
     * @param {Date} minDate
     * @param {Date} maxDate
     * @param {string} mode
     */
    static async getAllActivity(minDate, maxDate, mode) {
        if (!minDate && !maxDate) return null;

        try {
            return await this.aggregate([
                {
                    $match: {
                        $and: [
                            { time: { $gte: minDate } },
                            { time: { $lte: maxDate } },
                        ],
                        type: { $ne: 'rank' },
                        modes: mode,
                    },
                },
                {
                    $sort: {
                        time: 1,
                        beatmapsetId: -1,
                    },
                },
                {
                    $group: {
                        _id: '$type', events: { $push: '$$ROOT' },
                    },
                },
            ]);
        } catch (error) {
            return { error: error._message };
        }
    }
}

aiessSchema.loadClass(AiessService);
/**
 * @type {import('./interfaces/aiess').IAiessModel}
 */
const Aiess = mongoose.model('aiess', aiessSchema, 'aiess');

module.exports = Aiess;
