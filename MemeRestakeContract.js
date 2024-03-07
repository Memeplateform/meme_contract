/// meme restake contract

// meme token
const MEME_SYMBOL = "tdsu";
const MEME_DECIMAL = 6;

const NODE_ACCOUNT = "okcoinjapan";

const PER_BOOST = new BigNumber(100);
const PER_DAY_BLOCK = new BigNumber(7200);    // 172800 = 2 * 60 * 60 * 24;
const REWARD_IOST_RATE = new BigNumber(400);  // 4%
const REWARD_IDRAG_RATE = new BigNumber(600); // 6%
const PER_IDRAG = new BigNumber(250);         // 1 iost => 250 idrag
const PER_YEAR_DAY = new BigNumber(36500);    // 365 x 100 iost

class MemeRestakeContract {
    init() {
        storage.put("is_pause", "0");       // project is pause 1=pause
    }

    can_update(data) {
        return blockchain.requireAuth(blockchain.contractOwner(), "active");
    }

    _requireAuth(account) {
        if (!blockchain.requireAuth(account, "active")) {
            throw 'require auth failed';
        }
    }

    _onlyOwner() {
        if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
            throw "require auth error: not contractOwner";
        }
    }

    _whenNotPaused() {
        if (storage.get("is_pause") == "1") {
            throw "contract is paused";
        }
    }

    _toFixed(amount) {
        return amount.toFixed(MEME_DECIMAL, 1);
    }

    pause(value) {
        this._onlyOwner();

        if (!(value == 0 || value == 1)) {
            throw "invalid value";
        }

        storage.put("is_pause", value.toString(), tx.publisher);
    }

    withdraw(token, amount) {
        this._onlyOwner();

        if (token.length == 0) {
            throw "invalid token name";
        }

        const amt = new BigNumber(amount);
        if (amt.isZero()) {
            throw "invalid amount";
        }

        blockchain.callWithAuth("token.iost", "transfer", [token, blockchain.contractName(), tx.publisher, amt.toString(), ""]);
    }

    _calcVoteDays(voteBlock) {
        const currBlock = new BigNumber(block.number);
        const startBlock = new BigNumber(voteBlock);
        return currBlock.minus(startBlock).div(PER_DAY_BLOCK).toFixed(0);
    }

    _getVote(voter) {
        return JSON.parse(storage.mapGet("votes", voter) || "{}");
    }

    _rewardAmount(vote, unvoteAmt) {
        const voteAmt = new BigNumber(vote.voteAmt);
        if (unvoteAmt.gt(voteAmt)) {
            throw "unvote amount oversize";
        }

        const voteDays = this._calcVoteDays(new BigNumber(vote.voteBlock));

        const rewardIost = (REWARD_IOST_RATE.div(PER_YEAR_DAY)).times(new BigNumber(voteDays)).times(unvoteAmt).div(PER_BOOST);
        const rewardIdrag = (REWARD_IDRAG_RATE.div(PER_YEAR_DAY)).times(new BigNumber(voteDays)).times(unvoteAmt).div(PER_BOOST).times(PER_IDRAG);

        return [rewardIost, rewardIdrag, voteDays];
    }


    _newVote(voteAmt) {
        const vote = {
            voteBlock: block.number,
            voteAmt: voteAmt.toString(),
            voteTotal: voteAmt.toString(),
            rewardIost: "0",
            claimIost: "0",
            rewardIdrag: "0",
            claimIdrag: "0"
        };

        storage.mapPut("votes", tx.publisher, JSON.stringify(vote), tx.publisher);
    }

    _addVote(vote, voteAmt) {
        // claim all vote reward amount
        const rewardAmts = this._rewardAmount(vote, new BigNumber(vote.voteAmt));

        const new_voteAmt = new BigNumber(vote.voteAmt).plus(voteAmt);
        const new_voteTotal = new BigNumber(vote.voteTotal).plus(voteAmt);
        const new_rewardIost = new BigNumber(vote.rewardIost).plus(rewardAmts[0]);
        const new_claimIost = new BigNumber(vote.claimIost).plus(rewardAmts[0]);
        const new_rewardIdrag = new BigNumber(vote.rewardIdrag).plus(rewardAmts[1]);
        const new_claimIdrag = new BigNumber(vote.claimIdrag).plus(rewardAmts[1]);

        vote.voteBlock = block.number;
        vote.voteAmt = new_voteAmt.toString();
        vote.voteTotal = new_voteTotal.toString();
        vote.rewardIost = this._toFixed(new_rewardIost);
        vote.claimIost = this._toFixed(new_claimIost);
        vote.rewardIdrag = this._toFixed(new_rewardIdrag);
        vote.claimIdrag = this._toFixed(new_claimIdrag);

        storage.mapPut("votes", tx.publisher, JSON.stringify(vote), tx.publisher);
    }

    // vote(voter, nodeAccount, amount)
    vote(amount) {
        this._requireAuth(tx.publisher);

        this._whenNotPaused();

        const voteAmt = new BigNumber(new BigNumber(amount).toFixed(0));
        if (voteAmt.isZero()) {
            throw "invalid vote amount"
        }

        const voter = tx.publisher;

        blockchain.callWithAuth("vote_producer.iost", "vote", [voter, NODE_ACCOUNT, voteAmt.toFixed(0)]);

        if (!storage.mapHas("votes", tx.publisher)) {
            this._newVote(voteAmt);
            return;
        }

        const vote = this._getVote(voter);
        this._addVote(vote, voteAmt);
    }

    // unvote(voter, nodeAccount, amount)
    unvote() {
        this._requireAuth(tx.publisher);
        
        this._whenNotPaused();

        const voter = tx.publisher;

        if (!storage.mapHas("votes", voter)) {
            throw "vote is not exist";
        }

        const vote = this._getVote(voter);
        const unvoteAmt = new BigNumber(vote.voteAmt);
        if (unvoteAmt.isZero()) {
            throw "unvote amount is zero"
        }

        const rewardAmts = this._rewardAmount(vote, unvoteAmt);

        const new_rewardIost = new BigNumber(vote.rewardIost).plus(rewardAmts[0]);
        const new_claimIost = new BigNumber(vote.claimIost).plus(rewardAmts[0]);
        const new_rewardIdrag = new BigNumber(vote.rewardIdrag).plus(rewardAmts[1]);
        const new_claimIdrag = new BigNumber(vote.claimIdrag).plus(rewardAmts[1]);

        vote.voteAmt = "0";
        vote.rewardIost = "0";
        vote.claimIost = this._toFixed(new_claimIost);
        vote.rewardIdrag = "0";
        vote.claimIdrag = this._toFixed(new_claimIdrag);

        storage.mapPut("votes", voter, JSON.stringify(vote), voter);

        blockchain.callWithAuth("vote_producer.iost", "unvote", [voter, NODE_ACCOUNT, unvoteAmt.toFixed(0)]);

        const remark = `voteBlock:${vote.voteBlock} claimblock:${block.number} voteAmt:${unvoteAmt.toString()} days:${rewardAmts[2]}`;

        const send_rewardIost = new BigNumber(this._toFixed(new_rewardIost));
        if (send_rewardIost.gt(0)) {
            const balance = blockchain.call("token.iost", "balanceOf", ["iost", blockchain.contractName()]);
            if (!new BigNumber(balance[0]).gte(send_rewardIost)) {
                throw "insufficient balance iost";
            }

            blockchain.callWithAuth("token.iost", "transfer", ["iost", blockchain.contractName(), voter, send_rewardIost.toString(),
                `unvote ${remark}`]);
        }

        const send_rewardIdrag = new BigNumber(this._toFixed(new_rewardIdrag));
        if (send_rewardIdrag.gt(0)) {
            const balance = blockchain.call("token.iost", "balanceOf", [MEME_SYMBOL, blockchain.contractName()]);
            if (!new BigNumber(balance[0]).gte(send_rewardIdrag)) {
                throw `insufficient balance ${MEME_SYMBOL}`;
            }
            blockchain.callWithAuth("token.iost", "transfer", [MEME_SYMBOL, blockchain.contractName(), voter, send_rewardIdrag.toString(),
                `unvote ${remark}`]);
        }
    }
}

module.exports = MemeRestakeContract;
