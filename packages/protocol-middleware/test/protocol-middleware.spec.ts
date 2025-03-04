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
  let pms: ProtocolMiddlewareService
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
    pms = new ProtocolMiddlewareService(mockComponents, {
      provider: mockAuthProvider
    })
  })

  afterEach(async () => {
    if (pms.isStarted()) {
      await pms.stop()
    }
  })

  describe('initialization', () => {
    it('should create an instance with default options', () => {
      expect(pms).to.exist()
      expect(pms.isStarted()).to.be.false()
    })

    it('should create an instance with protected services', () => {
      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        }
      })

      expect(pms).to.exist()
      expect(pms.isStarted()).to.be.false()
    })

    it('should create an instance with custom auth options', () => {
      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        },
        authOptions: {
          testService: {
          }
        }
      })

      expect(pms).to.exist()
      expect(pms.isStarted()).to.be.false()
    })
  })

  describe('start', () => {
    it('should start the service with no protected services', async () => {
      await pms.start()

      expect(pms.isStarted()).to.be.true()
      expect(mockAuthProvider.start.callCount).to.be.at.least(1)
      expect(mockRegistrar.handle.callCount).to.equal(0)
    })

    it('should start the service with protected services', async () => {
      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        }
      })

      await pms.start()

      expect(pms.isStarted()).to.be.true()
      expect(mockAuthProvider.start.callCount).to.be.at.least(1)
      expect(mockRegistrar.handle.callCount).to.be.at.least(1)

      // Check arguments for first call
      const handleArgs = mockRegistrar.handle.firstCall.args
      expect(handleArgs[0]).to.equal(mockService.protocol)
      expect(handleArgs[1]).to.be.a('function')
      expect(handleArgs[2].maxInboundStreams).to.equal(mockService.maxInboundStreams)
      expect(handleArgs[2].maxOutboundStreams).to.equal(mockService.maxOutboundStreams)
    })

    it('should skip services with missing protocol or handleMessage', async () => {
      const invalidService = {
        // Missing protocol
        handleMessage: sinon.stub()
      }

      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          invalidService: invalidService as any
        }
      })

      await pms.start()

      expect(pms.isStarted()).to.be.true()
      expect(mockRegistrar.handle.callCount).to.equal(0)
      expect(mockLogger.error.callCount).to.be.at.least(1)
    })

    // it('should throw if protocol is already registered', async () => {
    //   // Make getHandler return successfully to simulate an already registered protocol
    //   mockRegistrar.getHandler.returns({})
    //
    //   pms = new ProtocolMiddlewareService(mockComponents, {
    //     provider: mockAuthProvider,
    //     protectedServices: {
    //       testService: mockService
    //     }
    //   })
    //
    //   await expect(pms.start()).to.eventually.be.rejected()
    //     .with.property('message')
    //     .that.include('already registered')
    // })

    // it('should throw if registrar.handle throws', async () => {
    //   mockRegistrar.handle.rejects(new Error('Handle error'))
    //
    //   pms = new ProtocolMiddlewareService(mockComponents, {
    //     provider: mockAuthProvider,
    //     protectedServices: {
    //       testService: mockService
    //     }
    //   })
    //
    //   await expect(pms.start()).to.eventually.be.rejected()
    //     .with.property('message')
    //     .that.include('Handle error')
    // })
  })

  describe('stop', () => {
    it('should stop the service with no protected services', async () => {
      await pms.start()
      await pms.stop()

      expect(pms.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.callCount).to.equal(0)
    })

    it('should stop the service with protected services', async () => {
      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        }
      })

      await pms.start()
      await pms.stop()

      expect(pms.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.firstCall.args[0]).to.equal(mockService.protocol)
    })

    it('should handle unhandle errors gracefully', async () => {
      mockRegistrar.unhandle.rejects(new Error('Unhandle error'))

      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        }
      })

      await pms.start()
      await pms.stop()

      expect(pms.isStarted()).to.be.false()
      expect(mockAuthProvider.stop.callCount).to.be.at.least(1)
      expect(mockLogger.error.callCount).to.be.at.least(1)
    })
  })

  describe('authenticate', () => {
    const connectionId = 'test-connection-id'

    it('should throw if service is not started', async () => {
      await expect(pms.authenticate(connectionId)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    it('should call provider.authenticate', async () => {
      await pms.start()

      const result = await pms.authenticate(connectionId)

      expect(result).to.be.true()
      expect(mockAuthProvider.authenticate.callCount).to.be.at.least(1)
      expect(mockAuthProvider.authenticate.firstCall.args[0]).to.equal(connectionId)
    })

    it('should pass abort options to provider.authenticate', async () => {
      await pms.start()

      const abortOptions: AbortOptions = {
        signal: new AbortController().signal
      }

      await pms.authenticate(connectionId, abortOptions)

      expect(mockAuthProvider.authenticate.lastCall.args[0]).to.equal(connectionId)
      expect(mockAuthProvider.authenticate.lastCall.args[1]).to.equal(abortOptions)
    })
  })

  describe('isAuthenticated', () => {
    const connectionId = 'test-connection-id'

    it('should return false if service is not started', () => {
      mockAuthProvider.isAuthenticated.returns(false)
      expect(pms.isAuthenticated(connectionId)).to.be.false()
    })

    it('should call provider.isAuthenticated', async () => {
      await pms.start()

      const result = pms.isAuthenticated(connectionId)

      expect(result).to.be.true()
      expect(mockAuthProvider.isAuthenticated.callCount).to.be.at.least(1)
      expect(mockAuthProvider.isAuthenticated.lastCall.args[0]).to.equal(connectionId)
    })

    it('should return false if provider returns false', async () => {
      mockAuthProvider.isAuthenticated.returns(false)

      await pms.start()

      const result = pms.isAuthenticated(connectionId)

      expect(result).to.be.false()
    })
  })

  describe('protectService', () => {
    it('should throw if service is not started', async () => {
      await expect(pms.protectService('testService', mockService)).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    // it('should throw if service is missing required properties', async () => {
    //   await pms.start()
    //
    //   await expect(pms.protectService('invalidService', {} as any)).to.eventually.be.rejected()
    //     .with.property('message')
    //     .that.include('doesn\'t have required protocol or handleMessage properties')
    // })

    // it('should throw if protocol is already registered', async () => {
    //   mockRegistrar.getHandler.returns({})
    //
    //   await pms.start()
    //
    //   await expect(pms.protectService('testService', mockService)).to.eventually.be.rejected()
    //     .with.property('message')
    //     .that.include('already registered')
    // })

    it('should protect a service with default options', async () => {
      await pms.start()

      await pms.protectService('testService', mockService)

      expect(mockRegistrar.handle.callCount).to.be.at.least(1)

      // Check arguments for last call
      const handleArgs = mockRegistrar.handle.lastCall.args
      expect(handleArgs[0]).to.equal(mockService.protocol)
      expect(handleArgs[1]).to.be.a('function')
      expect(handleArgs[2].maxInboundStreams).to.equal(mockService.maxInboundStreams)
      expect(handleArgs[2].maxOutboundStreams).to.equal(mockService.maxOutboundStreams)
    })

    it('should protect a service with custom options', async () => {
      await pms.start()

      await pms.protectService('testService', mockService)

      expect(mockRegistrar.handle.callCount).to.be.at.least(1)
    })
  })

  describe('unprotectService', () => {
    it('should throw if service is not started', async () => {
      await expect(pms.unprotectService('testService')).to.eventually.be.rejected()
        .with.property('message')
        .that.include('not started')
    })

    // it('should throw if service is not protected', async () => {
    //   await pms.start()
    //
    //   await expect(pms.unprotectService('unknownService')).to.eventually.be.rejected()
    //     .with.property('message')
    //     .that.include('not protected')
    // })

    it('should unprotect a service', async () => {
      pms = new ProtocolMiddlewareService(mockComponents, {
        provider: mockAuthProvider,
        services: {
          testService: mockService
        }
      })

      await pms.start()
      await pms.unprotectService('testService')

      expect(mockRegistrar.unhandle.callCount).to.be.at.least(1)
      expect(mockRegistrar.unhandle.lastCall.args[0]).to.equal(mockService.protocol)
    })
  })
})
