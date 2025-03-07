import sinon from 'sinon'

// // Create a proper type for mock provider that doesn't rely on SinonStub directly
interface MockMiddleware {
  protocol: string
  decorate: sinon.SinonStub
  isDecorated: sinon.SinonStub
  start: sinon.SinonStub
  stop: sinon.SinonStub
  isStarted: sinon.SinonStub
}

// Create a mock provider with the correct type
export function mockMiddleware (): MockMiddleware {
  // protocol used to negotiate middleware
  const protocol = '/decorator/1.0.0'

  const decorate = sinon.stub()
  decorate.callsFake(async (connectionId: string) => true)

  const isDecorated = sinon.stub()
  isDecorated.callsFake((connectionId: string) => false)

  const start = sinon.stub()
  start.resolves()

  const stop = sinon.stub()
  stop.resolves()

  const isStarted = sinon.stub()
  isStarted.returns(false)

  return {
    protocol,
    decorate,
    isDecorated,
    start,
    stop,
    isStarted
  }
}
