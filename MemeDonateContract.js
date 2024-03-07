/// meme donate contract

// meme token
const MEME_SYMBOL = "tdsu"
const MEME_DECIMAL = 6;

// donate config
const DONATE_AMOUNT_TOTAL = 4000; // 40000000
const DONATE_AMOUNT_MIN = 100;
const PER_DONATE = 250;
// DONATE_MEME 1000000
const DONATE_IOST_WALLET = "tuser1";
// airdrop config
const AIRDROP_AMOUNT_TOTAL = 20000; // 200000000
const AIRDROP_DAYS = 30; // 8 * 30

// const SECOND_PER_DAY = 60 * 60 * 24;
const SECOND_PER_DAY = 60 * 60; // test day=60min


class MemeDonateContract {
    init() {
        storage.put("is_pause", "0");       // project is pause 1=pause

        storage.put("donate_count", "0");   // donate account count
        storage.put("donated_amount", "0"); // donated amount total

        storage.put("can_airdrop", "0");    // user can airdrop 1=can
        storage.put("airdrop_amount", "0"); // calc airdrop amount
    }

    can_update(data) {
        return blockchain.requireAuth(blockchain.contractOwner(), "active");
    }

    _requireAuth(account) {
        if (!blockchain.requireAuth(account, "active")) {
            throw 'require auth failed';
        }
    }

    _todayZeroSec() {
        const sec = Math.floor(tx.time / 1e9);
        const zeroSec = sec - sec % SECOND_PER_DAY;
        return zeroSec;
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

        if (!(value == "0" || value == "1")) {
            throw "invalid value";
        }

        storage.put("is_pause", value, tx.publisher);
    }

    canAirdrop(value) {
        this._onlyOwner();

        if (!(value == "1" || value == "0")) {
            throw "invalid value";
        }

        storage.put("can_airdrop", value, tx.publisher);
    }

    calcAidropAmt() {
        this._onlyOwner();

        const donateCount = new BigNumber(storage.get("donate_count") || 0);
        if (donateCount.isZero()) {
            throw "donate count is zero";
        }
        const amount = new BigNumber(AIRDROP_AMOUNT_TOTAL).div(new BigNumber(AIRDROP_DAYS)).div(donateCount);

        storage.put("airdrop_amount", this._toFixed(amount), tx.publisher);
    }

    donate(amount) {
        this._requireAuth(tx.publisher);
        
        this._whenNotPaused();

        const iostAmt = new BigNumber(amount);
        if (iostAmt.isZero()) {
            throw "invalid iost amount";
        }

        const depositAmt = new BigNumber(DONATE_AMOUNT_MIN);
        if (!iostAmt.gte(depositAmt)) {
            throw "invalid donate amount";
        }

        const balance = blockchain.call("token.iost", "balanceOf", ["iost", tx.publisher]);
        if (!new BigNumber(balance[0]).gte(depositAmt)) {
            throw "insufficient balance";
        }

        const donatedAmt = new BigNumber(storage.get("donated_amount"));
        const donateTotal = new BigNumber(DONATE_AMOUNT_TOTAL);
        const donateBalance = donateTotal.minus(donatedAmt);
        if (donateBalance.isZero()) {
            throw "donation completed";
        }

        let iostRealAmt = new BigNumber(iostAmt.toFixed(0));
        if (iostRealAmt.gt(donateBalance)) {
            iostRealAmt = donateBalance;
        }
        const memeAmt = iostRealAmt.times(new BigNumber(PER_DONATE));

        if (!donatedAmt.plus(iostRealAmt).lte(donateTotal)) {
            throw "amount is too large";
        }

        blockchain.transfer(tx.publisher, DONATE_IOST_WALLET, iostRealAmt.toFixed(0), "donate");

        blockchain.callWithAuth("token.iost", "transfer", [MEME_SYMBOL, blockchain.contractName(), tx.publisher, memeAmt.toFixed(0), "donate"]);

        if (!storage.mapHas("donate", tx.publisher)) {
            const count = new Int64(storage.get("donate_count"));
            storage.put("donate_count", count.plus(1).toString(), tx.publisher);

            storage.mapPut("donate", tx.publisher, "1", tx.publisher);
        }

        storage.put("donated_amount", donatedAmt.plus(iostRealAmt).toString(), tx.publisher);

        let memeDonateTotal = memeAmt;
        if (storage.mapHas("meme_donate", tx.publisher)) {
            memeDonateTotal = new BigNumber(storage.mapGet("meme_donate", tx.publisher)).plus(memeDonateTotal);
        }
        storage.mapPut("meme_donate", tx.publisher, this._toFixed(memeDonateTotal), tx.publisher);

        let iostDonateTotal = iostRealAmt;
        if (storage.mapHas("iost_donate", tx.publisher)) {
            iostDonateTotal = new BigNumber(storage.mapGet("iost_donate", tx.publisher)).plus(iostDonateTotal);
        }
        storage.mapPut("iost_donate", tx.publisher, this._toFixed(iostDonateTotal), tx.publisher);
    }

    airdrop() {
        this._requireAuth(tx.publisher);

        this._whenNotPaused();

        if (storage.get("can_airdrop") != "1") {
            throw "The airdrop did not begin";
        }

        if (!storage.mapHas("donate", tx.publisher)) {
            throw "You didn't donate";
        }

        const todayZero = new BigNumber(this._todayZeroSec());
        const tomorrowZero = todayZero.plus(new BigNumber(SECOND_PER_DAY));
        if (storage.mapHas("airdrop_time", tx.publisher)) {
            const nextTime = new BigNumber(storage.mapGet("airdrop_time", tx.publisher) || 0);
            if (nextTime.gt(0) && nextTime.eq(tomorrowZero)) {
                throw "Please airdrop back tomorrow";
            }
        }

        const amount = new BigNumber(storage.get("airdrop_amount"));
        if (amount.isZero()) {
            throw "Please calculate airdrop amount";
        }

        const balance = blockchain.call("token.iost", "balanceOf", [MEME_SYMBOL, blockchain.contractName()]);
        if (!new BigNumber(balance[0]).gte(amount)) {
            throw "insufficient balance";
        }

        blockchain.callWithAuth("token.iost", "transfer", [MEME_SYMBOL, blockchain.contractName(), tx.publisher, this._toFixed(amount), "airdrop"]);

        storage.mapPut("airdrop_time", tx.publisher, tomorrowZero.toString(), tx.publisher);

        let memeAirdropTotal = amount;
        if (storage.mapHas("meme_airdrop", tx.publisher)) {
            memeAirdropTotal = new BigNumber(storage.mapGet("meme_airdrop", tx.publisher)).plus(memeAirdropTotal);
        }
        storage.mapPut("meme_airdrop", tx.publisher, this._toFixed(memeAirdropTotal), tx.publisher);
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

module.exports = MemeDonateContract;
