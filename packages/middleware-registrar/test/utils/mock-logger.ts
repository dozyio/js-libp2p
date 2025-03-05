import sinon from 'sinon'
import type { ComponentLogger } from '@libp2p/interface'

// Custom Logger interface for mock
interface Logger {
  trace: sinon.SinonStub
  debug: sinon.SinonStub
  info: sinon.SinonStub
  warn: sinon.SinonStub
  error: sinon.SinonStub
  fatal: sinon.SinonStub
}

export function mockLogger (): ComponentLogger {
  const logger: Logger = {
    trace: sinon.stub(),
    debug: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
    fatal: sinon.stub()
  }

  // Allow the logger to be called directly as a function
  const loggerFn: any = sinon.stub()

  // Copy all methods from logger to loggerFn
  Object.keys(logger).forEach(key => {
    loggerFn[key] = logger[key as keyof Logger]
  })

  return {
    forComponent: sinon.stub().returns(loggerFn)
  }
}
