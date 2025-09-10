import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  console.log('[results-entry] API route invoked');
  console.log('[results-version] v2.3-target-rankings');

  try {
    const { gender, event } = req.query;

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

    // Load allowed codes
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const csvLines = fs.readFileSync(csvPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n')
      .slice(1);

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

    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    console.log('[fetch-status]', resp.status);
    let html = await resp.text();
    console.log('[contains-table]', html.includes('<table'));
    console.log('[html-length]', html.length);
    console.log('[html-snippet-raw]', html.slice(0, 500));

    // Fix malformed tags before parsing
    html = html
      .replace(/<thstyle/gi, '<th style')
      .replace(/<thclass/gi, '<th class')
      .replace(/<trclass/gi, '<tr class')
      .replace(/<trid=/gi, '<tr id=')
      .replace(/<tdclass/gi, '<td class')
      .replace(/<tdcolspan/gi, '<td colspan')
      .replace(/<theadclass/gi, '<thead class')
      .replace(/<tbodyclass/gi, '<tbody class');

    const $ = cheerio.load(html);

    // Directly target the Rankings table
    const rankingsTable = $('h1')
      .filter((_, el) => $(el).text().trim().toLowerCase() === 'rankings')
      .closest('.card')
      .find('table')
      .first();

    if (!rankingsTable.length) {
      console.warn('[results] Rankings table not found');
      return res.status(200).json([]);
    }

    const timeLike = s => {
      const raw = (s || '').trim().toUpperCase();
      if (!raw) return false;
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return true;
      const t = raw.replace(/\(.*?\)/g, '').replace(/[A-Z]$/, '');
      return /^(\d{1,2}:)?\d{1,2}\.\d{2}$/.test(t);
    };
    const normalizeTime = s => {
      const raw = (s || '').trim().toUpperCase();
      if (/^(?:NT|DQ|NS|DNF)$/i.test(raw)) return raw;
      return raw.replace(/\(.*?\)/g, '').replace(/[A-Z]$/, '').trim();
    };

    const rows = rankingsTable.find('tbody tr').filter((_, tr) => {
      const tds = $(tr).find('td');
      return tds.length >= 4 && timeLike($(tds[3]).text().trim());
    });

    let results = [];
    rows.each((_, tr) => {
      const tds = $(tr).find('td');
      const name = $(tds[1]).text().replace(/\s+/g, ' ').trim();
      const team = $(tds[2]).text().replace(/\s+/g, ' ').trim();
      const time = normalizeTime($(tds[3]).text());

      let schoolCode = '';
      if (!isPlaceholder(team)) {
        schoolCode = normalizeCode(team);
      }
      if (!schoolCode || !allowedCodes.has(schoolCode)) return;

      results.push({ name, schoolCode, time });
    });

    // Keep fastest per swimmer
    const timeToSeconds = t => {
      if (/^(?:NT|DQ|NS|DNF)$/i.test(t)) return Infinity;
      const parts = t.split(':').map(parseFloat);
      return parts.length === 1 ? parts[0] : parts[0] * 60 + parts[1];
    };
    const fastestMap = new Map();
    for (const r of results) {
      const key = r.name.trim().toUpperCase();
      const best = fastestMap.get(key);
      if (!best || timeToSeconds(r.time) < timeToSeconds(best.time)) {
        fastestMap.set(key, r);
      }
    }
    results = [...fastestMap.values()];

    console.log('[results-count]', results.length);
    if (results.length) {
      console.log('[results-sample]', results.slice(0, 3));
    }

    res.status(200).json(results);
  } catch (err) {
    console.error('[results-error]', err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
