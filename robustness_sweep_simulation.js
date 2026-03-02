// ─────────────────────────────────────────────────────────────────────────────
// BFLUT Robustness Sweep Simulation
//
// Evaluates how file loss (unavailability) affects the extraction process.
// Uses m = 100 files with 65,535 bits each, exactly as implemented in main.js.
//
// For each failure rate ρ ∈ {0%, 5%, 10%, 20%}:
//   1. A fresh DB is initialised with 100 files (all zeros).
//   2. ρ% of files are randomly selected as unavailable for extraction.
//   3. 10 users are inserted using the standard insertion logic (all files available).
//   4. Those same 10 users are extracted with the failed files simulated as
//      returning all-ones — so BOTH prefix+'0' and prefix+'1' survive any
//      lookup that lands on an unavailable file (we cannot eliminate a candidate
//      when the file is unreadable, so both branches are kept).
//   5. Subsequent steps land on different files; if those files are available
//      and the bits are not set, wrong branches are pruned back down naturally.
//   6. Metrics are recorded and printed.
//
// WHY SUCCESS RATE CAN DROP BELOW 100%
//   The correct key is never eliminated — unavailable files always return
//   all-ones so the correct branch always passes areBitsLit(). However, at
//   high ρ, more wrong branches also survive because they too land on
//   unavailable files. This leaves multiple candidates at the end. The standard
//   extractKey() returns only candidates[0], which may not be the correct key.
//
//   This simulation therefore tracks two metrics:
//     - Key recovered: is the correct key anywhere in the surviving candidate set?
//     - Unique result:  did exactly one candidate survive (unambiguous extraction)?
//
// Metrics per ρ:
//   - Avg lookup attempts per extraction
//   - Avg unique files accessed per extraction
//   - Key recovered rate (correct key is in the candidate set — should be 100%)
//   - Unique result rate (exactly one candidate survived — drops with ρ)
//   - Avg candidates surviving at the end
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const fs     = require('fs');
const {
  createOrbitDBInstance, openDB, initializeKeys, insertKey,
  calculateHash, findClosestKey, areBitsLit,
} = require('./main');

const NUM_FILES      = 100;
const USERS_PER_STEP = 10;
const FILE_SIZE      = 65535;
const FAILURE_RATES  = [0, 0.05, 0.10, 0.20];

// ── DB proxy: simulates unreadable files during extraction ───────────────────
//
// When a file is unavailable we return all-ones so areBitsLit() returns true
// and both prefix+'0' and prefix+'1' survive (benefit of the doubt).
// The next step will hash to a different file; if that file is available and
// the bits are not set, the wrong branch is pruned there.

function createFaultInjectedDB(db, failedFiles) {
  return {
    _index: db._index,
    get: (key) => {
      if (failedFiles.has(key)) return '1'.repeat(FILE_SIZE);
      return db.get(key);
    },
  };
}

// ── Extract and return ALL surviving candidate keys ───────────────────────────
//
// Same logic as extractKey() in main.js, but returns the full set of surviving
// prefixes instead of just [0]. This lets us check whether the correct key is
// anywhere in the candidate set, even when multiple candidates survive.

async function extractAllCandidates(db, username, password) {
  let extractedPrefixes    = ['0', '1'];
  const uniqueAccessedKeys = new Set();
  let lookupAttempts       = 0;
  const dbKeys             = Object.keys(db._index._index);

  for (let bitIndex = 0; bitIndex < 256; bitIndex++) {
    const newPrefixes = [];

    for (const prefix of extractedPrefixes) {
      for (const bit of ['0', '1']) {
        const newPrefix  = prefix + bit;
        lookupAttempts++;

        const hashValue    = calculateHash(username, password, newPrefix);
        const closestKey   = findClosestKey(dbKeys, hashValue);
        uniqueAccessedKeys.add(closestKey);

        const closestValue = db.get(closestKey) || '0'.repeat(65535);
        const positions    = hashValue.match(/.{1,4}/g).map(c => parseInt(c, 16) % 65535);

        if (areBitsLit(closestValue, positions)) newPrefixes.push(newPrefix);
      }
    }

    if (newPrefixes.length === 0) break;
    extractedPrefixes = newPrefixes;
  }

  return {
    candidates:         extractedPrefixes,       // full surviving set
    uniqueFilesAccessed: uniqueAccessedKeys.size,
    lookupAttempts,
  };
}

