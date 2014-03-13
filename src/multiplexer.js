"use strict";

const bluebird = require("bluebird");
const EventEmitter = require("events").EventEmitter;
const util = require("util");
const _ = require("underscore");
const SkipList = require("./skiplist");

function bucketTime(time) {
    return Math.floor(time / 1000) * 1000;
}

const Multiplexer = function(conn, dispatch) {
    const self = this;

    self.pending = new Map();
    self.expireBuckets = new SkipList();
    self.conn = conn;
    self.dispatch = dispatch;
    self.expireId = setInterval(self.expire.bind(self), 250);
    self.conn.on("message", self.onMessage.bind(self));
};

util.inherits(Multiplexer, EventEmitter);

_.extend(Multiplexer.prototype, {
    conn: null,
    dispatch: null,
    id: 0,
    pending: null,
    expireBuckets: null,

    send: function(message, opts) {
        const self = this;
        const d = bluebird.defer();
        const now = Date.now();
        const maxAge = opts && opts.maxAge || 10000;
        const timeBucket = bucketTime(now + maxAge);
        const messageData = {
            message: message,
            time: now,
            expires: now + maxAge,
            deferable: d,
            id: self.id++
        };
        const bucket = self.expireBuckets.get(timeBucket);

        self.pending.set(messageData.id, messageData);

        if (!bucket) {
            const newBucket = [messageData];

            self.expireBuckets.set(timeBucket, newBucket);
        } else {
            bucket.push(messageData);
        }

        self.conn.send(JSON.stringify([messageData.id, null, false, message]));

        return d.promise;
    },

    onMessage: function(data) {
        const self = this;
        const message = JSON.parse(data);

        if (message[1] !== null) {
            const pending = self.pending.get(message[1]);

            if (!pending) {
                return self.emit("error", "unexpectedReply", message);
            }

            self.pending.delete(message[1]);

            const timeBucket = bucketTime(pending.expires);
            const bucket = self.expireBuckets.get(timeBucket);
            const idx = bucket.indexOf(pending);

            bucket.splice(idx, 1);

            if (message[2]) {
                pending.deferable.resolve(message[3]);
            } else {
                pending.deferable.reject(message[3]);
            }
        } else {
            const id = self.id++;
            const promise = self.dispatch(message[3]);

            if (promise) {
                promise.then(function(v) {
                    self.conn.send(JSON.stringify([id, message[0], true, v]));
                }).catch(function(e) {
                    self.conn.send(JSON.stringify([id, message[0], false, e]));
                });
            }
        }
    },

    expire: function() {
        const self = this;
        const now = Date.now();
        const nowBucket = bucketTime(now);
        const removeBuckets = [];

        self.expireBuckets.forEach(function(timeBucket, bucket) {
            if (timeBucket > nowBucket) {
                throw new SkipList.StopIteration();
            }

            if (bucket.length === 0) {
                removeBuckets.push(timeBucket);
            } else {
                const removeMessages = new Set();

                for (let i = 0; i < bucket.length; i++) {
                    const messageData = bucket[i];

                    if (messageData.expires >= now) {
                        messageData.deferable.reject(new Error("expired"));
                        self.pending.delete(messageData.id);
                        removeMessages.add(messageData.id);
                    }
                }

                bucket.splice.apply(bucket, [0, bucket.length].concat(bucket.filter(function(v) {
                    return !removeMessages.has(v);
                })));
            }
        });
    }
});

module.exports = Multiplexer;
