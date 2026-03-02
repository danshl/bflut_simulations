// Polyfill CustomEvent for Node.js
const crypto = require('crypto');
if (typeof global.CustomEvent !== "function") {
    global.CustomEvent = function (event, params) {
      params = params || { bubbles: false, cancelable: false, detail: null };
      const evt = new Event(event, { bubbles: params.bubbles, cancelable: params.cancelable });
      evt.detail = params.detail;
      return evt;
    };
  }

  // Creates one IPFS node + OrbitDB instance (call once per process)
  async function createOrbitDBInstance() {
    const IPFS = await import('ipfs');
    const { default: OrbitDB } = await import('orbit-db');
    const ipfs = await IPFS.create();
    return OrbitDB.createInstance(ipfs);
  }

  // Opens (or creates) a named keyvalue store from an existing OrbitDB instance
  async function openDB(orbitdb, dbName) {
    const db = await orbitdb.keyvalue(dbName);
    await db.load();
    console.log(`Database ready: ${dbName}`);
    return db;
  }

  // Convenience: create IPFS + OrbitDB + open DB in one call (single-DB use)
  async function setupOrbitDB(dbName = 'Simulation_v5') {
    const orbitdb = await createOrbitDBInstance();
    return openDB(orbitdb, dbName);
  }

  // Function to initialize 100 keys with value 65535 zeros
  function generateRandomKey() {
    // Generate a 256-bit binary string (32 random bytes, each expanded to 8 bits)
    return Array.from(crypto.randomBytes(32))
      .map(b => b.toString(2).padStart(8, '0'))
      .join('');
  }

  async function initializeKeys(db, count = 100) {
    for (let i = 0; i < count; i++) {
      const key = generateRandomKey();
      const value = '0'.repeat(65535);
      await db.put(key, value);
    }
    console.log(`${count} keys initialized with 65535 zeros`);
  }

// Function to print all keys in the database
async function printAllKeys(db) {
    console.log('All keys in the database:');
    const allEntries = db._index._index;
    for (const key of Object.keys(allEntries)) {
      console.log(key);
    }
  }


