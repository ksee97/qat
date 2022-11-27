const express = require('express');
const AppEvaluation = require('../../models/evaluations/appEvaluation');
const Evaluation = require('../../models/evaluations/evaluation');
const User = require('../../models/user');
const middlewares = require('../../helpers/middlewares');
const discord = require('../../helpers/discord');
const { AppEvaluationConsensus, BnEvaluationConsensus } = require('../../shared/enums');
const moment = require('moment');

const router = express.Router();

router.use(middlewares.isLoggedIn);
router.use(middlewares.hasFullReadAccess);

//population
const defaultAppPopulate = [
    { path: 'user', select: 'username osuId' },
    { path: 'test', select: 'totalScore comment' },
    { path: 'bnEvaluators', select: 'username osuId' },
    { path: 'natEvaluators', select: 'username osuId' },
    {
        path: 'reviews',
        select: 'evaluator behaviorComment moddingComment vote',
        populate: {
            path: 'evaluator',
            select: 'username osuId groups',
        },
    },
];

const defaultBnPopulate = [
    {
        path: 'user',
        select: 'username osuId modesInfo',
    },
    {
        path: 'natEvaluators',
        select: 'username osuId',
    },
    {
        path: 'reviews',
        select: 'evaluator behaviorComment moddingComment vote',
        populate: {
            path: 'evaluator',
            select: 'username osuId groups',
        },
    },
];

/* GET search for user */
router.get('/search', async (req, res) => {
    const userToSearch = req.query.user && decodeURI(req.query.user);
    const idToSearch = req.query.id;

    let limit = parseInt(req.query.limit) || 12;

    let bnApplicationsQuery = AppEvaluation
        .find({
            active: false,
            consensus: { $exists: true },
        })
        .populate(defaultAppPopulate)
        .sort({ createdAt: -1 })
        .limit(limit);

    let bnEvaluationsQuery = Evaluation
        .find({
            active: false,
            consensus: { $exists: true },
        })
        .populate(defaultBnPopulate)
        .sort({ createdAt: -1 })
        .limit(limit);

    if (userToSearch) {
        const user = await User.findByUsernameOrOsuId(userToSearch);

        if (!user) {
            return res.json({ error: 'Cannot find user!' });
        }

        bnApplicationsQuery.where('user', user.id);
        bnEvaluationsQuery.where('user', user.id);
    } else if (idToSearch) {
        bnApplicationsQuery.where('_id', idToSearch);
        bnEvaluationsQuery.where('_id', idToSearch);
    } else {
        bnApplicationsQuery.where('mode', req.query.mode);
        bnEvaluationsQuery.where('mode', req.query.mode);
    }

    const [bnApplications, evaluations] = await Promise.all([
        bnApplicationsQuery,
        bnEvaluationsQuery,
    ]);

    res.json({
        bnApplications,
        evaluations,
    });
});

/* POST unarchive application evaluation */
router.post('/:id/unarchiveApp', async (req, res) => {
    let app = await AppEvaluation.findById(req.params.id).orFail();
    let user = await User.findById(app.user).orFail();

    // Remove join history, user modes and BN group if not hybrid
    if (app.consensus === AppEvaluationConsensus.Pass) {
        // TODO find somehow the actual history, relatedEvaluation === evaluation._id?
        user.history.pop();
        let i = user.modesInfo.findIndex(m => m.mode === app.mode);

        if (i !== -1) {
            user.modesInfo.splice(i, 1);
        }

        if (!user.modesInfo.length) {
            i = user.groups.findIndex(g => g === 'bn');

            if (i !== -1) {
                user.groups.splice(i, 1);
            }
        }

        await Promise.all([
            user.save(),
            Evaluation.deleteUserActiveEvaluations(user.id),
        ]);
    }

    await AppEvaluation.findByIdAndUpdate(app.id, { active: true });

    discord.webhookPost(
        [{
            author: discord.defaultWebhookAuthor(req.session),
            color: discord.webhookColors.white,
            description: `Un-archived [**${user.username}**'s BN app](http://bn.mappersguild.com/appeval?id=${app.id})`,
        }],
        app.mode
    );

    res.json({ success: 'Unarchived' });
});

/* POST unarchive bn evaluation */
router.post('/:id/unarchiveBn', async (req, res) => {
    let evaluation = await Evaluation.findById(req.params.id).orFail();
    let user = await User.findById(evaluation.user).orFail();

    // Remove left history. Add mode and BN group back if not hybrid
    if (evaluation.consensus === BnEvaluationConsensus.RemoveFromBn || evaluation.isResignation) {
        // TODO find somehow the actual history, relatedEvaluation === evaluation._id?
        user.history.pop();

        if (!user.isBn) {
            user.groups.push('bn');
        }

        if (!user.isBnFor(evaluation.mode)) {
            user.modesInfo.push({
                mode: evaluation.mode,
                level: 'probation',
            });
        }

    // Change mode to probation and restore mode if needed
    } else if (evaluation.consensus === BnEvaluationConsensus.ProbationBn || evaluation.consensus === BnEvaluationConsensus.FullBn) {
        await Evaluation.deleteUserActiveEvaluations(user.id);

        const i = user.modesInfo.findIndex(m => m.mode == evaluation.mode);

        if (i !== -1) {
            user.modesInfo.splice(i, 1);
        }

        user.modesInfo.push({
            mode: evaluation.mode,
            level: 'probation',
        });
    }

    await Promise.all([
        user.save(),
        Evaluation.findByIdAndUpdate(req.params.id, { active: true }),
    ]);

    discord.webhookPost(
        [{
            author: discord.defaultWebhookAuthor(req.session),
            color: discord.webhookColors.white,
            description: `Un-archived [**${user.username}**'s current BN eval](http://bn.mappersguild.com/bneval?id=${evaluation.id})`,
        }],
        evaluation.mode
    );

    res.json({ success: 'Unarchived' });
});

module.exports = router;
