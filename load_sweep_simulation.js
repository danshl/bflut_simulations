// ─────────────────────────────────────────────────────────────────────────────
// BFLUT Load/Saturation Sweep Simulation
//
// Measures how increasing bit occupancy (α) affects the extraction process.
//
// Method:
//   - Start with a fresh DB (100 files × 65,535 bits, all zeros).
//   - For each target α level (10%, 20%, ..., 90%):
//       1. Randomly turn on bits across all files until global α is reached.
//       2. Insert 10 users using the standard insertion logic.
//       3. Extract those same 10 users.
//       4. Measure actual α (from the DB files directly), average lookup
//          attempts, and average unique files accessed per extraction.
//
// Expected behaviour:
//   Low α  → few false positives → narrow branching → few file accesses.
//   High α → many false positives → wide branching → many file accesses.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { createOrbitDBInstance, openDB, initializeKeys, insertKey, extractKey } = require('./main');

const FILE_SIZE      = 65535;   // bits per DB file
const NUM_FILES      = 100;
const USERS_PER_STEP = 10;
const ALPHA_LEVELS   = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

// ── Measure actual α across all DB files ─────────────────────────────────────

function measureAlpha(db, dbKeys) {
  let onBits = 0;
  for (const key of dbKeys) {
    const value = db.get(key) || '0'.repeat(FILE_SIZE);
    for (const ch of value) if (ch === '1') onBits++;
  }
  return onBits / (dbKeys.length * FILE_SIZE);
}

// ── Fill all DB files to a target α by randomly turning on additional bits ───

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function fillToAlpha(db, dbKeys, targetAlpha) {
  const targetBitsPerFile = Math.floor(targetAlpha * FILE_SIZE);
  for (const key of dbKeys) {
    const value   = db.get(key) || '0'.repeat(FILE_SIZE);
    const current = (value.match(/1/g) || []).length;
    const needed  = targetBitsPerFile - current;
    if (needed <= 0) continue;

    // Collect all zero positions, shuffle, pick the ones to flip
    const zeros = [];
    for (let i = 0; i < value.length; i++) if (value[i] === '0') zeros.push(i);
    shuffle(zeros);

    const arr = value.split('');
    zeros.slice(0, needed).forEach(pos => { arr[pos] = '1'; });
    await db.put(key, arr.join(''));
  }
}

// ── Generate a simple unique user for each slot ───────────────────────────────

function makeUser(alphaLevel, index) {
  return {
    username: `user_a${Math.round(alphaLevel * 100)}_${index}`,
    password: crypto.randomBytes(8).toString('hex'),
  };
}

// ── Main sweep ────────────────────────────────────────────────────────────────

async function runSweep() {
  const orbitdb = await createOrbitDBInstance();
  const db      = await openDB(orbitdb, 'Simulation_LoadSweep');
  await initializeKeys(db);
  const dbKeys = Object.keys(db._index._index);

  const results = [];

  for (const targetAlpha of ALPHA_LEVELS) {
    const pct = (targetAlpha * 100).toFixed(0);
    console.log(`\n── α = ${pct}% ──────────────────────────────────────────`);

    // Step 1: fill random bits up to target α
    process.stdout.write(`  Filling to α = ${pct}%...`);
    await fillToAlpha(db, dbKeys, targetAlpha);
    console.log(' done.');

    // Step 2: insert 10 users
    process.stdout.write(`  Inserting ${USERS_PER_STEP} users...`);
    const users = Array.from({ length: USERS_PER_STEP }, (_, i) => makeUser(targetAlpha, i));
    for (const u of users) await insertKey(db, u.username, u.password, true);
    console.log(' done.');

    // Step 3: measure actual α after insertions
    const actualAlpha = measureAlpha(db, dbKeys);

    // Step 4: extract and collect metrics
    process.stdout.write(`  Extracting ${USERS_PER_STEP} users...`);
    let totalLookups      = 0;
    let totalUniqueFiles  = 0;
    for (const u of users) {
      const { lookupAttempts, uniqueFilesAccessed } = await extractKey(db, u.username, u.password, true);
      totalLookups     += lookupAttempts;
      totalUniqueFiles += uniqueFilesAccessed;
    }
    console.log(' done.');

    results.push({
      targetPct:       `${pct}%`,
      actualPct:       `${(actualAlpha * 100).toFixed(2)}%`,
      avgLookups:      (totalLookups     / USERS_PER_STEP).toFixed(1),
      avgUniqueFiles:  (totalUniqueFiles / USERS_PER_STEP).toFixed(1),
    });
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(68));
  console.log('  LOAD SWEEP RESULTS — Effect of Bit Occupancy (α) on Extraction');
  console.log('═'.repeat(68));
  console.log(
    'Target α'.padEnd(12) +
    'Actual α'.padEnd(12) +
    'Avg Lookups'.padEnd(16) +
    'Avg Unique Files'
  );
  console.log('─'.repeat(68));
  results.forEach(r => {
    console.log(
      r.targetPct.padEnd(12) +
      r.actualPct.padEnd(12) +
      r.avgLookups.padEnd(16) +
      r.avgUniqueFiles
    );
  });
  console.log('═'.repeat(68));
}

runSweep();
