# BFLUT — Bloom Filter Look-Up Tables for Private and Secure Distributed Databases in Web3

This is an implementation of the scheme described in the article
**"Bloom Filter Look-Up Tables for Private and Secure Distributed Databases in Web3"**.

The core idea is to store and retrieve secret keys (e.g. derived from a username + password) inside a distributed, decentralized database (OrbitDB over IPFS) using **Bloom Filter Look-Up Tables (BFLUTs)**. The database holds no plaintext credentials — membership is verified probabilistically via Bloom filter bit patterns, preserving privacy.

---

## How It Works

1. **The database** consists of 100 SHA-256 keys, each mapped to a 65,535-bit string (initially all zeros).
2. **Inserting a key** — given a `(username, password)` pair, a random SHA-256 key is generated. For every prefix of that key, a hash `F(user, password, prefix)` is computed, the closest DB key is found, and certain bit positions in its value are turned on (`'1'`). This encodes membership without storing the credential directly.
3. **Extracting a key** — given the same `(username, password)`, the algorithm reconstructs the original key character-by-character by checking which prefix candidates have all their expected bits already set in the DB — essentially a Bloom filter membership query at each step.

---

## Setup & Usage

All steps must be run **in order** on first use.

### 1. Install dependencies
```bash
npm install
```

### 2. Start the database *(first time only)*
Uncomment and run `setupOrbitDB()` in `main.js`:
```js
setupOrbitDB()
```
This starts the local IPFS node and creates the OrbitDB key-value store named `Simulation_v1` on disk. **Run only once** — the store is persisted locally after the first run.

### 3. Initialize the 100 keys
Uncomment and run `initializeKeys()` in `main.js`:
```js
initializeKeys()
```
This populates the database with 100 random SHA-256 keys, each initialized to a string of 65,535 zeros. **Run this only once.**

---

## Methods

### `setupOrbitDB()`
Starts the IPFS node and connects to the OrbitDB instance.
**Run only once, the first time** — this sets up the local IPFS node and creates the OrbitDB store on disk. After the first run, the store is persisted locally and subsequent calls simply reopen it. Must be called before any other operation.

### `initializeKeys()`
Populates the database with 100 random SHA-256 keys, each with a value of 65,535 zero bits.
**Run only once** — calling it again will add duplicate/overwritten entries.

### `insertKey(username, password)`
Encodes a credential pair into the BFLUT.
Generates a random SHA-256 key and, for each prefix of that key, computes a hash and turns on the corresponding bit positions in the nearest DB entry.

```js
insertKey('usernameEx', 'passwordEx');
// Example generated key: 1969d928427c5e35050a725d52f18d9f58d202a7f993cde801b57bb0da9a6c11
```

### `extractKey(username, password)`
Reconstructs the previously inserted key from the same `(username, password)` pair using Bloom filter membership queries — without storing the key or credentials anywhere in plaintext.

```js
extractKey('usernameEx', 'passwordEx');
```

---

## Known Issues

- If you get a `LockExistsError` for `~/.jsipfs/repo.lock`, a previous process did not shut down cleanly. Delete the lock and retry:
  ```bash
  rm -rf ~/.jsipfs/repo.lock
  ```
- The `orbitdb/` folder is runtime cache. If you see CID-related errors on startup, delete it and re-run:
  ```bash
  rm -rf orbitdb/
  ```
