/// meme pool contract

// meme token
const MEME_SYMBOL = "tdsu"
const MEME_DECIMAL = 6;

const PER_BOOST = new BigNumber(100); // 1000000
const UPDATOR = "3a8phd2kys4";

// # pool
// [token] => {
//   stakeTotal: "0", // all users staked token total amount
//   tokenDecimal: 0, // token decimal
//   lastHeight: 0, // last reward block number
//   perShare: "0", // per share reward amount
//   perBlock: "0", // per block reward amount
// }

class MemePoolContract {
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

    // pool
    _hasPool(token_pool) {
        return storage.mapHas("pool", token_pool);
    }

    _requirePool(token_pool) {
        if (!this._hasPool(token_pool)) {
            throw "token pool not exists"
        }
    }

    _getPool(token_pool) {
        return JSON.parse(storage.mapGet("pool", token_pool) || "{}");
    }

    getPool(token_pool) {
        return this._getPool(token_pool);
    }

    // stake
    _stakeKey(token_pool) {
        return `stake${token_pool}`;
    }

    _hasStake(token_pool) {
        return storage.mapHas(this._stakeKey(token_pool), tx.publisher);
    }

    _requireStake(token_pool) {
        if (!this._hasStake(token_pool)) {
            throw "not stake"
        }
    }

    _getStake(token_pool) {
        return JSON.parse(storage.mapGet(this._stakeKey(token_pool), tx.publisher) || "{}");
    }

    getStake(token_pool) {
        return this._getStake(token_pool);
    }

    // preshare -> token_pool -> tx.publisher
    // endblock + token_pool -> tx.publisher -> endBlock

    _getPershare(token_pool) {
        let accounts = [];
        if (storage.mapHas("preshare", token_pool)) {
            accounts = JSON.parse(storage.mapGet("preshare", token_pool));
        }
        return accounts;
    }

    _newPreshare(token_pool, endBlock) {
        let accounts = this._getPershare(token_pool);
        accounts.push(`${tx.publisher}:${endBlock}`);
        storage.mapPut("preshare", token_pool, JSON.stringify(accounts), tx.publisher);
    }

