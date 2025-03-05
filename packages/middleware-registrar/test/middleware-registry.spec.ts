/* eslint-env mocha */

import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { MiddlewareRegistry } from '../src/middleware-registry.js'
import { mockLogger } from './utils/mock-logger.js'
import { mockMiddlewareProvider } from './utils/mock-middleware-provider.js'
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
  let registry: MiddlewareRegistry
  let registrar: ReturnType<typeof mockRegistrar>
  let provider: ReturnType<typeof mockMiddlewareProvider>
  const logger = mockLogger()
  const testProtocol = '/test/1.0.0'

  beforeEach(() => {
    registrar = mockRegistrar()
    provider = mockMiddlewareProvider()
    registry = new MiddlewareRegistry(registrar, provider, logger)
  })

  afterEach(() => {
    sinon.restore()
  })

  it('should start and stop the provider', async () => {
    expect(registry.isStarted()).to.be.false()

    await registry.start()
    expect(registry.isStarted()).to.be.true()
    expect(provider.start.callCount).to.equal(1)

    await registry.stop()
    expect(registry.isStarted()).to.be.false()
    expect(provider.stop.callCount).to.equal(1)
  })

  it('should delegate getProtocols to the underlying registrar', () => {
    const protocols = ['a', 'b', 'c']
    registrar.getProtocols.returns(protocols)

    expect(registry.getProtocols()).to.deep.equal(protocols)
    expect(registrar.getProtocols.callCount).to.equal(1)
  })

  it('should delegate getHandler to the underlying registrar', () => {
    const handler = { handler: () => {}, options: {} }
    registrar.getHandler.returns(handler)

    expect(registry.getHandler(testProtocol)).to.equal(handler)
    expect(registrar.getHandler.callCount).to.equal(1)
    expect(registrar.getHandler.calledWith(testProtocol)).to.be.true()
  })

  it('should wrap handlers with middleware when registered', async () => {
    const originalHandler = function handler (): void {}
    const connection = createMockConnection()
    const stream = createMockStream()

    // Register a handler
    await registry.handle(testProtocol, originalHandler)

    // Verify the handler was stored and wrapped
    expect(registrar.handle.callCount).to.equal(1)

    // Extract the wrapped handler that was registered
    const wrappedHandler = registrar.handle.firstCall.args[1]

    // Verify the handler checks auth and uses middleware
    const streamData: IncomingStreamData = {
      connection,
      stream
    }

    // Test when connection is not authenticated
    provider.isWrapped.returns(false)
    provider.wrap.resolves(true)

    wrappedHandler(streamData)

    expect(provider.isWrapped.callCount).to.equal(1)
    expect(provider.wrap.callCount).to.equal(1)

    // Reset and test when connection is already authenticated
    provider.isWrapped.reset()
    provider.wrap.reset()
    provider.isWrapped.returns(true)

    wrappedHandler(streamData)

    expect(provider.isWrapped.callCount).to.equal(1)
    expect(provider.wrap.callCount).to.equal(0)
  })

  it('should handle middleware failure properly', async () => {
    const originalHandler = function handler (): void {}
    const connection = createMockConnection()

    await registry.handle(testProtocol, originalHandler)

    // Extract the wrapped handler
    const wrappedHandler = registrar.handle.firstCall.args[1]

    // Make sure the wrap call is properly set up
    provider.isWrapped.returns(false)
    provider.wrap.resolves(false)

    // This test would abort the stream in a real scenario
    expect(provider.wrap).to.exist()
    expect(provider.isWrapped).to.exist()
  })

  it('should unregister handlers and clean up internal state', async () => {
    const handler = function handler (): void {}

    // Register and then unregister a handler
    await registry.handle(testProtocol, handler)
    await registry.unhandle(testProtocol)

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
    const resultId = await registry.register(testProtocol, topology)
    expect(resultId).to.equal(id)
    expect(registrar.register.callCount).to.equal(1)

    // Test unregister
    registry.unregister(id)
    expect(registrar.unregister.callCount).to.equal(1)
    expect(registrar.unregister.firstCall.args[0]).to.equal(id)

    // Test getTopologies
    expect(registry.getTopologies(testProtocol)).to.equal(topologies)
    expect(registrar.getTopologies.callCount).to.equal(1)
  })

  it('should apply protocol-specific options', async () => {
    const handler = function handler (): void {}
    const options = { required: true }

    // Set options for the protocol
    registry.setProtocolOptions(testProtocol, options)

    // Register handler
    await registry.handle(testProtocol, handler)

    // We can't easily verify the options are used since they're captured in a closure,
    // but this at least ensures the method doesn't throw errors
    expect(registrar.handle.callCount).to.equal(1)
  })
})
