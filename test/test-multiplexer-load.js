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

    this.timeout(30000);

    before(function() {
        localConn = new FakeWsConn();
        remoteConn = new FakeWsConn();

        localConn.remote = remoteConn;
        remoteConn.remote = localConn;

        local = new Multiplexer(localConn);
        remote = new Multiplexer(remoteConn);
    });

    afterEach(function() {
        local.removeAllListeners("message");
        remote.removeAllListeners("message");
    });

    it("load test", function(done) {
        bluebird.coroutine(function*() {
            remote.on("message", function(message, d) {
                const sleep = Math.floor(Math.random() * 90) + 10;

                setTimeout(function() {
                    d.resolve(message + "!");
                }, sleep);
            });

            const promises = [];

            for (let i = 0; i < 100000; i++) {
                promises.push(bluebird.coroutine(function*(i) {
                    const v = yield local.send("message " + i);

                    assert.equal(v, "message " + i + "!");
                })(i));

                if (i % 1000 === 0) {
                    yield bluebird.delay(1);
                }
            }

            yield promises;

            done();
        })();
    });
});
