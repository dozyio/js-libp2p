/* eslint-env mocha */
import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { TIMEOUT } from '../src/constants.js'
import { challengeResponseProvider } from '../src/index.js'

describe('Challenge Response Provider', () => {
  let provider: ReturnType<typeof challengeResponseProvider>
  let components: any
  let instance: any

  beforeEach(() => {
    // Mock components that would be passed by libp2p
    components = {
      peerId: {
        publicKey: new Uint8Array([1, 2, 3]),
        privateKey: new Uint8Array([4, 5, 6]),
        toPeerId: () => ({ toString: () => 'test-peer-id' })
      },
      registrar: {
        handle: sinon.stub().resolves(),
        unhandle: sinon.stub().resolves()
      },
      connectionManager: {
        getConnections: sinon.stub().returns([]),
        getConnection: sinon.stub().returns(null)
      },
      logger: {
        forComponent: () => ({
          error: sinon.stub(),
          debug: sinon.stub(),
          trace: sinon.stub()
        })
      }
    }
  })

  describe('Factory function', () => {
    it('should create a provider with default options', () => {
      provider = challengeResponseProvider()

      expect(provider.id).to.equal('challenge-response')
      expect(provider.name).to.be.a('string')
      expect(provider.create).to.be.a('function')
    })

    it('should accept custom timeout option', () => {
      const customTimeout = TIMEOUT * 2
      provider = challengeResponseProvider({ timeout: customTimeout })

      expect(provider.id).to.equal('challenge-response')
    })

    it('should accept custom protocol prefix', () => {
      provider = challengeResponseProvider({ protocolPrefix: 'custom' })

      expect(provider.id).to.equal('challenge-response')
    })
  })

  describe('Provider instance', () => {
    beforeEach(() => {
      provider = challengeResponseProvider()
      instance = provider.create(components)
    })

    it('should create a valid provider instance', () => {
      expect(instance).to.exist()
      expect(instance.start).to.be.a('function')
      expect(instance.stop).to.be.a('function')
      expect(instance.isStarted).to.be.a('function')
      expect(instance.authenticate).to.be.a('function')
      expect(instance.isAuthenticated).to.be.a('function')
    })

    it('should return false for isStarted initially', () => {
      expect(instance.isStarted()).to.be.false()
    })

    it('should return false for isAuthenticated', async () => {
      const connectionId = 'test-connection-id'
      expect(instance.isAuthenticated(connectionId)).to.be.false()
    })

    it('should return false for authenticate', async () => {
      const connectionId = 'test-connection-id'
      const result = await instance.authenticate(connectionId)
      expect(result).to.be.false()
    })

    // Start and stop methods currently do nothing, but we should test them anyway
    it('should have start and stop methods that resolve', async () => {
      await expect(instance.start()).to.eventually.be.undefined()
      await expect(instance.stop()).to.eventually.be.undefined()
    })
  })
})

