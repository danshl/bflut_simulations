# BFLUT — Bloom Filter Look-Up Tables for Private and Secure Distributed Databases in Web3

Implementation of the scheme described in the article
**"Bloom Filter Look-Up Tables for Private and Secure Distributed Databases in Web3"**.

The core idea is to store and retrieve secret keys derived from `(username, password)` pairs inside a distributed, decentralised database (OrbitDB over IPFS) using **Bloom Filter Look-Up Tables (BFLUTs)**. The database holds no plaintext credentials — membership is verified probabilistically via Bloom filter bit patterns, preserving privacy.

---

## How It Works

1. **The database** consists of `m` files (keys), each mapped to a 65,535-bit string (initially all zeros).
2. **Inserting a key** — a random 256-bit binary key is generated. For every prefix of that key, a hash `F(user, password, prefix)` is computed, the closest DB file is found (by numerical distance), and certain bit positions in its value are turned on (`'1'`). This encodes membership without storing any credential.
3. **Extracting a key** — given the same `(username, password)`, the algorithm reconstructs the original key one bit at a time. At each position it tries appending `'0'` or `'1'` to every surviving prefix, checks via Bloom filter membership whether all expected bits are set, and keeps only the candidates that pass. The number of unique DB files accessed during this search is the key privacy metric.

---

## File Structure

| File | Purpose |
|---|---|
| `main.js` | Core logic and all exported functions |
| `empty_db_m_sweep.js` | Simulation 1 — Empty-DB baseline across m = 50, 100, 200 files |
| `load_sweep_simulation.js` | Simulation 2 — Saturation sweep: effect of bit occupancy (α) on extraction |
| `robustness_sweep_simulation.js` | Simulation 3 — Robustness sweep: effect of file loss (ρ) on extraction |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run a simulation
Each simulation script handles its own DB setup internally — no manual initialisation needed. Just run:
```bash
node empty_db_m_sweep.js
node load_sweep_simulation.js
node robustness_sweep_simulation.js
```

Each script calls `initializeKeys(db, count)` internally, which creates the IPFS node, opens the DB, and populates it with fresh all-zero files before the simulation starts.

---

## DB Naming — `openDB(orbitdb, dbName)`

Each simulation uses a **unique database name** passed to `openDB(orbitdb, dbName)`. This is important because OrbitDB persists data to disk under that name. By giving each simulation its own name, runs are fully isolated — a previous run's data never interferes with a new one.

Examples:
| Script | DB name used |
|---|---|
| `empty_db_m_sweep.js` | `Simulation_EmptyDB_m50`, `_m100`, `_m200` |
| `load_sweep_simulation.js` | `Simulation_LoadSweep` |
| `robustness_sweep_simulation.js` | `Robustness_rho0`, `Robustness_rho5`, etc. |

If you want a completely fresh run, delete the `orbitdb/` folder:
```bash
rm -rf orbitdb/
```

---

## API (`main.js`)

### `createOrbitDBInstance()`
Creates one IPFS node and one OrbitDB instance. **Call once per process** — IPFS only allows one node at a time (enforced by a lock file). Returns the OrbitDB instance.

### `openDB(orbitdb, dbName)`
Opens (or creates) a named key-value store from an existing OrbitDB instance. Each simulation calls this once per DB it needs, all sharing the same OrbitDB instance to avoid the IPFS lock.

### `initializeKeys(db, count = 100)`
Populates the database with `count` random 256-bit binary keys, each initialised to 65,535 zero bits. **Run only once on a fresh DB** — calling it again adds more entries on top.

### `insertKey(db, username, password, silent = false)`
Encodes a `(username, password)` credential into the BFLUT. Generates a random 256-bit binary key and, for each bit-prefix, turns on the corresponding Bloom filter positions in the nearest DB file. Returns the generated key.

### `extractKey(db, username, password, silent = false)`
Reconstructs the inserted key from the same `(username, password)` using Bloom filter membership queries. Returns:
- `extractedKey` — the reconstructed 256-bit binary key
- `uniqueFilesAccessed` — distinct DB files read **during extraction** (privacy metric)
- `totalFiles` — total files in the DB
- `lookupAttempts` — total candidate prefix checks performed (cost metric)

> `uniqueFilesAccessed` and `lookupAttempts` are measured during **extraction only** — the insert phase does not contribute to these counts.

---

## Simulations

### Simulation 1 — `empty_db_m_sweep.js`
**Question:** How does the number of files (m) affect extraction on a fresh DB?

```bash
node empty_db_m_sweep.js
```

Runs on a freshly initialised DB with no prior bit overlap. Inserts 10 users then extracts them across three DB sizes: **m = 50, 100, 200**. Reports how many unique files were accessed **during extraction** for each user and size. Ends with a combined comparison table across all three sizes.

This gives the **lower-bound access pattern** — the minimum number of files exposed when the DB has only the bits written by the current users.

---

### Simulation 2 — `load_sweep_simulation.js`
**Question:** How does increasing bit occupancy (α) affect extraction cost?

```bash
node load_sweep_simulation.js
```

Starts with an empty DB (m = 100) and gradually fills random bits to reach α = 10%, 20%, ..., 90%. At each level, inserts 10 fresh users and extracts them. Reports per α level:
- **Actual α** — measured directly by counting set bits across all DB files
- **Avg Lookups** — average total candidate checks per extraction
- **Avg Unique Files** — average distinct files accessed per extraction

Expected trend: as α grows → more false positives → more prefix candidates survive each step → lookups and file accesses grow rapidly.

---

### Simulation 3 — `robustness_sweep_simulation.js`
**Question:** How does file unavailability (ρ) affect extraction success and cost?

```bash
node robustness_sweep_simulation.js
```

Uses m = 100 files. For each failure rate **ρ ∈ {0%, 5%, 10%, 20%}**, ρ% of files are randomly selected as unavailable. Insertion always uses the full DB. During extraction, reads to unavailable files return all-ones — meaning the bit-check passes and **both** `prefix+'0'` and `prefix+'1'` survive (since we cannot eliminate a candidate when the file is unreadable). Reports per ρ:
- **Avg Lookups** — grows as more unresolvable files widen the branching
- **Avg Files Read** — distinct files accessed per extraction
- **Success Rate** — percentage of extractions that fully reconstructed the correct key

Results are shown as both a **table** and **horizontal bar charts** for each metric.

Expected trend: as ρ grows → more files return all-ones → wider branching → more lookups and files accessed, but the correct key is never eliminated so success rate stays high.

---

## Known Issues

- **`LockExistsError`** — a previous process did not shut down cleanly. Delete the stale lock:
  ```bash
  rm -rf ~/.jsipfs/repo.lock
  ```
- **CID errors on startup** — stale OrbitDB cache. Delete and re-run:
  ```bash
  rm -rf orbitdb/
  ```
- **Multiple DBs in one process** — always use `createOrbitDBInstance()` once and then `openDB()` for each DB. Never create more than one IPFS node per process or it will hit the lock.
