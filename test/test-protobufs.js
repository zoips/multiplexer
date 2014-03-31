"use strict";

const assert = require("assert");
const bluebird = require("bluebird");
const protobufjs = require("protobufjs");
const util = require("util");
const EventEmitter = require("events").EventEmitter;
const _ = require("underscore");
const Multiplexer = require("../src/multiplexer");

function FakeWsConn() {

}

util.inherits(FakeWsConn, EventEmitter);

_.extend(FakeWsConn.prototype, {
    remote: null,

    send: function(message, flags) {
        const self = this;

        process.nextTick(function() {
            self.remote.emit("message", message, flags);
        });
    }
});

describe("Multiplexer", function() {
    let localConn;
    let remoteConn;
    let local;
    let remote;
    let proto;

    before(function() {
        localConn = new FakeWsConn();
        remoteConn = new FakeWsConn();

        localConn.remote = remoteConn;
        remoteConn.remote = localConn;

        proto = protobufjs.loadProtoFile("test/test.proto");
        local = new Multiplexer(localConn, { protobufs: proto });
        remote = new Multiplexer(remoteConn, { protobufs: proto });
    });

    afterEach(function() {
        local.removeAllListeners("message");
        remote.removeAllListeners("message");
    });

    it("can send a protobuf encoded message", function(done) {
        bluebird.coroutine(function*() {
            try {
                let TestNS = proto.build("TestNS");
                let testMessage = new TestNS.TestMessage({
                    "foo": "this is sparta!"
                });

                remote.on("message", function(message, d) {
                    assert.deepEqual(message, testMessage);

                    d.resolve(message);
                });

                const promise = local.send(testMessage);
                const message = yield promise;

                assert.deepEqual(message, testMessage);

                done(null);
            } catch (ex) {
                done(ex);
            }
        })();
    });

    it("can bind events via listen", function(done) {
        bluebird.coroutine(function*() {
            try {
                let TestNS = proto.build("TestNS");
                let testMessage = new TestNS.TestMessage({
                    "foo": "this is sparta!"
                });
                const t = {};
                const messages = {
                    ".TestNS.TestMessage": bluebird.coroutine(function*(message) {
                        assert.deepEqual(message, testMessage);

                        return message;
                    })
                };

                remote.listen(t, messages);

                const promise = local.send(testMessage);
                const message = yield promise;

                assert.deepEqual(message, testMessage);

                done(null);
            } catch (ex) {
                done(ex);
            }
        })();
    });
});