// Simulated hash function F(user, password, prefix)
function calculateHash(user, password, prefix) {
    const data = `${user}${password}${prefix}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

function findClosestKey(dbKeys, targetHash) {
    let closestKey = dbKeys[0];
    let minDifference = null;

    const targetBigInt = BigInt('0x' + targetHash); // hex hash → 256-bit BigInt

    dbKeys.forEach((key) => {
      const keyBigInt = BigInt('0b' + key); // binary DB key → 256-bit BigInt
      const diff = targetBigInt > keyBigInt ? targetBigInt - keyBigInt : keyBigInt - targetBigInt;
      if (minDifference === null || diff < minDifference) {
        minDifference = diff;
        closestKey = key;
      }
    });

    return closestKey;
  }

  // Function to turn on bits in the value at positions specified by the 4-bit chunks
  function turnOnBitsAtPositions(value, positions) {
    const valueArray = value.split('');
    positions.forEach((position) => {
      if (position < valueArray.length) {
        valueArray[position] = '1';
      }
    });
    return valueArray.join('');
  }

  // Function to insert a key based on username and password
  async function insertKey(db, username, password, silent = false) {
    const randomKey = generateRandomKey();
    if (!silent) console.log(`Generated key: ${randomKey}`);
    const dbKeys = Object.keys(db._index._index);
    for (let i = 1; i <= randomKey.length; i++) {
      const prefixKey = randomKey.substring(0, i);

      const hashValue = calculateHash(username, password, prefixKey);
      if (!silent) console.log(`Hash for prefix ${prefixKey}: ${hashValue}`);

      const closestKey = findClosestKey(dbKeys, hashValue);
      if (!silent) console.log(`Closest key to hash ${hashValue}: ${closestKey}`);

      const fourBitChunks = hashValue.match(/.{1,4}/g);
      if (!silent) console.log(`4-bit chunks: ${fourBitChunks}`);

      const positions = fourBitChunks.map((chunk) => parseInt(chunk, 16) % 65535);
      if (!silent) console.log(`Positions to turn on bits: ${positions}`);

      let closestValue = db.get(closestKey) || '0'.repeat(65535);
      const newValue = turnOnBitsAtPositions(closestValue, positions);

      await db.put(closestKey, newValue);
      if (!silent) console.log(`Updated ${closestKey} with new value.`);
    }
    return randomKey;
  }


// Check all the bits are on ("1")
function areBitsLit(value, positions) {
    for (const position of positions) {
      if (value[position] !== '1') {
        return false;
      }
    }
    return true;
  }

//Extract the keys by BFULT
  async function extractKey(db, username, password, silent = false) {
    let extractedPrefixes = ['0', '1'];
    const binaryChars = ['0', '1'];

    const uniqueAccessedKeys = new Set(); // track unique DB keys accessed across the full extraction
    const accessesPerStep = [];           // track unique DB keys accessed per bit position
    let lookupAttempts = 0;              // total candidate checks performed

    const dbKeys = Object.keys(db._index._index);
    for (let bitIndex = 0; bitIndex < 256; bitIndex++) {
        const newPrefixes = [];
        const stepKeys = new Set(); // unique keys accessed in this step

        for (const prefix of extractedPrefixes) {
            for (const binaryChar of binaryChars) {
                const newPrefix = prefix + binaryChar;
                lookupAttempts++;

                const hashValue = calculateHash(username, password, newPrefix);

                const closestKey = findClosestKey(dbKeys, hashValue);
                uniqueAccessedKeys.add(closestKey);
                stepKeys.add(closestKey);

                const closestValue = db.get(closestKey) || '0'.repeat(65535);

                const fourBitChunks = hashValue.match(/.{1,4}/g);
                const positions = fourBitChunks.map((chunk) => parseInt(chunk, 16) % 65535);

                if (areBitsLit(closestValue, positions)) {
                    newPrefixes.push(newPrefix);
                    if (!silent) console.log(`Valid prefix: ${newPrefix}`);
                }
            }
        }

        accessesPerStep.push({ step: bitIndex + 1, uniqueKeysAccessed: stepKeys.size });
        if (!silent) console.log(`Bit ${bitIndex + 1}: accessed ${stepKeys.size} unique DB key(s)`);

        if (newPrefixes.length === 0) {
            if (!silent) console.log(`No valid characters found at bit position ${bitIndex}, stopping extraction.`);
            break;
        }
        extractedPrefixes = newPrefixes;
    }

    if (!silent) {
        console.log('\n--- Access Summary ---');
        accessesPerStep.forEach(({ step, uniqueKeysAccessed }) => {
            console.log(`  Bit ${step}: ${uniqueKeysAccessed} unique DB key(s) accessed`);
        });
        console.log(`Total unique DB keys accessed across entire extraction: ${uniqueAccessedKeys.size} / ${dbKeys.length}`);
        console.log('----------------------\n');
    }

    const extractedKey = extractedPrefixes.length > 0 ? extractedPrefixes[0] : null;
    if (!silent) {
        if (extractedKey) console.log(`Extracted key: ${extractedKey}`);
        else console.log('Failed to extract the full key.');
    }
    return { extractedKey, uniqueFilesAccessed: uniqueAccessedKeys.size, totalFiles: dbKeys.length, lookupAttempts };
}


// ── Exports (used by simulation.js) ─────────────────────────────────────────
module.exports = { createOrbitDBInstance, openDB, setupOrbitDB, initializeKeys, printAllKeys, insertKey, extractKey, calculateHash, findClosestKey, areBitsLit };


// ── Example usage (run directly with: node main.js) ──────────────────────────
async function main() {
  const db = await setupOrbitDB();

  // Run only once the first time:
  //await initializeKeys(db);
  await printAllKeys(db);

  //await insertKey(db, 'usernameEx', 'passwordEx');
  await extractKey(db, 'usernameEx', 'passwordEx');
}

// Only run when executed directly (not when imported by simulation.js)
if (require.main === module) {
  main();
}
