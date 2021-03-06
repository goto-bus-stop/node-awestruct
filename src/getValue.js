'use strict'

const dlv = require('dlv')

/**
 * @param {Object} struct Object to find a value on.
 * @param {*}      value  Value to find. If a string, used as a path inside the `struct`. If a function, gets called with `this = struct`. Else, used unchanged as the value.
 * @return {*}
 */
module.exports = function getValue (struct, value) {
  // key path inside the `struct`
  if (typeof value === 'string') {
    // ../ moves to a "parent" struct
    while (value.indexOf('../') === 0) {
      if (struct.$parent === null) {
        throw new Error('cannot access nonexistent parent')
      }
      struct = struct.$parent
      value = value.substr(3)
    }
    return dlv(struct, value)
  } else if (typeof value === 'function') {
    return value.call(struct, struct)
  }
  return value
}