// ── Randomly pick failCount files from dbKeys ─────────────────────────────────

function selectFailedFiles(dbKeys, failCount) {
  const shuffled = [...dbKeys].sort(() => Math.random() - 0.5);
  return new Set(shuffled.slice(0, failCount));
}

// ── Generate a unique user for each slot ──────────────────────────────────────

function makeUser(rho, index) {
  return {
    username: `user_rho${Math.round(rho * 100)}_${index}`,
    password: crypto.randomBytes(8).toString('hex'),
  };
}

// ── Run one ρ level ───────────────────────────────────────────────────────────

async function runForFailureRate(orbitdb, rho) {
  const failPct = Math.round(rho * 100);
  const dbName  = `Robustness_rho${failPct}_v1`;

  process.stdout.write(`\n── ρ = ${failPct}% ─────────────────────────────────────────────\n`);

  const db     = await openDB(orbitdb, dbName);
  await initializeKeys(db, NUM_FILES);
  const dbKeys = Object.keys(db._index._index);

  const failCount   = Math.round(rho * NUM_FILES);
  const failedFiles = selectFailedFiles(dbKeys, failCount);
  console.log(`  Failed files: ${failCount}/${NUM_FILES} (${[...failedFiles].slice(0, 3).map(k => k.slice(0, 8) + '...').join(', ')}${failCount > 3 ? ` +${failCount - 3} more` : failCount === 0 ? 'none' : ''})`);

  // Insert using the full DB (no failures during write)
  process.stdout.write(`  Inserting ${USERS_PER_STEP} users...`);
  const users = Array.from({ length: USERS_PER_STEP }, (_, i) => makeUser(rho, i));
  const insertedKeys = {};
  for (const u of users) {
    insertedKeys[u.username] = await insertKey(db, u.username, u.password, true);
  }
  console.log(' done.');

  const faultDB = createFaultInjectedDB(db, failedFiles);

  process.stdout.write(`  Extracting ${USERS_PER_STEP} users...`);
  let totalLookups      = 0;
  let totalUniqueFiles  = 0;
  let totalCandidates   = 0;
  let recoveredCount    = 0; // correct key is anywhere in the candidate set
  let uniqueResultCount = 0; // exactly one candidate survived (unambiguous)

  for (const u of users) {
    const { candidates, uniqueFilesAccessed, lookupAttempts } =
      await extractAllCandidates(faultDB, u.username, u.password);

    totalLookups     += lookupAttempts;
    totalUniqueFiles += uniqueFilesAccessed;
    totalCandidates  += candidates.length;

    if (candidates.includes(insertedKeys[u.username])) recoveredCount++;
    if (candidates.length === 1)                       uniqueResultCount++;
  }
  console.log(' done.');

  return {
    rho:              `${failPct}%`,
    failedFiles:      failCount,
    avgLookups:       parseFloat((totalLookups    / USERS_PER_STEP).toFixed(1)),
    avgUniqueFiles:   parseFloat((totalUniqueFiles / USERS_PER_STEP).toFixed(1)),
    avgCandidates:    parseFloat((totalCandidates  / USERS_PER_STEP).toFixed(1)),
    recoveredCount,
    uniqueResultCount,
    recoveredRate:    parseFloat(((recoveredCount    / USERS_PER_STEP) * 100).toFixed(1)),
    uniqueResultRate: parseFloat(((uniqueResultCount / USERS_PER_STEP) * 100).toFixed(1)),
  };
}

// ── Main sweep ────────────────────────────────────────────────────────────────

