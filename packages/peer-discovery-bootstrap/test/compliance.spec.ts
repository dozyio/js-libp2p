/* eslint-env mocha */

import tests from '@libp2p/interface-compliance-tests/peer-discovery'
import { defaultLogger } from '@libp2p/logger'
import { stubInterface } from 'sinon-ts'
import { bootstrap } from '../src/index.js'
import peerList from './fixtures/default-peers.js'
import type { PeerStore } from '@libp2p/interface'
import type { ConnectionManager } from '@libp2p/interface-internal'

describe('compliance tests', () => {
  tests({
    async setup () {
      const components = {
        peerStore: stubInterface<PeerStore>(),
        logger: defaultLogger(),
        connectionManager: stubInterface<ConnectionManager>()
      }

      return bootstrap({
        list: peerList,
        timeout: 100
      })(components)
    },
    async teardown () {}
  })
})
