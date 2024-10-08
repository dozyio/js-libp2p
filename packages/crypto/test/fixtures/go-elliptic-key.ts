import type { Curve } from '../../src/keys/ecdh/index.js'

export interface GoEllipticKey {
  curve: Curve
  bob: {
    private: Uint8Array
    public: Uint8Array
  }
}

export default {
  curve: 'P-256',
  bob: {
    private: Uint8Array.from([
      181, 217, 162, 151, 225, 36, 53, 253, 107, 66, 27, 27, 232, 72, 0, 0, 103, 167, 84, 62, 203, 91, 97, 137, 131, 193, 230, 126, 98, 242, 216, 170
    ]),
    public: Uint8Array.from([
      4, 53, 59, 128, 56, 162, 250, 72, 141, 206, 117, 232, 57, 96, 39, 39, 247, 7, 27, 57, 251, 232, 120, 186, 21, 239, 176, 139, 195, 129, 125, 85, 11, 188, 191, 32, 227, 0, 6, 163, 101, 68, 208, 1, 43, 131, 124, 112, 102, 91, 104, 79, 16, 119, 152, 208, 4, 147, 155, 83, 20, 146, 104, 55, 90
    ])
  }
} satisfies GoEllipticKey
