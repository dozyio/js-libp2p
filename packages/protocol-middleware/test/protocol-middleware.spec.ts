/* eslint-env mocha */
import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { ProtocolMiddlewareService } from '../src/protocol-middleware-service.js'
import type { ProtectedService } from '../src/protocol-middleware-service.js'
import type { AbortOptions } from '@libp2p/interface'

describe('ProtocolMiddlewareService', () => {
  let mockComponents: any
  let mockAuthProvider: any
  let mockRegistrar: any
  let mockLogger: any
  let mockComponentLogger: any
  let sut: ProtocolMiddlewareService
  let mockService: ProtectedService

  beforeEach(() => {
    // Setup mocks
    mockRegistrar = {
      handle: sinon.stub().resolves(),
      unhandle: sinon.stub().resolves(),
      getHandler: sinon.stub().throws(new Error('UnhandledProtocolError'))
    }
    mockRegistrar.getHandler.throws({ name: 'UnhandledProtocolError' })

    // Create a function that can also have properties
    mockLogger = sinon.stub()
    mockLogger.trace = sinon.stub()
    mockLogger.debug = sinon.stub()
    mockLogger.info = sinon.stub()
    mockLogger.warn = sinon.stub()
    mockLogger.error = sinon.stub()
    mockLogger.fatal = sinon.stub()
    mockLogger.enabled = true

    mockComponentLogger = {
      forComponent: sinon.stub().returns(mockLogger)
    }

    mockComponents = {
      registrar: mockRegistrar,
      logger: mockComponentLogger
    }

    mockAuthProvider = {
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      authenticate: sinon.stub().resolves(true),
      isAuthenticated: sinon.stub().returns(true),
      id: 'mock-auth',
      name: 'Mock Auth Provider'
    }

    mockService = {
      protocol: '/test/protocol/1.0.0',
      handleMessage: sinon.stub(),
      maxInboundStreams: 10,
      maxOutboundStreams: 10
    }

    // Create service under test
    sut = new ProtocolMiddlewareService(mockComponents, {
      provider: mockAuthProvider
    })
  })

  afterEach(async () => {
    if (sut.isStarted()) {
      await sut.stop()
    }
  })

  describe('initialization', () => {
    it('should create an instance with default options', () => {
      expect(sut).to.exist()
      expect(sut.isStarted()).to.be.false()
    })

    it('should create an instance with protected services', () => {
      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      expect(sut).to.exist()
      expect(sut.isStarted()).to.be.false()
    })

    it('should create an instance with custom auth options', () => {
      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        autoAuthenticate: false,
        protectedServices: {
          testService: mockService
        },
        authOptions: {
          testService: {
            autoAuthenticate: false
          }
        }
      })

      expect(sut).to.exist()
      expect(sut.isStarted()).to.be.false()
    })
  })

  describe('start', () => {
    it('should start the service with no protected services', async () => {
      await sut.start()

      expect(sut.isStarted()).to.be.true()
      expect(mockAuthProvider.start.callCount).to.be.at.least(1)
      expect(mockRegistrar.handle.callCount).to.equal(0)
    })

    it('should start the service with protected services', async () => {
      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await sut.start()

      expect(sut.isStarted()).to.be.true()
      expect(mockAuthProvider.start.callCount).to.be.at.least(1)
      expect(mockRegistrar.handle.callCount).to.be.at.least(1)

      // Check arguments for first call
      const handleArgs = mockRegistrar.handle.firstCall.args
      expect(handleArgs[0]).to.equal(mockService.protocol)
      expect(handleArgs[1]).to.be.a('function')
      expect(handleArgs[2]).to.deep.equal({
        maxInboundStreams: mockService.maxInboundStreams,
        maxOutboundStreams: mockService.maxOutboundStreams
      })
    })

    it('should skip services with missing protocol or handleMessage', async () => {
      const invalidService = {
        // Missing protocol
        handleMessage: sinon.stub()
      }

      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          invalidService: invalidService as any
        }
      })

      await sut.start()

      expect(sut.isStarted()).to.be.true()
      expect(mockRegistrar.handle.callCount).to.equal(0)
      expect(mockLogger.error.callCount).to.be.at.least(1)
    })

    it('should throw if protocol is already registered', async () => {
      // Make getHandler return successfully to simulate an already registered protocol
      mockRegistrar.getHandler.returns({})

      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await expect(sut.start()).to.eventually.be.rejected()
        .with.property('message')
        .that.include('already registered')
    })

    it('should throw if registrar.handle throws', async () => {
      mockRegistrar.handle.rejects(new Error('Handle error'))

      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await expect(sut.start()).to.eventually.be.rejected()
        .with.property('message')
        .that.include('Handle error')
    })
  })

  describe('stop', () => {
    it('should stop the service with no protected services', async () => {
      await sut.start()
      await sut.stop()

      expect(sut.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.callCount).to.equal(0)
    })

    it('should stop the service with protected services', async () => {
      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await sut.start()
      await sut.stop()

      expect(sut.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.firstCall.args[0]).to.equal(mockService.protocol)
    })

    it('should handle unhandle errors gracefully', async () => {
      mockRegistrar.unhandle.rejects(new Error('Unhandle error'))

      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await sut.start()
      await sut.stop()

      expect(sut.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockLogger.error.callCount).to.be.at.least(1)
    })
  })

  describe('authenticate', () => {
    const connectionId = 'test-connection-id'

    it('should throw if service is not started', async () => {
      await expect(sut.authenticate(connectionId)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    it('should call provider.authenticate', async () => {
      await sut.start()

      const result = await sut.authenticate(connectionId)

      expect(result).to.be.true()
      expect(mockAuthProvider.authenticate.callCount).to.be.at.least(1)
      expect(mockAuthProvider.authenticate.firstCall.args[0]).to.equal(connectionId)
    })

    it('should pass abort options to provider.authenticate', async () => {
      await sut.start()

      const abortOptions: AbortOptions = {
        signal: new AbortController().signal
      }

      await sut.authenticate(connectionId, abortOptions)

      expect(mockAuthProvider.authenticate.lastCall.args[0]).to.equal(connectionId)
      expect(mockAuthProvider.authenticate.lastCall.args[1]).to.equal(abortOptions)
    })
  })

  describe('isAuthenticated', () => {
    const connectionId = 'test-connection-id'

    it('should return false if service is not started', () => {
      mockAuthProvider.isAuthenticated.returns(false)
      expect(sut.isAuthenticated(connectionId)).to.be.false()
    })

    it('should call provider.isAuthenticated', async () => {
      await sut.start()

      const result = sut.isAuthenticated(connectionId)

      expect(result).to.be.true()
      expect(mockAuthProvider.isAuthenticated.callCount).to.be.at.least(1)
      expect(mockAuthProvider.isAuthenticated.lastCall.args[0]).to.equal(connectionId)
    })

    it('should return false if provider returns false', async () => {
      mockAuthProvider.isAuthenticated.returns(false)

      await sut.start()

      const result = sut.isAuthenticated(connectionId)

      expect(result).to.be.false()
    })
  })

  describe('protectService', () => {
    it('should throw if service is not started', async () => {
      await expect(sut.protectService('testService', mockService)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    it('should throw if service is missing required properties', async () => {
      await sut.start()

      await expect(sut.protectService('invalidService', {} as any)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('doesn\'t have required protocol or handleMessage properties')
    })

    it('should throw if protocol is already registered', async () => {
      mockRegistrar.getHandler.returns({})

      await sut.start()

      await expect(sut.protectService('testService', mockService)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('already registered')
    })

    it('should protect a service with default options', async () => {
      await sut.start()

      await sut.protectService('testService', mockService)

      expect(mockRegistrar.handle.callCount).to.be.at.least(1)

      // Check arguments for last call
      const handleArgs = mockRegistrar.handle.lastCall.args
      expect(handleArgs[0]).to.equal(mockService.protocol)
      expect(handleArgs[1]).to.be.a('function')
      expect(handleArgs[2]).to.deep.equal({
        maxInboundStreams: mockService.maxInboundStreams,
        maxOutboundStreams: mockService.maxOutboundStreams
      })
    })

    it('should protect a service with custom options', async () => {
      await sut.start()

      await sut.protectService('testService', mockService, { autoAuthenticate: false })

      expect(mockRegistrar.handle.callCount).to.be.at.least(1)
    })
  })

  describe('unprotectService', () => {
    it('should throw if service is not started', async () => {
      await expect(sut.unprotectService('testService')).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    it('should throw if service is not protected', async () => {
      await sut.start()

      await expect(sut.unprotectService('unknownService')).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not protected')
    })

    it('should unprotect a service', async () => {
      sut = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        protectedServices: {
          testService: mockService
        }
      })

      await sut.start()
      await sut.unprotectService('testService')

      expect(mockRegistrar.unhandle.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.lastCall.args[0]).to.equal(mockService.protocol)
    })
  })
})
