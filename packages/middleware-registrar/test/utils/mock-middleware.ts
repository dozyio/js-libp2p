import sinon from 'sinon'

// // Create a proper type for mock provider that doesn't rely on SinonStub directly
interface MockMiddleware {
  protocol: string
  wrap: sinon.SinonStub
  isWrapped: sinon.SinonStub
  start: sinon.SinonStub
  stop: sinon.SinonStub
  isStarted: sinon.SinonStub
}

// Create a mock provider with the correct type
export function mockMiddleware (): MockMiddleware {
  const protocol = '/test/1.0.0'

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
    protocol,
    wrap,
    isWrapped,
    start,
    stop,
    isStarted
  }
}
