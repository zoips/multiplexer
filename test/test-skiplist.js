"use strict";

const assert = require("assert");
const SkipList = require("../src/skiplist");

function permute() {
    let str;
    let prefix;
    let permutations = [];

    if (arguments.length === 2) {
        prefix = arguments[0];
        str = arguments[1];
    } else {
        prefix = "";
        str = arguments[0];
    }

    if (str.length === 1) {
        permutations.push(prefix + str);
    } else {
        for (let i = 0; i < str.length; i++) {
            permutations = permutations.concat(permute(prefix + str.charAt(i), str.substring(0, i) + str.substring(i + 1, str.length)));
        }
    }

    return permutations;
}

function shuffle(list) {
    for (let i = 0; i < list.length; i++) {
        let n = Math.floor(Math.random() * list.length);
        let t = list[n];

        list[n] = list[i];
        list[i] = t;
    }

    return list;
}

describe("SkipList", function() {

    it("functions", function() {
        let undef;
        const list = new SkipList();
        const p = permute("abc");
        const p2 = shuffle([].concat(p));

        // add them all in in random order
        for (let i = 0; i < p2.length; i++) {
            list.set(p2[i], p2[i]);
        }

        // assert they are all there
        for (let i = 0; i < p.length; i++) {
            assert.equal(list.get(p[i]), p[i]);
        }

        // assert that the list can be iterated in order
        {
            let i = 0;

            list.forEach(function(v) {
                assert.equal(v, p[i]);
                i++;
            });
        }

        // remove elements
        for (let i = 0; i < p.length; i += 2) {
            list.remove(p[i]);
        }

        let pa = [];

        // assert they've been removed
        for (let i = 0; i < p.length; i++) {
            let v = list.get(p[i]);

            if (i % 2 === 0) {
                assert.equal(v, undef);
            } else {
                assert.equal(v, p[i]);
                pa.push(p[i]);
            }
        }

        // assert that the list can be iterated in order
        {
            let i = 0;

            list.forEach(function(v) {
                if (i % 2 !== 0) {
                    assert.equal(v, p[i]);
                }

                i += 2;
            });
        }

        const p3 = permute("agh");
        const p4 = shuffle([].concat(p3));
        const p5 = [].concat(pa, p3).sort();

        // add them all in in random order
        for (let i = 0; i < p4.length; i++) {
            list.set(p4[i], p4[i]);
        }

        // assert they are all there
        for (let i = 0; i < p5.length; i++) {
            assert.equal(list.get(p5[i]), p5[i]);
        }

        // assert that the list can be iterated in order
        {
            let i = 0;

            list.forEach(function(v) {
                assert.equal(v, p5[i]);
                i++;
            });
        }
    });
});
