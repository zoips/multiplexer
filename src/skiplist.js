"use strict";

var LEVEL_PROBABILITY = 0.5;

function SkipListNode(level, key, value) {
    const self = this;

    self.level = level;
    self.key = key;
    self.value = value;
    self.skip = [];
}

SkipListNode.prototype = {
    level: 0,
    key: null,
    value: null,
    skip: null
};

function randomLevel(maxLevel) {
    var level = 0;

    while (Math.random() < LEVEL_PROBABILITY && level < maxLevel) {
        level++;
    }

    return level;
}

function findNode(self, node, key, fn) {
    for (let i = self._level; i >= 0; i--) {
        while (node.skip[i] &&
            /* nodes are ordered by their key in the skip list */
            node.skip[i].key < key) {
            node = node.skip[i];
        }

        if (fn) {
            fn(node);
        }
    }

    return node.skip[0];
}

function SkipList(opts) {
    const self = this;

    self._level = 0;
    self._length = 0;
    self._maxLevel = opts && opts.maxLevel || 16;
    self._head = new SkipListNode(self._maxLevel, null, null);
}

SkipList.prototype = {
    _level: 0,
    _length: 0,
    _maxLevel: 16,
    _head: null,

    get length() {
        return this._length;
    },

    set: function(key, value) {
        const self = this;
        const updates = [];
        let node = self._head;
        let level;
        let i;

        i = self._level;

        findNode(self, node, key, function(node) {
            updates[i--] = node;
        });

        // if node is NULL we're at the end of the list. If they are equal then
        // it is a duplicate key */
        if (!node || node.key !== key) {
            level = randomLevel(self._maxLevel);

            // if the level is greater than the current skiplist level we have to
            // update the corresponding skips on head to point to the new node */
            if (level > self._level) {
                for (i = self._level + 1; i <= level; i++) {
                    updates[i] = self._head;
                }

                self._level = level;
            }

            node = new SkipListNode(level, key, value);

            // update all the skips to the node
            for (i = 0; i <= level; i++) {
                node.skip[i] = updates[i].skip[i];
                updates[i].skip[i] = node;
            }

            self._length++;
        }
    },

    remove: function(key) {
        const self = this;
        const updates = [];
        let i = self._level;
        let node = self._head;

        node = findNode(self, node, key, function(node) {
            updates[i--] = node;
        });

        if (node.key === key) {
            // update all the skips that went to this node
            for (i = 0; i <= self._level; i++) {
                if (updates[i].skip[i] !== node) {
                    break;
                }

                updates[i].skip[i] = node.skip[i];
            }
            // reduce the level of the skiplist until it matches the tallest
            // node
            while (self._level > 0 && !self._head.skip[self.level]) {
                self._level--;
            }

            self._length--;
        }
    },

    get: function(key) {
        const self = this;
        let undef;
        let node = self._head;

        node = findNode(self, node, key);

        if (node && node.key === key) {
            return node.value;
        } else {
            return undef;
        }
    },

    forEach: function(fn) {
        for (let node = this._head.skip[0]; node != null; node = node.skip[0]) {
            try {
                fn(node.key, node.value);
            } catch (ex) {
                if (ex instanceof SkipList.StopIteration) {
                    break;
                } else {
                    throw ex;
                }
            }
        }
    }
};

SkipList.StopIteration = function() {

};

module.exports = SkipList;
