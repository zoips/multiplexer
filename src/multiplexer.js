"use strict";

const bluebird = require("bluebird");
const EventEmitter = require("events").EventEmitter;
const protobufjs = require("protobufjs");
const util = require("util");
const _ = require("underscore");
const SkipList = require("./skiplist");

/**
 * Buckets time into 1 second intervals.
 *
 * @param time
 * @returns {number}
 */
function bucketTime(time) {
    return Math.floor(time / 1000) * 1000;
}

/**
 * The Protobuf wire protocol.
 */
const WIRE_PROTOS = protobufjs.loadProtoFile(__dirname + "/wire.proto");

/**
 * Create a new Multiplexer on top of an event emitter that emits message events. A normal use case is on top of a
 * Websocket.
 *
 * The normal message passing scheme is via serialized JSON. However, you can also pass Protobuf messages using the
 * ProtobufJS library. To use Protobufs, you need to load the Protobuf schema and pass them in via opts.protobufs.
 *
 * JSON message passing format:
 *
 * [id, requestId, success, message]
 *   id: this message ID
 *   requestId: the ID of the message this is a response to, null otherwise
 *   success: if this message is a success message or an error message (true: success, false: error)
 *   message: message object
 *
 * Protobuf message passing format: see src/wire.proto
 *
 * Opts:
 *
 * {
 *     protobufs: Object
 * }
 *
 * @param conn connection
 * @param opts
 * @constructor
 */
const Multiplexer = function(conn, opts) {
    const self = this;

    self.pending = new Map();
    self.expireBuckets = new SkipList();
    self.conn = conn;
    self.expireId = setInterval(self.expire.bind(self), 250);
    self.conn.on("message", self.onMessage.bind(self));

    if (opts) {
        if (opts.protobufs) {
            self.protobufs = opts.protobufs;
        }

        if (opts.errorMapper) {
            self.errorMapper = opts.errorMapper;
        }
    }
};

util.inherits(Multiplexer, EventEmitter);

_.extend(Multiplexer.prototype, {
    conn: null,
    dispatch: null,
    id: 0,
    pending: null,
    expireBuckets: null,
    protobufs: null,
    errorMapper: null,

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

        if (self.protobufs !== null) {
            self.conn.send(encodeWireContainer(messageData.id, null, false, message),
                { binary: true });
        } else {
            self.conn.send(JSON.stringify([messageData.id, null, false, message]));
        }

        return d.promise;
    },

    listen: function(target, messages, opts) {
        const self = this;

        self.on("message", listener.bind(self, target, messages, opts));
    },

    onMessage: function(data, flags) {
        const self = this;
        let message;

        if (self.protobufs !== null && flags.binary) {
            message = decodeWireContainer(self.protobufs, data);
        } else {
            message = JSON.parse(data);
        }

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
                let err = message[3];

                if (self.protobufs === null) {
                    err = new Error(message[3]);

                    // copy over all properties onto the error object
                    Object.keys(message[3]).reduce(function (obj, k) {
                        obj[k] = message[3][k];
                        return obj;
                    }, err);
                }

                if (self.errorMapper) {
                    err = self.errorMapper(err);
                }

                pending.deferable.reject(err);
            }
        } else {
            const id = self.id++;
            const d = bluebird.defer();

            d.promise.then(function(v) {
                if (self.protobufs !== null) {
                    self.conn.send(encodeWireContainer(id, message[0], true, v),
                        { binary: true });
                } else {
                    self.conn.send(JSON.stringify([id, message[0], true, v]));
                }
            }).catch(function(e) {
                if (self.protobufs !== null) {
                    self.conn.send(encodeWireContainer(id, message[0], false, e),
                        { binary: true });
                } else {
                    const err = {
                        stack: e.stack,
                        message: e.message
                    };

                    // copy over all enumerable properties onto the message error object
                    Object.keys(e).reduce(function(obj, k) {
                        obj[k] = e[k];
                        return obj;
                    }, err);

                    self.conn.send(JSON.stringify([id, message[0], false, err]));
                }
            });

            self.emit("message", message[3], d);
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

const encodeWireContainer = function(id, reqId, success, message) {
    const Container = WIRE_PROTOS.build("Multiplexer.Wire.Container");
    const wireContainer = new Container({
        id: id,
        type: Object.getPrototypeOf(message).toString.call(message),
        reqId: reqId,
        success: success,
        body: message.encode().toBuffer()
    });

    return wireContainer.encode().toBuffer();
};

const decodeWireContainer = function(protobufs, data) {
    const wireContainer = WIRE_PROTOS.build("Multiplexer.Wire.Container").decode(data);
    const type = protobufs.lookup(wireContainer.type);

    if (type === null) {
        throw new Error("Could not locate " + wireContainer.type);
    }

    const embeddedMessage = type.clazz.decode(wireContainer.body);
    const message = [wireContainer.id, wireContainer.reqId, wireContainer.success, embeddedMessage];

    return message;
};

const listener = function(target, messages, opts, message, d) {
    const self = this;
    let handler;

    if (self.protobufs !== null) {
        handler = messages[Object.getPrototypeOf(message).toString()];
    } else {
        handler = messages[message.type];
    }

    if (typeof handler === "function") {
        const promise = handler.call(target, message);

        promise.then(function(v) {
            d.resolve(v);
        }).catch(function(e) {
            if (opts && opts.errorMapper) {
                e = opts.errorMapper(e);
            } else if (self.errorMapper) {
                e = self.errorMapper(e);
            }

            d.reject(e);
        });
    }
};

module.exports = Multiplexer;
