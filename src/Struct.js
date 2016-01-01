import StructType from './StructType'

/**
 * @param {Object} descriptor Object describing this Struct, like `{ key: type, key2: type2 }`
 * @return {function()} Buffer decoding function, with StructType properties and an `.encode` method to encode Buffers.
 */
function Struct(descriptor) {
  let fields
  if (descriptor) {
    fields = Object.keys(descriptor).map(key => (
      { name: key, type: getType(descriptor[key]) }
    ))
  } else {
    fields = []
  }

  /**
   * Decodes a buffer into the object structure as described by this Struct.
   * @param {Object|Buffer} opts A Buffer to decode.
   */
  const decode = (opts, parent) => {
    const struct = {}
    // if there is a parent struct, then we need to start at some offset (namely where this struct starts)
    const subOpts = { struct, buf: opts.buf, offset: opts.offset || 0, parent: parent || null }

    // `struct` gets a temporary `.$parent` property so dependencies can travel up the chain, like in:
    // ```
    // Struct({
    //   size: int8,
    //   b: Struct({
    //     text1: string('../size'),
    //     text2: string('../size')
    //   })
    // })
    // ```
    // Where ../size needs to access parent structs.
    struct.$parent = parent || null

    fields.forEach(field =>
      struct[field.name] = field.type.read(subOpts, struct)
    )

    // ensure that the parent continues reading in the right spot
    opts.offset = subOpts.offset

    delete struct.$parent

    return struct
  }

  /**
   * Encodes an object into a Buffer as described by this Struct.
   * @param {Object} struct The Object to encode.
   */
  const encode = struct => {
    const size = type.size(struct)
    const buf = Buffer(size)
    const opts = { buf, offset: 0 }

    type.write(opts, struct)

    return buf
  }

  var type = StructType({
    read: decode
  , write(opts, struct) {
      fields.forEach(field =>
        field.type.write(opts, struct[field.name])
      )
    }
  , size(struct) {
      return fields.reduce(
        (size, field) => size + field.type.size(struct[field.name], struct),
        0
      )
    }
  })
  type.encode = encode
  type.field = (name, fieldType) => {
    fields.push({ name, type: getType(fieldType) })
    return type
  }

  return type
}

// dict of name→StructType
Struct.types = {}

/**
 * @param {Object} struct
 * @param {string} key
 * @return {*} Value.
 */
function descend(struct, key) {
  if (key.indexOf('.') === -1) return struct[key]
  return key.split('.').reduce((struct, sub) => struct[sub], struct)
}

/**
 * @param {Object} struct Object to find a value on.
 * @param {*}      value  Value to find. If a string, used as a path inside the `struct`. If a function, gets called with `this = struct`. Else, used unchanged as the value.
 * @return {*}
 */
function getValue(struct, value) {
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
    return descend(struct, value)
  }
  else if (typeof value === 'function') {
    return value.call(struct)
  }
  return value
}

/**
 * @param {string|Object|function} type Type name to find, or a StructType-ish descriptor object.
 * @return {StructType}
 */
function getType(type) {
  // an object that can read/write something. `type.size` can also be 0
  if (type.read && type.write && type.size != null) return type.$structType ? type : StructType(type)
  // Named types
  if (Struct.types[type]) return Struct.types[type]
  throw new Error('no such type: "' + type + '"')
}

/**
 * Defines a type that maps straight to Buffer methods.
 * Used internally for the different Number reading methods.
 * @param {string} name      Name of the type.
 * @param {number} size      Size of the type.
 * @param {string} readName  Name of the reading method.
 * @param {string} writeName Name of the writing method.
 * @private
 */
function defineBufferType(name, size, readName, writeName) {
  Struct.types[name] = StructType({
    read(opts) {
      const result = opts.buf[readName](opts.offset)
      opts.offset += size
      return result
    }
  , write(opts, value) {
      opts.buf[writeName](value, opts.offset)
      opts.offset += size
    }
  , size
  })
}