    _addPreShare(token_pool, endBlock) {
        let accounts = this._getPershare(token_pool);
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i].split(":")[0];
            if (account == tx.publisher) {
                accounts.splice(i, 1);
                break;
            }
        }

        accounts.push(`${tx.publisher}:${endBlock}`);
        storage.mapPut("preshare", token_pool, JSON.stringify(accounts), tx.publisher);
    }

    // only owner create stake pool
    addPool(token_pool, decimal, addEndBlock, perBlockAmt) {
        this._onlyOwner();

        if (this._hasPool(token_pool)) {
            throw "token pool already exists";
        }

        decimal = Number(decimal);
        if (decimal < 0 || decimal > 18) {
            throw "invalid decimal";
        }

        const endBlock = new BigNumber(addEndBlock);
        if (endBlock.isZero()) {
            throw "invalid endBlock";
        }
        const blockNumber = new BigNumber(block.number);

        const pool = {
            tokenDecimal: decimal,
            stakeTotal: "0",
            endBlock: endBlock.toFixed(0),
            lastBlock: blockNumber.toFixed(0),
            perShareAmt: "0",
            perBlockAmt: perBlockAmt,
        }
        storage.mapPut("pool", token_pool, JSON.stringify(pool), tx.publisher);
    }

    // perShareAmt & isEndBlock
    _calcPerShareAmt(pool) {
        const stakeTotal = new BigNumber(pool.stakeTotal);
        if (stakeTotal.isZero()) {
            return "0";
        }
        const perShare = new BigNumber(pool.perBlockAmt).times(PER_BOOST).div(stakeTotal);
        const perShareAmt = this._toFixed(perShare);
        return perShareAmt;
    }

    _claim(pool, stake, unstakeAmt) {
        let rewardAmt = new BigNumber(0);
        const blockNumber = new BigNumber(block.number);
        const stakeBlock = new BigNumber(stake.stakeBlock);
        const endBlock = new BigNumber(stake.endBlock);
        let stakeTime = new BigNumber(0);

        if (blockNumber.lte(endBlock)) {
            // stake is not end
            stakeTime = blockNumber.minus(stakeBlock);
            const perShareAmt = new BigNumber(pool.perShareAmt).minus(new BigNumber(stake.perShareAmt));
            rewardAmt = perShareAmt.times(unstakeAmt).times(stakeTime).div(PER_BOOST);
        } else {
            // stake is end
            if (new BigNumber(stake.poolPerShareAmt).isZero()) {
                throw "poolPerShareAmt is zero";
            }
            stakeTime = endBlock.minus(stakeBlock);
            const perShareAmt = new BigNumber(stake.poolPerShareAmt).minus(new BigNumber(stake.perShareAmt));
            rewardAmt = perShareAmt.times(unstakeAmt).times(stakeTime).div(PER_BOOST);
        }

        return rewardAmt;
    }

    _newStake(token_pool, pool, real_amt) {
        const stakeTotal = new BigNumber(pool.stakeTotal).plus(real_amt);
        pool.stakeTotal = this._toFixed(stakeTotal);
        pool.lastBlock = block.number;
        const stake_endBlock = new BigNumber(block.number).plus(new BigNumber(pool.endBlock));

        const stake = {
            stakeAmt: this._toFixed(real_amt),
            perShareAmt: "0",
            poolPerShareAmt: "0",
            stakeBlock: block.number,
            endBlock: stake_endBlock.toString(),
            stakeAmtTotal: this._toFixed(real_amt),
            rewardAmt: "0",
            rewardAmtTotal: "0"
        };

        // calc new perShareAmt
        const calcPerShareAmt = this._calcPerShareAmt(pool);
        const new_perShareAmt = new BigNumber(calcPerShareAmt);

        stake.perShareAmt = pool.perShareAmt;
        const new_shareAmt = new BigNumber(pool.perShareAmt).plus(new_perShareAmt);
        pool.perShareAmt = this._toFixed(new_shareAmt);

        storage.mapPut("pool", token_pool, JSON.stringify(pool), tx.publisher);

        storage.mapPut(this._stakeKey(token_pool), tx.publisher, JSON.stringify(stake), tx.publisher);

        this._newPreshare(token_pool, stake_endBlock.toString());
    }

    _addStake(token_pool, pool, real_amt) {
        const new_stakeTotal = new BigNumber(pool.stakeTotal).plus(real_amt);
        pool.stakeTotal = this._toFixed(new_stakeTotal);
        pool.lastBlock = block.number;

        // last stake amount
        let stake = this._getStake(token_pool);

        // claim all stake amount
        const claimAmt = this._claim(pool, stake, new BigNumber(stake.stakeAmt));

        // calc new perShareAmt
        const calcPerShareAmt = this._calcPerShareAmt(pool);
        const new_perShareAmt = new BigNumber(calcPerShareAmt);

        stake.perShareAmt = pool.perShareAmt;
        stake.poolPerShareAmt = "0";
        const new_shareAmt = new BigNumber(pool.perShareAmt).plus(new_perShareAmt)
        pool.perShareAmt = this._toFixed(new_shareAmt);

        const new_stakeAmt = new BigNumber(stake.stakeAmt).plus(real_amt);
        const new_stakeAmtTotal = new BigNumber(stake.stakeAmtTotal).plus(real_amt);
        const new_rewardAmt = new BigNumber(stake.rewardAmt).plus(claimAmt);
        const new_rewardAmtTotal = new BigNumber(stake.rewardAmtTotal).plus(claimAmt);
        const stake_endBlock = new BigNumber(block.number).plus(new BigNumber(pool.endBlock));

        stake.stakeAmt = this._toFixed(new_stakeAmt);
        stake.stakeAmtTotal = this._toFixed(new_stakeAmtTotal);
        stake.rewardAmt = this._toFixed(new_rewardAmt);
        stake.rewardAmtTotal = this._toFixed(new_rewardAmtTotal);
        stake.stakeBlock = block.number;
        stake.endBlock = stake_endBlock.toString();

        storage.mapPut("pool", token_pool, JSON.stringify(pool), tx.publisher);

        storage.mapPut(this._stakeKey(token_pool), tx.publisher, JSON.stringify(stake), tx.publisher);

        this._addPreShare(token_pool, stake_endBlock.toString());
    }

    // add token to stake
    // grant previous interest
    stake(token_pool, amount) {
        this._requireAuth(tx.publisher);

        this._whenNotPaused();

        this._requirePool(token_pool);

        const pool = this._getPool(token_pool);

        // deposit meme real amount
        const real_amt = new BigNumber(amount);
        if (real_amt.isZero()) {
            throw "invalid amount"
        }
        blockchain.callWithAuth("token.iost", "transfer", [MEME_SYMBOL, tx.publisher, blockchain.contractName(), this._toFixed(real_amt), "stake"]);

        // first stake
        if (!this._hasStake(token_pool)) {
            this._newStake(token_pool, pool, real_amt);
            return;
        }

        // add stake
        this._addStake(token_pool, pool, real_amt);
    }

    // withdraw token from pool
    // grant all interest
    unstake(token_pool) {
        this._requireAuth(tx.publisher);
        
        this._whenNotPaused();

        this._requireStake(token_pool);

        const pool = this._getPool(token_pool);
        const pool_perShareAmt = pool.perShareAmt;

        const stake = this._getStake(token_pool);
        const stake_perShareAmt = stake.perShareAmt;
        const last_stakeBlock = stake.stakeBlock;
        const curr_blockNumber = block.number;

        const unstakeAmt = new BigNumber(stake.stakeAmt);
        if (unstakeAmt.isZero()) {
            throw "unstake amount is zero"
        }

        if (token_pool != "idrag0") {
            if (new BigNumber(curr_blockNumber).lt(new BigNumber(stake.endBlock))) {
                throw "staking has not expired";
            }
        }

        // claim stake reward amount
        const claimAmt = this._claim(pool, stake, unstakeAmt);

        // pool.stakeTotal update
        const pool_stakeTotal = new BigNumber(pool.stakeTotal).minus(unstakeAmt);
        pool.stakeTotal = this._toFixed(pool_stakeTotal);

        // calc new perShareAmt
        const calcPerShareAmt = this._calcPerShareAmt(pool);
        const new_perShareAmt = new BigNumber(calcPerShareAmt);
        const curr_perShareAmt = pool.perShareAmt;
        const base_pool_perShareAmt = new BigNumber(pool.perShareAmt);
        pool.perShareAmt = this._toFixed(base_pool_perShareAmt.plus(new_perShareAmt));

        storage.mapPut("pool", token_pool, JSON.stringify(pool), tx.publisher);

        if (token_pool == "idrag0") {
            stake.perShareAmt = curr_perShareAmt;
        }
        let rewardAmt = new BigNumber(0);
        const _rewardAmt = new BigNumber(stake.rewardAmt);
        if (_rewardAmt.gt(0)) {
            rewardAmt = _rewardAmt;
            stake.rewardAmt = "0";
        }
        const new_rewardAmtTotal = new BigNumber(stake.rewardAmtTotal).plus(claimAmt);
        stake.rewardAmtTotal = this._toFixed(new_rewardAmtTotal);
        stake.stakeAmt = "0";
        storage.mapPut(this._stakeKey(token_pool), tx.publisher, JSON.stringify(stake), tx.publisher);

        const withdraw_amt = unstakeAmt.plus(claimAmt).plus(rewardAmt);
        let remark = `pool_perShare:${pool_perShareAmt} stake_perShare:${stake_perShareAmt} / last_stakeBlock:${last_stakeBlock} curr_blockNumber:${curr_blockNumber} `;
        remark = `${remark} / unstakeAmt: ${unstakeAmt} rewardAmt:${rewardAmt} claimAmt:${claimAmt}`;

        // widthdraw meme token
        blockchain.callWithAuth("token.iost", "transfer", [MEME_SYMBOL, blockchain.contractName(), tx.publisher, this._toFixed(withdraw_amt),
            `unstake ${remark}`]);
    }

    // admin update
    upPershare(token_pool) {
        if (!blockchain.requireAuth(UPDATOR, "active")) {
            throw "require auth error: not updator";
        }

        const curr_blockNumber = new BigNumber(block.number);

        let accounts = this._getPershare(token_pool);
        let acct_len = accounts.length;

        for (let i = 0; i < accounts.length; i++) {
            const acctData = accounts[i].split(":");
            const account = acctData[0];
            const acct_endblock = acctData[1];
            if (acct_endblock != "null") {
                const endblock = new BigNumber(acct_endblock);
                if (curr_blockNumber.gte(endblock)) {
                    // update current account stake endBlock of perShareAmt
                    const pool = this._getPool(token_pool);
                    const stake = JSON.parse(storage.mapGet(this._stakeKey(token_pool), account));

                    stake.poolPerShareAmt = pool.perShareAmt;
                    storage.mapPut(this._stakeKey(token_pool), account, JSON.stringify(stake), tx.publisher);

                    accounts.splice(i, 1);
                    i--;
                } else {
                    break;
                }
            }
        }

        if (acct_len != accounts.length) {
            storage.mapPut("preshare", token_pool, JSON.stringify(accounts), tx.publisher);
        }
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
}

module.exports = MemePoolContract;
