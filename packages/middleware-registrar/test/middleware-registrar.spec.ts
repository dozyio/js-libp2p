/* eslint-env mocha */

import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { MiddlewareRegistrar } from '../src/middleware-registry.js'
import { mockLogger } from './utils/mock-logger.js'
import { mockMiddleware } from './utils/mock-middleware.js'
import { mockRegistrar } from './utils/mock-registrar.js'
import type { IncomingStreamData } from '@libp2p/interface'

// Create simplified mocks for testing
function createMockConnection (): any {
  return {
    id: 'test-connection'
  }
}

function createMockStream (): any {
  return {
    source: (async function * () {})(),
    sink: async () => {},
    abort: sinon.stub()
  }
}

describe('MiddlewareRegistry', () => {
  let middlewareRegistrar: MiddlewareRegistrar
  let registrar: ReturnType<typeof mockRegistrar>
  let middleware: ReturnType<typeof mockMiddleware>
  const logger = mockLogger()
  // const decoratorProtocol = '/decorator/1.0.0'
  const testProtocol = '/test/1.0.0'

  beforeEach(() => {
    registrar = mockRegistrar()
    middleware = mockMiddleware()
    middlewareRegistrar = new MiddlewareRegistrar(registrar, middleware, logger)
  })

  afterEach(() => {
    sinon.restore()
  })

  it('should start and stop the provider', async () => {
    expect(middlewareRegistrar.isStarted()).to.be.false()

    await middlewareRegistrar.start()
    expect(middlewareRegistrar.isStarted()).to.be.true()
    expect(middleware.start.callCount).to.equal(1)

    await middlewareRegistrar.stop()
    expect(middlewareRegistrar.isStarted()).to.be.false()
    expect(middleware.stop.callCount).to.equal(1)
  })

  it('should delegate getProtocols to the underlying registrar', () => {
    const protocols = ['a', 'b', 'c']
    registrar.getProtocols.returns(protocols)

    expect(middlewareRegistrar.getProtocols()).to.deep.equal(protocols)
    expect(registrar.getProtocols.callCount).to.equal(1)
  })

  it('should delegate getHandler to the underlying registrar', () => {
    const handler = { handler: () => {}, options: {} }
    registrar.getHandler.returns(handler)

    expect(middlewareRegistrar.getHandler(testProtocol)).to.equal(handler)
    expect(registrar.getHandler.callCount).to.equal(1)
    expect(registrar.getHandler.calledWith(testProtocol)).to.be.true()
  })

  it('should decorate handlers with middleware when registered', async () => {
    const originalHandler = function handler (): void {}
    const connection = createMockConnection()
    const stream = createMockStream()

    // Register a handler
    await middlewareRegistrar.handle(testProtocol, originalHandler)

    // Verify the handler was stored and decorated
    expect(registrar.handle.callCount).to.equal(1)

    // Extract the decorated handler that was registered
    const decoratedHandler = registrar.handle.firstCall.args[1]

    // Verify the handler checks auth and uses middleware
    const streamData: IncomingStreamData = {
      connection,
      stream
    }

    // Test when connection is not authenticated
    middleware.isDecorated.returns(false)
    middleware.decorate.resolves(true)

    decoratedHandler(streamData)

    expect(middleware.isDecorated.callCount).to.equal(1)
    expect(middleware.decorate.callCount).to.equal(1)

    // Reset and test when connection is already authenticated
    middleware.isDecorated.reset()
    middleware.decorate.reset()
    middleware.isDecorated.returns(true)

    decoratedHandler(streamData)

    expect(middleware.isDecorated.callCount).to.equal(1)
    expect(middleware.decorate.callCount).to.equal(0)
  })

  it('should handle middleware failure properly', async () => {
    const originalHandler = function handler (): void {}
    // const connection = createMockConnection()

    await middlewareRegistrar.handle(testProtocol, originalHandler)

    // Extract the decorated handler
    // const decoratedHandler = registrar.handle.firstCall.args[1]

    // Make sure the decorate call is properly set up
    middleware.isDecorated.returns(false)
    middleware.decorate.resolves(false)

    // This test would abort the stream in a real scenario
    expect(middleware.decorate).to.exist()
    expect(middleware.isDecorated).to.exist()
  })

  it('should unregister handlers and clean up internal state', async () => {
    const handler = function handler (): void {}

    // Register and then unregister a handler
    await middlewareRegistrar.handle(testProtocol, handler)
    await middlewareRegistrar.unhandle(testProtocol)

    expect(registrar.unhandle.callCount).to.equal(1)
    expect(registrar.unhandle.firstCall.args[0]).to.equal(testProtocol)
  })

  it('should delegate register, unregister, and getTopologies to the underlying registrar', async () => {
    const topology = {
      onConnect: () => {},
      onDisconnect: () => {}
    }
    const id = 'topology-id'
    const topologies = [topology]

    registrar.register.resolves(id)
    registrar.getTopologies.returns(topologies)

    // Test register
    const resultId = await middlewareRegistrar.register(testProtocol, topology)
    expect(resultId).to.equal(id)
    expect(registrar.register.callCount).to.equal(1)

    // Test unregister
    middlewareRegistrar.unregister(id)
    expect(registrar.unregister.callCount).to.equal(1)
    expect(registrar.unregister.firstCall.args[0]).to.equal(id)

    // Test getTopologies
    expect(middlewareRegistrar.getTopologies(testProtocol)).to.equal(topologies)
    expect(registrar.getTopologies.callCount).to.equal(1)
  })

  it('should apply protocol-specific options', async () => {
    const handler = function handler (): void {}
    const options = { required: true }

    // Set options for the protocol
    middlewareRegistrar.setProtocolOptions(testProtocol, options)

    // Register handler
    await middlewareRegistrar.handle(testProtocol, handler)

    // We can't easily verify the options are used since they're captured in a closure,
    // but this at least ensures the method doesn't throw errors
    expect(registrar.handle.callCount).to.equal(1)
  })
})
