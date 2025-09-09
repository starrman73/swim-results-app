import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  console.log('[results-entry] invoked');
  console.log('[results-version] v2.0-struct');

  try {
    const { gender, event } = req.query;
    const org = 1;

    if (!gender || !event) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    const normalizeCode = str => (str || '').toUpperCase().replace(/[^\w]/g, '');
    const normalizeSchoolName = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isPlaceholder = s => {
      const v = (s || '').trim();
      if (!v) return true;
      const up = v.toUpperCase();
      return ['NULL', 'N/A', 'NA', '-', '—'].includes(up);
    };

    // Load CSV (allowed codes + name map)
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const csvRaw = fs.readFileSync(csvPath, 'utf8');
    const csvLines = csvRaw.replace(/^\uFEFF/, '').trim().split('\n').slice(1);

    const allowedCodes = new Set();
    const schoolNameToCode = new Map();

    for (const line of csvLines) {
      if (!line) continue;
      const parts = line.split(',');
      const code = normalizeCode(parts[0]);
      if (code) allowedCodes.add(code);
      const name = parts[1] ? parts.slice(1).join(',').trim() : '';
      if (name) {
        const key = normalizeSchoolName(name);
        if (key && code) schoolNameToCode.set(key, code);
      }
    }

    const targetUrl = `https://meetdirector.online/reports/report_rankings_enhanced.php?org_id=1&class_id=&div_id=2&course=&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}&pp=50&page=1`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Helper: time detection
    const timeLike = s => {
      const raw = (s || '').trim().toUpperCase();
      if (!raw) return false;
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return true;
      const t = raw.replace(/\(.*?\)/g, '').replace(/[A-Z]$/, '');
      return /^(\d{1,2}:)?\d{1,2}\.\d{2}$/.test(t);
    };
    const normalizeTime = s => {
      const raw = (s || '').trim().toUpperCase();
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return raw;
      return raw.replace(/\(.*?\)\s*/g, '').replace(/[A-Z]$/, '').trim();
    };

    // Heuristic: pick the table with the most rows that look like [rank, name, team, time]
    let bestTable = null;
    let bestScore = -1;

    $('table').each((ti, t) => {
      let score = 0;
      const trs = $(t).find('tbody tr').length ? $(t).find('tbody tr') : $(t).find('tr');
      trs.each((i, tr) => {
        const tds = $(tr).find('td');
        if (tds.length !== 4) return;
        const lastText = $(tds[3]).text().trim();
        if (timeLike(lastText)) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        bestTable = t;
      }
    });

    if (!bestTable || bestScore <= 0) {
      // No structurally matching table found
      return res.status(200).json([]);
    }

    // Parse only rows with exactly 4 tds and time-like last cell (skips detail rows)
    const table = bestTable;
    const rows = ($(table).find('tbody tr').length ? $(table).find('tbody tr') : $(table).find('tr'))
      .filter((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length !== 4) return false;
        const lastText = $(tds[3]).text().trim();
        return timeLike(lastText);
      });

    let results = [];

    rows.each((i, tr) => {
      const tds = $(tr).find('td');
      const rankText = $(tds[0]).text().replace(/\s+/g, ' ').trim(); // not used downstream, but here for clarity
      const nameText = $(tds[1]).text().replace(/\s+/g, ' ').trim(); // e.g., "Quinn Beason" (note: original shows no spaces)
      const teamText = $(tds[2]).text().replace(/\s+/g, ' ').trim(); // e.g., "ESD"
      const timeText = $(tds[3]).text().replace(/\s+/g, ' ').trim();

      const time = normalizeTime(timeText);
      if (!timeLike(time)) return;

      // Resolve school code (team column)
      let schoolCode = '';
      if (!isPlaceholder(teamText)) {
        const normalizedTeam = normalizeCode(teamText); // ensures uppercase/alnum, trims oddities
        schoolCode = normalizedTeam || '';
      }
      if (!schoolCode || !allowedCodes.has(schoolCode)) return;

      const name = (nameText || '').trim();
      results.push({ name, schoolCode, time });
    });

    // Fastest-per-swimmer consolidation
    const timeToSeconds = t => {
      if (/^(?:NT|DQ|NS|DNF)$/i.test(t)) return Infinity;
      const parts = t.split(':').map(parseFloat);
      return parts.length === 1 ? parts[0] : parts[0] * 60 + parts[1];
    };

    const individuals = results.filter(r => r.name && r.name.trim());
    const relays = results.filter(r => !(r.name && r.name.trim()));

    const fastestMap = new Map();
    for (const r of individuals) {
      const key = r.name.trim().toUpperCase();
      const currentBest = fastestMap.get(key);
      if (!currentBest || timeToSeconds(r.time) < timeToSeconds(currentBest.time)) {
        fastestMap.set(key, r);
      }
    }

    results = [...fastestMap.values(), ...relays];

    res.status(200).json(results);
  } catch (err) {
    console.error('[results-error]', err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
