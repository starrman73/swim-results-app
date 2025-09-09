import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  // Debug toggle: add ?debug=1 to your request
  const DEBUG =
    String(req.query.debug || '').toLowerCase() === 'true' ||
    String(req.query.debug || '') === '1';

  const dlog = (...args) => {
    if (DEBUG) console.log('[results-debug]', ...args);
  };

  try {
    const { gender, event } = req.query;
    const org = 1;

    dlog('Incoming query params:', { gender, event, org });

    if (!gender || !event) {
      dlog('Missing required query params.');
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
    let csvRaw = '';
    try {
      csvRaw = fs.readFileSync(csvPath, 'utf8');
    } catch (e) {
      dlog('Failed to read CSV at path:', csvPath, e?.message);
      return res.status(500).json({ error: 'CSV not found or unreadable' });
    }

    const csvLines = csvRaw.replace(/^\uFEFF/, '').trim().split('\n').slice(1);
    dlog('CSV lines (without header):', csvLines.length);

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

    dlog('Allowed codes count:', allowedCodes.size);
    // Show a small sample
    if (DEBUG) {
      const sample = Array.from(allowedCodes).slice(0, 10);
      dlog('Allowed codes sample:', sample);
    }

    const targetUrl = `https://meetdirector.online/reports/report_rankings_enhanced.php?course=&div_id=2&org_id=1&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}`;

    dlog('Target URL:', targetUrl);

    let resp;
    try {
      resp = await fetch(targetUrl);
    } catch (e) {
      dlog('Fetch failed:', e?.message);
      return res.status(500).json({ error: 'Failed to fetch target URL' });
    }

    const status = resp.status;
    dlog('Fetch status:', status);

    const html = await resp.text();
    dlog('HTML length:', html.length);
    if (DEBUG) {
      dlog('HTML contains "<table>" count:', (html.match(/<table/gi) || []).length);
      dlog('HTML contains "Rankings" text:', html.includes('Rankings'));
      dlog('HTML contains "thead" count:', (html.match(/<thead/gi) || []).length);
    }

    const $ = cheerio.load(html);

    // Locate the table and headers
    let headerCells = [];
    let table = null;

    $('table').each((ti, t) => {
      const theadThs = $(t).find('thead tr:last-child th');
      const ths = theadThs.length ? theadThs : $(t).find('tr').first().find('th');
      const thTexts = ths.map((i, el) => $(el).text().trim()).get();

      dlog(`Table[${ti}] th count:`, ths.length, 'headers:', thTexts);

      if (ths.length >= 2) {
        table = t;
        headerCells = thTexts;
        return false; // break
      }
    });

    if (!table) {
      dlog('No table with headers found. Returning empty array.');
      return res.status(200).json([]);
    }

    // HTML conformity check to the posted structure
    // Expecting: Rank, Name, Team, Time (case-insensitive)
    const expectedHeaders = ['rank', 'name', 'team', 'time'];
    const normalizeHeader = h =>
      (h || '').toLowerCase().trim().replace(/\s+/g, '').replace(/\(.*?\)/g, '');

    const normalizedHeaders = headerCells.map(normalizeHeader);
    dlog('Detected headerCells:', headerCells);
    dlog('Normalized headers:', normalizedHeaders);

    const headersOk =
      expectedHeaders.length === normalizedHeaders.length &&
      expectedHeaders.every((h, i) => normalizedHeaders[i] === h);

    dlog('Headers match expected [rank,name,team,time]:', headersOk);
    if (!headersOk) {
      dlog('Header mismatch. Expected:', expectedHeaders, 'Got:', normalizedHeaders);
    }

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
    dlog('Header index:', headerIndex);
    dlog('Cleaned headers:', cleanedHeaders);

    // Prepare row selection: exclude detail rows
    let allBodyRows = $(table).find('tbody tr');
    const totalTrs = allBodyRows.length;
    dlog('tbody tr count (raw):', totalTrs);

    const rows = allBodyRows.filter((i, el) => {
      const cls = $(el).attr('class') || '';
      const keep = !cls.includes('detail');
      if (!keep && i < 10) dlog(`Filtered out detail row[${i}] class=`, cls);
      return keep;
    });

    dlog('tbody tr count (after filtering detail):', rows.length);

    // Stats
    let stats = {
      rowsSeen: rows.length,
      skippedEmpty: 0,
      skippedNoTime: 0,
      skippedNoSchool: 0,
      skippedNotAllowed: 0,
      parsedOk: 0
    };

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
      // Try school column first (may alias to 'team' by header mapping)
      if (headerIndex.school != null) {
        const rawSchool = cellsText[headerIndex.school];
        if (!isPlaceholder(rawSchool)) {
          if (isCodeToken(rawSchool)) return normalizeCode(rawSchool);
          const mapped = mapSchoolNameToCode(rawSchool);
          if (mapped) return mapped;
        }
      }
      // Try explicit team column
      if (headerIndex.team != null) {
        const rawTeam = normalizeCode(cellsText[headerIndex.team]);
        if (rawTeam) return rawTeam;
      }
      return '';
    };

    let results = [];
    const seenTeams = new Set();

    rows.each((i, row) => {
      const rowHtml = $(row).html();
      const tds = $(row).find('td');
      const cellsText = tds
        .map((ci, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();

      if (i < 10) {
        dlog(`Row[${i}] tdCount=`, tds.length);
        dlog(`Row[${i}] cellsText=`, cellsText);
      }

      if (!cellsText.some(v => v && v.length)) {
        stats.skippedEmpty++;
        if (i < 10) dlog(`Row[${i}] skipped: empty cellsText`);
        return;
      }

      const time = findTimeInRow(cellsText);
      if (!time) {
        stats.skippedNoTime++;
        if (i < 10) dlog(`Row[${i}] skipped: no time found`);
        return;
      }

      let name = null;
      let schoolCode = null;

      if (headerIndex.name != null) {
        const rawNameCell = cellsText[headerIndex.name] || '';
        name = rawNameCell.trim();
        schoolCode = findSchoolCodeInRow(cellsText) || null;
      } else if (headerIndex.team != null) {
        const rawTeamCell = cellsText[headerIndex.team] || '';
        schoolCode = normalizeCode(rawTeamCell);
        name = '';
      }

      // Track team presence
      if (headerIndex.team != null && cellsText[headerIndex.team]) {
        seenTeams.add(normalizeCode(cellsText[headerIndex.team]));
      }

      if (!schoolCode) {
        stats.skippedNoSchool++;
        if (i < 10) dlog(`Row[${i}] skipped: schoolCode not resolved`, { name, time, cellsText });
        return;
      }

      const allowed = allowedCodes.has(schoolCode);
      if (!allowed) {
        stats.skippedNotAllowed++;
        if (i < 10) dlog(`Row[${i}] skipped: schoolCode not in allowedCodes`, { schoolCode, name, time });
        return;
      }

      results.push({ name, schoolCode, time });
      stats.parsedOk++;

      if (i < 10) dlog(`Row[${i}] parsed OK:`, { name, schoolCode, time });
    });

    // Timing helpers and post-processing
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
      const currentBest = fastestMap.get(key);
      if (!currentBest || timeToSeconds(r.time) < timeToSeconds(currentBest.time)) {
        fastestMap.set(key, r);
      }
    }

    results = [...fastestMap.values(), ...relays];

    // Final debug summary
    dlog('Seen teams (normalized):', Array.from(seenTeams));
    dlog('Stats:', stats);
    dlog('Results count (after fastest merge):', results.length);
    if (DEBUG && results.length) {
      dlog('Results sample:', results.slice(0, 10));
    }

    res.status(200).json(results);
  } catch (err) {
    console.error('[results-error]', err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
