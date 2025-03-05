import sinon from 'sinon'
import type { Registrar } from '@libp2p/interface-internal'
import type { StreamHandler, StreamHandlerOptions, Topology } from '@libp2p/interface'

// Create a proper mock type with all required functions
interface MockRegistrar {
  getProtocols: sinon.SinonStub
  handle: sinon.SinonStub
  unhandle: sinon.SinonStub
  getHandler: sinon.SinonStub
  register: sinon.SinonStub
  unregister: sinon.SinonStub
  getTopologies: sinon.SinonStub
  [Symbol.toStringTag]: string
}

export function mockRegistrar (): MockRegistrar {
  const handle = sinon.stub()
  handle.callsFake(async (protocol: string, handler: StreamHandler, options?: StreamHandlerOptions) => {})
  
  const unhandle = sinon.stub()
  unhandle.callsFake(async (protocol: string) => {})
  
  const register = sinon.stub()
  register.callsFake(async (protocol: string, topology: Topology) => 'mock-id')
  
  return {
    getProtocols: sinon.stub(),
    handle,
    unhandle,
    getHandler: sinon.stub(),
    register,
    unregister: sinon.stub(),
    getTopologies: sinon.stub(),
    [Symbol.toStringTag]: '@libp2p/mock-registrar'
  }
}
