# @libp2p/middleware-registrar

[![libp2p.io](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![Chat on GitHub Discussions](https://img.shields.io/badge/Join%20the%20community-on%20GitHub%20Discussions-blue)](https://github.com/orgs/dozyio/discussions)
[![npm](https://img.shields.io/npm/v/@libp2p/middleware-registrar.svg?style=flat-square)](https://www.npmjs.com/package/@libp2p/middleware-registrar)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE-APACHE)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE-MIT)

> A registrar implementation that automatically wraps protocols with middleware

## Table of Contents

- [Overview](#overview)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [License](#license)
- [Contribution](#contribution)

## Overview

This package provides a registrar implementation that automatically wraps all protocol handlers with middleware (such as authentication) through a configured provider. It acts as a drop-in replacement for the default registrar, handling all the complexity of correctly applying middleware to protocols.

## Install

```bash
npm i @libp2p/middleware-registrar
```

## Usage

```js
import { createLibp2p } from 'libp2p'
import { middlewareRegistrar } from '@libp2p/middleware-registrar'
import { authChallengeProvider } from '@libp2p/middleware-auth-challenge'

const node = await createLibp2p({
  // ... other libp2p options
  
  // Configure services including the auth challenge provider
  services: {
    // Configure auth challenge provider
    authChallenge: (components) => authChallengeProvider(components)
  },
  
  // Use the middleware registrar as the custom registrar implementation
  registrar: (components) => {
    // Get the auth challenge provider from components
    const provider = components.authChallenge
    
    // Create the middleware-aware registrar
    return middlewareRegistrar(components, provider)
  }
})

// All protocols registered through node.handle() will be automatically
// protected with the configured middleware
await node.handle('/my-protocol/1.0.0', myHandler)
```

## Using with LibP2P

When using with libp2p, configure the middleware registrar as the custom registrar:

```js
import { createLibp2p } from 'libp2p'
import { middlewareRegistrar } from '@libp2p/middleware-registrar'
import { authChallengeProvider } from '@libp2p/middleware-auth-challenge'

const node = await createLibp2p({
  // ... standard libp2p options
  services: {
    // Other services
    ping: ping(),
    identify: identify(),
    // Configure auth challenge provider
    authChallenge: (components) => authChallengeProvider(components)
  },
  
  // Use the middleware registrar as the custom registrar implementation
  registrar: (components) => {
    // Get the auth challenge provider from components
    const provider = components.authChallenge
    
    // Create the middleware-aware registrar
    return middlewareRegistrar(components, provider)
  }
})
```

This will ensure that all protocols registered through the node are automatically protected by the middleware.

## How It Differs from protocol-middleware

While `@libp2p/protocol-middleware` requires you to explicitly protect each protocol service and handle different protocol implementations, the middleware registrar acts as a transparent proxy in front of the standard registrar that automatically applies middleware to all protocols.

Benefits:
- Works with all protocol implementations consistently (no need to handle each differently)
- No need to manually protect each protocol - every protocol registered is automatically protected
- Seamless integration with existing code (drop-in replacement for the standard registrar)
- Configurable per-protocol options to fine-tune middleware behavior

## API

### middlewareRegistrar(components, provider, [options])

Creates a new instance of the middleware registrar.

- `components`: The libp2p components
- `provider`: The middleware provider to use (e.g., `components.authChallenge`)
- `options`: Optional configuration:
  - `defaultOptions`: Middleware options that apply to all protocols unless overridden
  - `protocolOptions`: Protocol-specific middleware options (keyed by protocol string)

Returns a registrar instance that conforms to the `Registrar` interface.

### MiddlewareRegistry#setProtocolOptions(protocol, options)

Sets middleware-specific options for a particular protocol.

- `protocol`: The protocol string to configure options for
- `options`: Middleware-specific options to apply for this protocol

## License

Licensed under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.