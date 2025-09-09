import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
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

    const targetUrl = `https://meetdirector.online/reports/report_rankings_enhanced.php?course=&div_id=2&org_id=1&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Helpers for header handling
    const normalizeHeader = h =>
      (h || '').toLowerCase().trim().replace(/\s+/g, '').replace(/\(.*?\)/g, '');

    const getHeaderTexts = t => {
      // Prefer thead th; fallback to first row th; final fallback to first row td
      const $t = $(t);
      const ths = $t.find('thead tr:last-child th');
      if (ths.length) return ths.map((_, el) => $(el).text().trim()).get();
      const firstTrTh = $t.find('tr').first().find('th');
      if (firstTrTh.length) return firstTrTh.map((_, el) => $(el).text().trim()).get();
      const firstTrTd = $t.find('tr').first().find('td');
      if (firstTrTd.length) return firstTrTd.map((_, el) => $(el).text().trim()).get();
      return [];
    };

    // Find the exact Rankings table by header sequence
    const expected = ['rank', 'name', 'team', 'time'];
    let table = null;
    let headerCells = [];

    $('table').each((i, t) => {
      const headers = getHeaderTexts(t);
      const norm = headers.map(normalizeHeader);
      if (
        norm.length >= 4 &&
        norm[0] === expected[0] &&
        norm[1] === expected[1] &&
        norm[2] === expected[2] &&
        norm[3] === expected[3]
      ) {
        table = t;
        headerCells = headers;
        return false; // break
      }
      return true;
    });

    // Fallback: find the table within the Rankings card
    if (!table) {
      const cardTable = $('h1')
        .filter((_, el) => $(el).text().trim().toLowerCase() === 'rankings')
        .closest('div.card')
        .find('table')
        .first()
        .get(0);

      if (cardTable) {
        const headers = getHeaderTexts(cardTable);
        const norm = headers.map(normalizeHeader);
        if (norm.length) {
          table = cardTable;
          headerCells = headers;
        }
      }
    }

    if (!table) {
      return res.status(200).json([]);
    }

    // Build header index (and bias "team" as school when present)
    function buildHeaderIndex(cells) {
      const cleaned = cells.map(normalizeHeader);
      const idx = {};
      cleaned.forEach((h, i) => {
        if (idx.rank == null && (h === '#' || h === 'rank')) idx.rank = i;
        if (idx.name == null && (h === 'name' || h === 'swimmer' || h === 'athlete')) idx.name = i;
        if (idx.school == null && (h === 'school' || h === 'highschool' || h === 'hs' || h === 'team')) idx.school = i;
        if (idx.team == null && h === 'team') idx.team = i;
        if (idx.time == null && (h === 'time' || h.startsWith('time'))) idx.time = i;
      });
      return { idx, cleaned };
    }

    const { idx: headerIndex, cleaned: cleanedHeaders } = buildHeaderIndex(headerCells);

    // If headers exactly match the expected sequence, enforce indices as a sanity check
    const cleanedEq = cleanedHeaders.map(normalizeHeader);
    if (
      cleanedEq.length >= 4 &&
      cleanedEq[0] === expected[0] &&
      cleanedEq[1] === expected[1] &&
      cleanedEq[2] === expected[2] &&
      cleanedEq[3] === expected[3]
    ) {
      headerIndex.rank = 0;
      headerIndex.name = 1;
      headerIndex.team = 2;
      headerIndex.school = 2;
      headerIndex.time = 3;
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
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return raw;
      return raw.replace(/\(.*?\)/g, '').replace(/[A-Z]$/, '').trim();
    };

    const isCodeToken = s => {
      if (isPlaceholder(s)) return false;
      const v = (s || '').trim();
      return /^[A-Z0-9]{2,6}$/.test(v) && v === v.toUpperCase();
    };

    const mapSchoolNameToCode = s => {
      const key = normalizeSchoolName(s);
      if (!key) return '';
      return schoolNameToCode.get(key) || '';
    };

    const findTimeInRow = cellsText => {
      if (headerIndex.time != null) {
        const v = cellsText[headerIndex.time];
        if (timeLike(v)) return normalizeTime(v);
      }
      for (const v of cellsText) {
        if (timeLike(v)) return normalizeTime(v);
      }
      return '';
    };

    const findSchoolCodeInRow = cellsText => {
      if (headerIndex.school != null) {
        const rawSchool = cellsText[headerIndex.school];
        if (!isPlaceholder(rawSchool)) {
          if (isCodeToken(rawSchool)) return normalizeCode(rawSchool);
          const mapped = mapSchoolNameToCode(rawSchool);
          if (mapped) return mapped;
        }
      }
      if (headerIndex.team != null) {
        const rawTeam = normalizeCode(cellsText[headerIndex.team]);
        if (rawTeam) return rawTeam;
      }
      return '';
    };

    let results = [];

    // Only parse swimmer rows; ignore the interleaved detail rows
    let rows = $(table).find('tbody > tr.clickable');
    if (!rows.length) {
      // Fallback: some pages might omit tbody or class
      rows = $(table).find('tr.clickable');
    }
    if (!rows.length) {
      // Last fallback: all body rows minus .detail
      rows = $(table).find('tbody tr').filter((_, el) => !$(el).hasClass('detail'));
    }

    rows.each((i, row) => {
      const cellsText = $(row)
        .find('td')
        .map((ci, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();

      if (!cellsText.length) return;

      const time = findTimeInRow(cellsText);
      if (!time) return;

      let name = null;
      let schoolCode = null;

      if (headerIndex.name != null) {
        name = (cellsText[headerIndex.name] || '').trim();
        schoolCode = findSchoolCodeInRow(cellsText) || null;
      } else if (headerIndex.team != null) {
        const rawTeamCell = cellsText[headerIndex.team] || '';
        schoolCode = normalizeCode(rawTeamCell);
        name = '';
      }

      if (!schoolCode || !allowedCodes.has(schoolCode)) return;

      results.push({ name, schoolCode, time });
    });

    // Fastest-per-swimmer consolidation
    const timeToSeconds = t => {
      if (/^(?:NT|DQ|NS|DNF)$/i.test(t)) return Infinity;
      const parts = t.split(':').map(parseFloat);
      return parts.length === 1 ? parts[0] : parts[0] * 60 + parts[1];
    };

    const individuals = results.filter(r => headerIndex.name != null && r.name && r.name.trim());
    const relays = results.filter(r => !(headerIndex.name != null && r.name && r.name.trim()));

    const fastestMap = new Map();
    for (const r of individuals) {
      const key = r.name.trim().toUpperCase();
      const best = fastestMap.get(key);
      if (!best || timeToSeconds(r.time) < timeToSeconds(best.time)) {
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
