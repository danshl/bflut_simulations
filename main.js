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
  
  // OrbitDB Setup Function
  async function setupOrbitDB() {
    const IPFS = await import('ipfs');
    const { default: OrbitDB } = await import('orbit-db');
    const ipfs = await IPFS.create();
    const orbitdb = await OrbitDB.createInstance(ipfs);
    const db = await orbitdb.keyvalue('Simulation_v1');
    await db.load();
    console.log('Database is ready');
    return db;
  }
  
  // Function to initialize 100 keys with value 65535 zeros
  function generateRandomKey() {
    return crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'); // Generate a SHA-256 key as a hex string
  }
  
  async function initializeKeys() {
    const db = await setupOrbitDB();
    for (let i = 0; i < 100; i++) {
      const key = generateRandomKey();  
      const value = '0'.repeat(65535);  
      await db.put(key, value);
      //console.log(`Inserted ${key}: ${value}`);
    }
    console.log('100 SHA-256 keys initialized with 65535 zeros');
  }
  
// Function to print all keys in the database
async function printAllKeys() {
    const db = await setupOrbitDB();
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
    let minDifference = Infinity;
  
    dbKeys.forEach((key) => {
      const difference = Math.abs(parseInt(key, 16) - parseInt(targetHash, 16));
      if (difference < minDifference) {
        minDifference = difference;
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
  async function insertKey(username, password) {
    const db = await setupOrbitDB(); 
    const randomKey = generateRandomKey();
    console.log(`Generated SHA-256 key: ${randomKey}`);
    const dbKeys = Object.keys(db._index._index);
    for (let i = 1; i <= randomKey.length; i++) {
      const prefixKey = randomKey.substring(0, i);

      const hashValue = calculateHash(username, password, prefixKey);
      console.log(`Hash for prefix ${prefixKey}: ${hashValue}`);

      const closestKey = findClosestKey(dbKeys, hashValue);
      console.log(`Closest key to hash ${hashValue}: ${closestKey}`);

      const fourBitChunks = hashValue.match(/.{1,4}/g); 
      console.log(`4-bit chunks: ${fourBitChunks}`);
  
      const positions = fourBitChunks.map((chunk) => parseInt(chunk, 16) % 65535);
      console.log(`Positions to turn on bits: ${positions}`);
  
      let closestValue = db.get(closestKey) || '0'.repeat(65535); 
      const newValue = turnOnBitsAtPositions(closestValue, positions);
      //console.log(`Updated value for closest key: ${newValue}`);
  
      await db.put(closestKey, newValue);
      console.log(`Updated ${closestKey} with new value.`);
      console.log(randomKey)
    }
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
  async function extractKey(username, password) {
    const db = await setupOrbitDB();  // Setup OrbitDB instance

    let extractedPrefixes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    const hexChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

    const dbKeys = Object.keys(db._index._index);
    for (let hexIndex = 0; hexIndex < 64; hexIndex++) {
        const newPrefixes = []; 

        for (const prefix of extractedPrefixes) {
            for (const hexChar of hexChars) {
                const newPrefix = prefix + hexChar;

                const hashValue = calculateHash(username, password, newPrefix);

                const closestKey = findClosestKey(dbKeys, hashValue);

                const closestValue = db.get(closestKey) || '0'.repeat(65535);

                const fourBitChunks = hashValue.match(/.{1,4}/g); 
                const positions = fourBitChunks.map((chunk) => parseInt(chunk, 16) % 65535);

                if (areBitsLit(closestValue, positions)) {
                    newPrefixes.push(newPrefix);
                    console.log(`Valid prefix: ${newPrefix}`);
                }
            }
        }
        if (newPrefixes.length === 0) {
            console.log(`No valid characters found at position ${hexIndex}, stopping extraction.`);
            break;
        }
        extractedPrefixes = newPrefixes;
    }

    if (extractedPrefixes.length > 0) {
        const finalKey = extractedPrefixes[0];
        console.log(`Extracted key: ${finalKey}`);
    } else {
        console.log('Failed to extract the full key.');
    }
}




//Define the db
//setupOrbitDB()

// Initalize and create 100 sha-256 keys
//initializeKeys()
//printAllKeys()


//insertKey('usernameEx', 'passwordEx');
//1969d928427c5e35050a725d52f18d9f58d202a7f993cde801b57bb0da9a6c11
extractKey('usernameEx', 'passwordEx');

