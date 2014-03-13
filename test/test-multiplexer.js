"use strict";

const assert = require("assert");
const bluebird = require("bluebird");
const util = require("util");
const EventEmitter = require("events").EventEmitter;
const _ = require("underscore");
const Multiplexer = require("../src/multiplexer");

function FakeWsConn() {

}

util.inherits(FakeWsConn, EventEmitter);

_.extend(FakeWsConn.prototype, {
    remote: null,

    send: function(message) {
        const self = this;

        process.nextTick(function() {
            self.remote.emit("message", message);
        });
    }
});

describe("Multiplexer", function() {
    let localConn;
    let remoteConn;
    let local;
    let remote;

    before(function() {
        localConn = new FakeWsConn();
        remoteConn = new FakeWsConn();

        localConn.remote = remoteConn;
        remoteConn.remote = localConn;

        local = new Multiplexer(localConn);
        remote = new Multiplexer(remoteConn);
    });

    it("can send a message from local to remote and get the response", function(done) {
        bluebird.coroutine(function*() {
            try {
                const testObj = {
                    "foo": "bar"
                };

                remote.dispatch = function(message) {
                    assert.deepEqual(message, testObj);

                    const d = bluebird.defer();

                    d.resolve(message);

                    return d.promise;
                };

                const promise = local.send(testObj);
                const message = yield promise;

                assert.deepEqual(message, testObj);

                done(null);
            } catch (ex) {
                done(ex);
            }
        })();
    });

    it("it propagates rejects as errors", function(done) {
        bluebird.coroutine(function*() {
            try {
                const testObj = {
                    "foo": "baz"
                };

                remote.dispatch = function(message) {
                    assert.deepEqual(message, testObj);

                    const d = bluebird.defer();

                    d.reject(new Error("oh hey"));

                    return d.promise;
                };

                const promise = local.send(testObj);

                try {
                    yield promise;

                    done(new Error("Did not get an exception"));
                } catch (ex) {
                    done(null);
                }
            } catch (ex) {
                done(ex);
            }
        })();
    });

    it("can send multiple messages and receive all the responses", function(done) {
        bluebird.coroutine(function*() {
            try {
                remote.dispatch = function(message) {
                    const d = bluebird.defer();

                    process.nextTick(function() {
                        d.resolve(message + "!");
                    });

                    return d.promise;
                };

                const promises = [];

                for (let i = 0; i < 10; i++) {
                    promises.push(local.send("message " + i));
                }

                const responses = yield promises;
                const s = new Set();

                for (let i = 0; i < responses.length; i++) {
                    s.add(responses[i]);
                }

                for (let i = 0; i < promises.length; i++) {
                    assert.ok(s.has("message " + i + "!"));
                }

                done(null);
            } catch (ex) {
                done(ex);
            }
        })();
    });

    it("can timeout messages", function(done) {
        this.timeout(5000);

        bluebird.coroutine(function*() {
            try {
                remote.dispatch = function(message) {
                    const d = bluebird.defer();

                    setTimeout(function() {
                        d.resolve(message + "!");
                    }, 3000);

                    return d.promise;
                };

                yield local.send("asdfasdf", { maxAge: 500 });

                done(new Error("did not expire"));
            } catch (ex) {
                if (ex.message === "expired") {
                    done(null);
                } else {
                    done(ex);
                }
            }
        })();
    });
});
