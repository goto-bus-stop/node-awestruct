var Struct = require('../src/Struct')
  , assert = require('assert')

describe('Struct types', function () {

  var buf = new Buffer([ 10, 20 ])
    , write = new Buffer(1)
    , opts = { buf: buf, offset: 0 }

  var byte = Struct.types.uint8

  function resetOffset() { opts.offset = 0 }

  beforeEach(resetOffset)

  it('can read a thing', function () {
    assert.equal(byte.read(opts), 10)
    assert.equal(opts.offset, 1)
  })

  it('can be called as a function', function () {
    opts.offset = 1
    assert.equal(byte(opts), 20)
  })

  it('transforms things', function () {
    var plus5 = byte.transform(function (a) { return a + 5 })
    assert.equal(plus5(opts), 15)
  })

  it('chains transforms', function () {
    var plus5 = byte.transform(function (a) { return a + 5 })
    var plus6 = plus5.transform(function (a) { return a + 1 })
    assert.equal(plus5(opts), 15)
    assert.equal(plus6(opts), 26)
  })

  it('creates a new type for transforms (issue #3)', function () {
    var int16 = Struct.types.int16
    var evil16 = int16.transform(function () { return 'lol' })
    assert.notEqual(int16(opts), 'lol')
    resetOffset()
    assert.equal(evil16(opts), 'lol')
  })

})

describe('Default types', function () {

  describe('ints', function () {
    var buf = new Buffer([ 0xff
                         , 0x39, 0x05
                         , 0x00, 0xca, 0x9a, 0x3b ])
      , ints = Struct({
          int8: 'int8'
        , int16: 'int16'
        , int32: 'int32'
        })
    it('supports intXX', function () {
      assert.deepEqual(ints(buf), { int8: -1, int16: 1337, int32: 1000000000 })
    })
  })

  describe('arrays', function () {
    var buf = new Buffer([ 0x03, 0x01, 0x20, 0xff, 0x00 ])
      , array = Struct.types.array

    it('reads simple, constant length arrays', function () {
      var simpleArray = Struct({
        array: array(4, 'uint8')
      })
      assert.deepEqual(simpleArray(buf), { array: [ 3, 1, 32, 255 ] })
    })

    it('reads variable length arrays', function () {
      var lengthArray = Struct({
        len: 'int8'
      , array: array('len', 'uint8')
      })
      assert.deepEqual(lengthArray(buf), { len: 3, array: [ 1, 32, 255 ] })
    })

    it('can take a function to compute the length', function () {
      var lengthArray = Struct({
        len: 'int8'
      , len2: 'int8'
      , array: array(function () { return this.len - this.len2 }, 'uint8')
      })
      assert.deepEqual(lengthArray(buf), { len: 3, len2: 1, array: [ 32, 255 ] })
    })

  })

  describe('strings', function () {
    var buf = new Buffer([ 0x68, 0x69, 0x20, 0x3a, 0x44 ])
      , char = Struct.types.char

    it('reads strings', function () {
      var string = Struct({ string: char(5) })
      assert.equal(string(buf).string, 'hi :D')
    })
  })

  describe('conditional', function () {
    var buf = new Buffer([ 0x01, 0x00, 0x02, 0x03 ])
      , _if = Struct.types.if

    it('supports basic conditional types', function () {
      var basicIf = Struct({
        pTrue: 'int8'
      , pFalse: 'int8'
      , two: _if('pTrue', 'int8')
      , next: 'int8'
      })

      assert.deepEqual(basicIf(buf), { pTrue: 1, pFalse: 0, two: 2, next: 3 })

      var basicFalse = Struct({
        pTrue: 'int8'
      , pFalse: 'int8'
      , two: _if('pFalse', 'int8')
      , next: 'int8'
      })

      assert.deepEqual(basicFalse(buf), { pTrue: 1, pFalse: 0, two: undefined, next: 2 })
    })
  })

})

describe('Custom types', function () {

  var myType = Struct.Type({
    read: function (opts) {
      var val = opts.buf.readInt8(opts.offset)
      opts.offset++
      return val * 1000
    }
  , write: function (opts, val) {
      opts.buf.writeInt8(Math.floor(val / 1000), opts.offset)
      opts.offset++
    }
  , size: function (val, struct) {
      return 1
    }
  })

  it('supports custom types', function () {
    var myStruct = Struct({
      builtinType: 'uint8'
    , customType: myType
    })

    assert.deepEqual(myStruct(new Buffer([ 5, 5 ])), { builtinType: 5, customType: 5000 })
  })

})