async function runSweep() {
  const orbitdb = await createOrbitDBInstance();
  const results = [];

  for (const rho of FAILURE_RATES) {
    results.push(await runForFailureRate(orbitdb, rho));
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(100));
  console.log('  ROBUSTNESS SWEEP RESULTS — Effect of File Loss on Extraction (m = 100)');
  console.log('  Key Recovered = correct key is anywhere in surviving candidates (never eliminated)');
  console.log('  Unique Result  = exactly 1 candidate survived (unambiguous extraction)');
  console.log('═'.repeat(100));
  console.log(
    'ρ'.padEnd(7) +
    'Failed'.padEnd(9) +
    'Avg Lookups'.padEnd(14) +
    'Avg Files'.padEnd(12) +
    'Avg Candidates'.padEnd(17) +
    'Key Recovered'.padEnd(22) +
    'Unique Result'
  );
  console.log('─'.repeat(100));
  results.forEach(r => {
    console.log(
      r.rho.padEnd(7) +
      String(r.failedFiles).padEnd(9) +
      String(r.avgLookups).padEnd(14) +
      String(r.avgUniqueFiles).padEnd(12) +
      String(r.avgCandidates).padEnd(17) +
      `${r.recoveredRate}% (${r.recoveredCount}/${USERS_PER_STEP})`.padEnd(22) +
      `${r.uniqueResultRate}% (${r.uniqueResultCount}/${USERS_PER_STEP})`
    );
  });
  console.log('═'.repeat(100));

  printCharts(results);
  saveChartsHTML(results);
}

// ── Horizontal bar chart renderer ────────────────────────────────────────────

function renderBar(value, maxValue, barWidth = 40) {
  const filled = maxValue === 0 ? 0 : Math.round((value / maxValue) * barWidth);
  return '[' + '#'.repeat(filled) + '-'.repeat(barWidth - filled) + ']';
}

function printChart(title, results, getValue, formatValue) {
  const maxVal = Math.max(...results.map(getValue));
  console.log(`\n  ${title}`);
  console.log('  ' + '-'.repeat(60));
  results.forEach(r => {
    const val = getValue(r);
    console.log(`  ${r.rho.padEnd(6)} ${renderBar(val, maxVal)} ${formatValue(val)}`);
  });
}

function printCharts(results) {
  console.log('\n\n' + '═'.repeat(60));
  console.log('  VISUALISATION');
  console.log('═'.repeat(60));

  printChart(
    'Key Recovered (%) — correct key in candidate set — should be 100%',
    results,
    r => r.recoveredRate,
    v => `${v}%`
  );

  printChart(
    'Unique Result (%) — exactly 1 candidate survived — drops with ρ',
    results,
    r => r.uniqueResultRate,
    v => `${v}%`
  );

  printChart(
    'Avg Candidates at End — ambiguity grows with ρ',
    results,
    r => r.avgCandidates,
    v => String(v)
  );

  printChart(
    'Avg Lookup Attempts — grows with branching from unreadable files',
    results,
    r => r.avgLookups,
    v => String(v)
  );

  printChart(
    'Avg Unique Files Read — privacy exposure per extraction',
    results,
    r => r.avgUniqueFiles,
    v => String(v)
  );

  console.log('\n' + '═'.repeat(60));
}

// ── HTML chart export ─────────────────────────────────────────────────────────
//
// Writes robustness_results.html — open in any browser, then use
// File → Print → Save as PDF, or right-click a chart → Save Image As.

