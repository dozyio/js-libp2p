import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromMultihash, peerIdFromPrivateKey } from '@libp2p/peer-id'
import { expect } from 'aegir/chai'
import { PeerSet } from '../src/index.js'
import type { PeerId } from '@libp2p/interface'

describe('peer-set', () => {
  it('should return a set', async () => {
    const set = new PeerSet()
    const peer = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))

    set.add(peer)

    const peer2 = peerIdFromMultihash(peer.toMultihash())

    expect(set.has(peer2)).to.be.true()
  })

  it('should create a set with PeerSet contents', async () => {
    const set1 = new PeerSet()
    const peer = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))

    set1.add(peer)

    const set2 = new PeerSet(set1)

    expect(set2.has(peer)).to.be.true()
  })

  it('should create a set with Array contents', async () => {
    const peer = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))
    const set = new PeerSet([peer])

    expect(set.has(peer)).to.be.true()
  })

  it('should create a set with Set contents', async () => {
    const peer = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))
    const s = new Set<PeerId>()
    s.add(peer)
    const set = new PeerSet(s)

    expect(set.has(peer)).to.be.true()
  })

  it('should return intersection', async () => {
    const peer1 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))
    const peer2 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))

    const s1 = new PeerSet([peer1])
    const s2 = new PeerSet([peer1, peer2])

    expect(s1.intersection(s2)).to.have.property('size', 1)
    expect(s1.intersection(s2).has(peer1)).to.be.true()
    expect(s1.intersection(s2).has(peer2)).to.be.false()

    expect(s2.intersection(s1)).to.have.property('size', 1)
    expect(s2.intersection(s1).has(peer1)).to.be.true()
    expect(s2.intersection(s1).has(peer2)).to.be.false()

    expect(s1.intersection(s1)).to.have.property('size', 1)
    expect(s1.intersection(s1).has(peer1)).to.be.true()
    expect(s1.intersection(s1).has(peer2)).to.be.false()

    expect(s2.intersection(s2)).to.have.property('size', 2)
    expect(s2.intersection(s2).has(peer1)).to.be.true()
    expect(s2.intersection(s2).has(peer2)).to.be.true()
  })

  it('should return difference', async () => {
    const peer1 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))
    const peer2 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))

    const s1 = new PeerSet([peer1])
    const s2 = new PeerSet([peer1, peer2])

    expect(s1.difference(s2)).to.have.property('size', 0)

    expect(s2.difference(s1)).to.have.property('size', 1)
    expect(s2.difference(s1).has(peer1)).to.be.false()
    expect(s2.difference(s1).has(peer2)).to.be.true()

    expect(s1.difference(s1)).to.have.property('size', 0)
    expect(s2.difference(s2)).to.have.property('size', 0)
  })

  it('should return union', async () => {
    const peer1 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))
    const peer2 = peerIdFromPrivateKey(await generateKeyPair('Ed25519'))

    const s1 = new PeerSet([peer1])
    const s2 = new PeerSet([peer1, peer2])

    expect(s1.union(s2)).to.have.property('size', 2)
    expect(s1.union(s2).has(peer1)).to.be.true()
    expect(s1.union(s2).has(peer2)).to.be.true()

    expect(s2.union(s1)).to.have.property('size', 2)
    expect(s2.union(s1).has(peer1)).to.be.true()
    expect(s2.union(s1).has(peer2)).to.be.true()

    expect(s1.union(s1)).to.have.property('size', 1)
    expect(s1.union(s1).has(peer1)).to.be.true()
    expect(s1.union(s1).has(peer2)).to.be.false()

    expect(s2.union(s2)).to.have.property('size', 2)
    expect(s2.union(s2).has(peer1)).to.be.true()
    expect(s2.union(s2).has(peer2)).to.be.true()
  })
})
