/**
 * This example demonstrates how to protect libp2p protocols (like ping and identify)
 * with authentication, making them only available to authenticated connections.
 */

/* eslint-disable no-console, no-unused-vars */

import { identify } from '@libp2p/identify'
import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'
import { noise } from '@libp2p/noise'
import { ping } from '@libp2p/ping'
import { createProtocolMiddleware } from '@libp2p/protocol-middleware'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@libp2p/yamux'
import { createLibp2p } from 'libp2p'

/**
 * Option 1: Provide services directly to protocol middleware
 */
const setupIntegratedProtection = async () => {
  // Create a libp2p node with protocol middleware protecting other services
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0']
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      // Initialize protocol middleware with a challenge-response provider
      protocolMiddleware: createProtocolMiddleware({
        // Configure the challenge-response provider
        provider: challengeResponseProvider({
          timeout: 5000 // 5 second timeout
        }),
        // Specify services to protect
        protectedServices: {
          ping: ping(),
          identify: identify()
        }
      })
    }
  })

  console.log('Node created with PeerId:', node.peerId.toString())
  console.log('Listening on:', node.getMultiaddrs().map(ma => ma.toString()))

  // Create an event listener for incoming connections
  node.addEventListener('connection:open', async (evt) => {
    const connection = evt.detail
    console.log(`New connection from ${connection.remotePeer.toString()}`)

    // Authenticate incoming connection
    console.log('Authenticating incoming connection...')
    const authenticated = await node.services.protocolMiddleware.authenticate(connection.id)

    if (authenticated) {
      console.log('Connection authenticated successfully!')
    } else {
      console.log('Connection authentication failed!')
    }
  })

  return node
}

/**
 * Option 2: Dynamically protect services
 */
const setupDynamicProtection = async () => {
  // Create a basic libp2p node with services
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0']
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      // Regular protocol middleware service without initial protections
      protocolMiddleware: createProtocolMiddleware({
        provider: challengeResponseProvider({
          timeout: 5000
        })
      })
    }
  })

  console.log('Node created with PeerId:', node.peerId.toString())
  console.log('Listening on:', node.getMultiaddrs().map(ma => ma.toString()))

  // Dynamically protect services after initialization
  await node.services.protocolMiddleware.protectService('ping', node.services.ping)
  console.log('Protected ping service dynamically')

  await node.services.protocolMiddleware.protectService('identify', node.services.identify)
  console.log('Protected identify service dynamically')

  // Create an event listener for incoming connections
  node.addEventListener('connection:open', async (evt) => {
    const connection = evt.detail
    console.log(`New connection from ${connection.remotePeer.toString()}`)

    // Manually authenticate incoming connections
    console.log('Authenticating incoming connection...')
    const authenticated = await node.services.protocolMiddleware.authenticate(connection.id)

    if (authenticated) {
      console.log('Connection authenticated successfully!')
    } else {
      console.log('Connection authentication failed!')
    }
  })

  return node
}

// Example usage
const run = async () => {
  // Choose one of the examples
  const node = await setupIntegratedProtection()
  // const node = await setupDynamicProtection()

  // Listen for ctrl+c to stop the node
  process.on('SIGINT', async () => {
    console.log('Stopping node...')
    await node.stop()
    process.exit(0)
  })

  console.log('Node is running. Press Ctrl+C to exit.')

  // For testing: log if any peers connect and test a ping
  node.addEventListener('peer:connect', async (evt) => {
    const peerId = evt.detail
    console.log(`Connected to peer: ${peerId.toString()}`)

    // Test ping after authentication
    try {
      // Access the protected ping service
      const latency = await node.services.ping.ping(peerId)
      console.log(`Ping to ${peerId.toString()} successful: ${latency}ms`)
    } catch (err) {
      console.log(`Ping to ${peerId.toString()} failed: ${err.message}`)
    }
  })
}

run().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
