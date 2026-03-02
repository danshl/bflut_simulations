// ─────────────────────────────────────────────────────────────────────────────
// BFLUT Simulation — Empty DB baseline
//
// This simulation runs on a freshly initialized database (no prior entries).
// The goal is to measure how many unique DB files are accessed during each
// extraction when the Bloom filter table is at its minimal state — i.e. only
// the bits written by the insert phase are present, with no overlap from
// other users. This gives the lower-bound access pattern for the BFLUT scheme.
//
// The simulation is repeated for 3 different DB sizes: 50, 100, and 200 files,
// so we can compare how the number of files affects the extraction behaviour.
//
// Flow (per file count): init DB → insert all users → extract all users → print summary.
// ─────────────────────────────────────────────────────────────────────────────

const { createOrbitDBInstance, openDB, initializeKeys, insertKey, extractKey } = require('./main');

// ── Users ────────────────────────────────────────────────────────────────────

const USERS = [
  { username: 'alice12',      password: 'securePass1!'    },
  { username: 'bob_smith',    password: 'bobRocks42@'     },
  { username: 'charlie.dev',  password: 'charlieCode99$'  },
  { username: 'david_w',      password: 'DavidPass123*'   },
  { username: 'emma.l',       password: 'emmaLovesCats!'  },
  { username: 'frank_t',      password: 'FrankStrongP@ss' },
  { username: 'grace.hopper', password: 'graceCode42#'    },
  { username: 'henry_m',      password: 'HenrySafePass1!' },
  { username: 'isabella_99',  password: 'BellaSecret$22'  },
  { username: 'jack_admin',   password: 'AdminJack#2024'  },
];

const FILE_COUNTS = [50, 100, 200];

// ── Run simulation for one file count ────────────────────────────────────────

async function runForFileCount(orbitdb, fileCount) {
  const dbName = `Simulation_EmptyDB_m${fileCount}_v1`;
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  Running simulation with ${fileCount} files (DB: ${dbName})`);
  console.log(`${'═'.repeat(65)}\n`);

  const db = await openDB(orbitdb, dbName);
  const insertedKeys = {};
  const results = [];

  console.log(`Initializing ${fileCount} DB keys...\n`);
  await initializeKeys(db, fileCount);

  // Phase 1 — Insert all users
  console.log('Phase 1: Inserting all users...\n');
  for (const user of USERS) {
    console.log(`[INSERT] ${user.username}`);
    insertedKeys[user.username] = await insertKey(db, user.username, user.password, true);
    console.log(`[INSERT] ${user.username} → key: ${insertedKeys[user.username]}\n`);
  }

  // Phase 2 — Extract all users
  console.log('Phase 2: Extracting all users...\n');
  for (const user of USERS) {
    console.log(`[EXTRACT] ${user.username}`);
    const { extractedKey, uniqueFilesAccessed, totalFiles } = await extractKey(db, user.username, user.password, true);
    console.log(`[EXTRACT] ${user.username} → key: ${extractedKey}\n`);

    results.push({
      username:    user.username,
      match:       insertedKeys[user.username] === extractedKey ? 'MATCH' : 'MISMATCH',
      uniqueFiles: uniqueFilesAccessed,
      totalFiles,
    });
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('─'.repeat(65));
  console.log(`  RESULTS — ${fileCount} files (Empty DB)`);
  console.log('─'.repeat(65));
  console.log(
    'Username'.padEnd(18) +
    'Key Match'.padEnd(12) +
    'Files Accessed'.padEnd(18) +
    'Total Files'
  );
  console.log('─'.repeat(65));
  results.forEach(r => {
    console.log(
      r.username.padEnd(18) +
      r.match.padEnd(12) +
      String(r.uniqueFiles).padEnd(18) +
      String(r.totalFiles)
    );
  });
  console.log('─'.repeat(65));

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runSimulation() {
  // Create IPFS + OrbitDB once — reused across all three file-count runs
  const orbitdb = await createOrbitDBInstance();
  const allResults = {};

  for (const fileCount of FILE_COUNTS) {
    allResults[fileCount] = await runForFileCount(orbitdb, fileCount);
  }

  // ── Combined comparison table ─────────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(75)}`);
  console.log('  COMBINED COMPARISON — Unique Files Accessed During Extraction (by File Count)');
  console.log(`${'═'.repeat(75)}`);
  console.log(
    'Username'.padEnd(18) +
    'm=50 (extract)'.padEnd(18) +
    'm=100 (extract)'.padEnd(18) +
    'm=200 (extract)'
  );
  console.log('─'.repeat(75));
  USERS.forEach(user => {
    const r50  = allResults[50] .find(r => r.username === user.username);
    const r100 = allResults[100].find(r => r.username === user.username);
    const r200 = allResults[200].find(r => r.username === user.username);
    console.log(
      user.username.padEnd(18) +
      `${r50.uniqueFiles}/${r50.totalFiles}`.padEnd(18) +
      `${r100.uniqueFiles}/${r100.totalFiles}`.padEnd(18) +
      `${r200.uniqueFiles}/${r200.totalFiles}`
    );
  });
  console.log('═'.repeat(75));
}

runSimulation();