function saveChartsHTML(results) {
  const labels  = results.map(r => `ρ = ${r.rho}`);
  const colors  = {
    green:  'rgba(34, 197, 94,  0.85)',
    blue:   'rgba(59, 130, 246, 0.85)',
    amber:  'rgba(245,158,  11, 0.85)',
    purple: 'rgba(139, 92, 246, 0.85)',
    red:    'rgba(239, 68,  68, 0.85)',
  };

  const charts = [
    {
      id: 'c1', title: 'Key Recovered (%)',
      subtitle: 'Correct key is anywhere in the surviving candidate set — should always be 100%',
      data: results.map(r => r.recoveredRate), color: colors.green,
      yMax: 110, suffix: '%',
    },
    {
      id: 'c2', title: 'Unique Result (%)',
      subtitle: 'Exactly 1 candidate survived (unambiguous extraction) — drops as ρ grows',
      data: results.map(r => r.uniqueResultRate), color: colors.blue,
      yMax: 110, suffix: '%',
    },
    {
      id: 'c3', title: 'Avg Candidates at End',
      subtitle: 'Number of surviving key candidates after extraction — ambiguity grows with ρ',
      data: results.map(r => r.avgCandidates), color: colors.amber,
      yMax: null, suffix: '',
    },
    {
      id: 'c4', title: 'Avg Lookup Attempts',
      subtitle: 'Total candidate prefix checks per extraction — grows as branching widens',
      data: results.map(r => r.avgLookups), color: colors.purple,
      yMax: null, suffix: '',
    },
    {
      id: 'c5', title: 'Avg Unique Files Read',
      subtitle: 'Distinct DB files accessed per extraction — privacy exposure metric',
      data: results.map(r => r.avgUniqueFiles), color: colors.red,
      yMax: null, suffix: '',
    },
  ];

  const chartScripts = charts.map(c => `
    new Chart(document.getElementById('${c.id}'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: '${c.title}',
          data: ${JSON.stringify(c.data)},
          backgroundColor: '${c.color}',
          borderColor: '${c.color.replace('0.85', '1')}',
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: '${c.title}',
            font: { size: 18, weight: 'bold' },
            padding: { bottom: 4 },
          },
          subtitle: {
            display: true,
            text: '${c.subtitle}',
            font: { size: 13 },
            color: '#666',
            padding: { bottom: 16 },
          },
          tooltip: {
            callbacks: {
              label: ctx => ctx.parsed.y + '${c.suffix}',
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ${c.yMax ? `max: ${c.yMax},` : ''}
            ticks: { callback: v => v + '${c.suffix}' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          x: { grid: { display: false } },
        },
      }
    });
  `).join('\n');

  const canvases = charts.map(c => `
    <div class="card">
      <canvas id="${c.id}"></canvas>
    </div>
  `).join('\n');

  const tableRows = results.map(r => `
    <tr>
      <td>${r.rho}</td>
      <td>${r.failedFiles}</td>
      <td>${r.avgLookups}</td>
      <td>${r.avgUniqueFiles}</td>
      <td>${r.avgCandidates}</td>
      <td class="good">${r.recoveredRate}%&nbsp;(${r.recoveredCount}/${USERS_PER_STEP})</td>
      <td>${r.uniqueResultRate}%&nbsp;(${r.uniqueResultCount}/${USERS_PER_STEP})</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BFLUT Robustness Sweep Results</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
      padding: 40px 24px;
    }
    header { text-align: center; margin-bottom: 40px; }
    header h1 { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
    header p  { font-size: 14px; color: #555; max-width: 680px; margin: auto; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
      gap: 24px;
      max-width: 1100px;
      margin: 0 auto 40px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 28px 24px 20px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    table {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      border-collapse: collapse;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      font-size: 14px;
    }
    th { background: #1a1a2e; color: #fff; padding: 12px 16px; text-align: left; font-weight: 600; }
    td { padding: 11px 16px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #fafafa; }
    .good { color: #16a34a; font-weight: 600; }
    footer { text-align: center; margin-top: 32px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <header>
    <h1>BFLUT Robustness Sweep — Effect of File Loss on Extraction</h1>
    <p>m = 100 files &nbsp;·&nbsp; 10 users per ρ level &nbsp;·&nbsp;
       Unavailable files return all-ones so both branches survive; subsequent
       available-file checks prune wrong branches naturally.</p>
  </header>

  <div class="grid">
    ${canvases}
  </div>

  <table>
    <thead>
      <tr>
        <th>ρ</th><th>Failed files</th><th>Avg Lookups</th>
        <th>Avg Files Read</th><th>Avg Candidates</th>
        <th>Key Recovered</th><th>Unique Result</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <footer>Generated by robustness_sweep_simulation.js &nbsp;·&nbsp; BFLUT implementation</footer>

  <script>
    ${chartScripts}
  </script>
</body>
</html>`;

  const outFile = 'robustness_results.html';
  fs.writeFileSync(outFile, html, 'utf8');
  console.log(`\nCharts saved → ${outFile}`);
  console.log('Open in a browser. To export as image: right-click a chart → Save Image As,');
  console.log('or File → Print → Save as PDF for the full report.\n');
}

runSweep();
