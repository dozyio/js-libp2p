import sinon from 'sinon'
import type { MiddlewareProvider } from '../../src/protocol-middleware-types.js'

// Create a proper type for mock provider that doesn't rely on SinonStub directly
interface MockProvider {
  id: string
  name: string
  wrap: sinon.SinonStub
  isWrapped: sinon.SinonStub
  start: sinon.SinonStub
  stop: sinon.SinonStub
  isStarted: sinon.SinonStub
}

// Create a mock provider with the correct type
export function mockMiddlewareProvider (): MockProvider {
  const wrap = sinon.stub()
  wrap.callsFake(async (connectionId: string) => true)
  
  const isWrapped = sinon.stub()
  isWrapped.callsFake((connectionId: string) => false)
  
  const start = sinon.stub()
  start.resolves()
  
  const stop = sinon.stub()
  stop.resolves()
  
  const isStarted = sinon.stub()
  isStarted.returns(false)
  
  return {
    id: 'mock-provider',
    name: 'Mock Middleware Provider',
    wrap,
    isWrapped,
    start,
    stop,
    isStarted
  }
}