defineBufferType('int8',  1, 'readInt8',  'writeInt8')
defineBufferType('uint8', 1, 'readUInt8', 'writeUInt8')
// little endians
defineBufferType('int16',  2, 'readInt16LE',  'writeInt16LE')
defineBufferType('uint16', 2, 'readUInt16LE', 'writeUInt16LE')
defineBufferType('int32',  4, 'readInt32LE',  'writeInt32LE')
defineBufferType('uint32', 4, 'readUInt32LE', 'writeUInt32LE')
defineBufferType('float',  4, 'readFloatLE',  'writeFloatLE')
defineBufferType('double', 8, 'readDoubleLE', 'writeDoubleLE')
// big endians
defineBufferType('int16be',  2, 'readInt16BE',  'writeInt16BE')
defineBufferType('uint16be', 2, 'readUInt16BE', 'writeUInt16BE')
defineBufferType('int32be',  4, 'readInt32BE',  'writeInt32BE')
defineBufferType('uint32be', 4, 'readUInt32BE', 'writeUInt32BE')
defineBufferType('floatbe',  4, 'readFloatBE',  'writeFloatBE')
defineBufferType('doublebe', 8, 'readDoubleBE', 'writeDoubleBE')

// 1 byte for 1 bit of information! efficiency!
Struct.types.bool = StructType({
  read(opts) {
    const result = opts.buf[opts.offset] !== 0
    opts.offset++
    return result
  }
, write(opts, value) {
    opts.buf[opts.offset] = value ? 1 : 0
    opts.offset++
  }
, size: 1
})

Struct.types.buffer = size => StructType({
  read(opts) {
    const length = Struct.getValue(opts.struct, size)
    const result = new Buffer(length)
    opts.buf.copy(result, 0, opts.offset, opts.offset + length)
    opts.offset += length
    return result
  },
  size: struct => Struct.getValue(struct, size)
})

Struct.types.array = (length, type) => {
  const typeClass = getType(type)
  return StructType({
    read(opts, parent) {
      const l = getValue(opts.struct, length)
      const result = []
      for (let i = 0; i < l; i++) {
        result.push(typeClass.read(opts, parent))
      }
      return result
    }
  , write(opts, value) {
      const l = getValue(opts.struct, length)
      if (value.length !== l) {
        throw new Error('cannot write incorrect array length, expected ' + l + ', got ' + value.length)
      }
      for (let i = 0; i < l; i++) {
        typeClass.write(opts, value[i])
      }
    }
  , size: typeof length === 'number'
      ? (value, struct) => length * type.size(value[0], struct)
      : (value, struct) => value.length ? type.size(value[0], struct) * value.length : 0
  })
}

Struct.types.string = (size, encoding = 'utf8') => StructType({
  read(opts) {
    const length = getValue(opts.struct, size)
    const result = opts.buf.toString(encoding, opts.offset, opts.offset + length)
    opts.offset += length
    return result
  }
, write(opts, value) {
    const length = getValue(opts.struct, size)
    if (value.length !== length) {
      throw new Error('cannot write incorrect string size, expected ' + length + ', got ' + value.length)
    }
    opts.buf.write(value, opts.offset, length, encoding)
    opts.offset += length
  }
, size: struct => getValue(opts.struct, size)
})

// compat <=0.9.2
Struct.types.char = Struct.types.string

// conditional type
Struct.types.if = (condition, type) => {
  type = getType(type)
  let elseType
  return StructType({
    read(opts, parent) {
      if (getValue(opts.struct, condition)) {
        return type.read(opts, parent)
      } else if (elseType) {
        return elseType.read(opts, parent)
      }
    }
  , write(opts, value) {
      if (getValue(opts.struct, condition)) {
        type.write(opts, value)
      } else if (elseType) {
        return elseType.write(opts, value)
      }
    }
  , size: (value, struct) => getValue(struct, condition) ? type.size(value, struct) : 0
    // additional methods
  , else(type) {
      elseType = getType(type)
      return this
    }
  })
}

Struct.types.skip = size => StructType({
  read(opts) { opts.offset += size }
, write(opts) { opts.offset += size }
, size
})

// import Struct from 'awestruct'
Struct.default = Struct
// import { Type } from 'awestruct', etc
// require('awestruct').Type, etc
Struct.Struct = Struct
Struct.Type = StructType
Struct.getValue = getValue
Struct.getType = getType

// require('awestruct') === Struct
module.exports = Struct
