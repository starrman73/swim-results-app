import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  try {
    const { gender, event, course } = req.query;
    const org = 1; // South Carolina High School League

    if (!gender || !event || !course) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    const normalizeCode = str =>
      (str || '')
        .toUpperCase()
        .replace(/[^\w]/g, '');

    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const allowedCodes = new Set(
      fs.readFileSync(csvPath, 'utf8')
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\n')
        .slice(1)
        .map(line => normalizeCode(line.split(',')[0]))
        .filter(Boolean)
    );

    console.log('DEBUG allowedCodes sample:', [...allowedCodes].slice(0, 15));

    const targetUrl = `https://toptimesbuild.sportstiming.com/reports/report_rankings.php?org=${org}&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}&lc=${encodeURIComponent(
      course
    )}&100course=0`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    console.log('Target URL:', targetUrl);
    console.log('Status:', resp.status);
    console.log('HTML length:', html.length);

    const tables = $('table');
    let table = null;
    let headerCells = [];
    tables.each((ti, t) => {
      const ths = $(t).find('tr').first().find('th');
      if (ths.length) {
        table = t;
        headerCells = ths
          .map((i, el) => $(el).text().trim().toLowerCase())
          .get();
        return false;
      }
    });

    if (!table) {
      console.warn('No table with headers found.');
      return res.status(200).json([]);
    }

    const headerIndex = {};
    headerCells.forEach((h, i) => {
      const key = h.replace(/\s+/g, ' ').replace(/[^a-z]/g, '');
      const canonical =
        key.includes('rank') ? 'rank' :
        key.includes('name') ? 'name' :
        key.includes('school') ? 'school' :
        key.includes('team') ? 'team' :
        key.includes('time') ? 'time' :
        key;
      if (!(canonical in headerIndex)) headerIndex[canonical] = i;
    });

    console.log('DEBUG headerCells:', headerCells);
    console.log('DEBUG headerIndex:', headerIndex);

    const timeLike = (s) => {
      const raw = (s || '').trim().toUpperCase();
      if (!raw) return false;
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return true;
      const t = raw.replace(/[A-Z]$/, '');
      return /^(\d{1,2}:)?\d{1,2}\.\d{2}$/.test(t);
    };

    const normalizeTime = (s) => {
      const raw = (s || '').trim().toUpperCase();
      if (/^(?:NT|DQ|NS|DNF)$/.test(raw)) return raw;
      return raw.replace(/[A-Z]$/, '');
    };

    const looksLikeCode = (s) => {
      const c = normalizeCode(s);
      return /^[A-Z0-9]{2,6}$/.test(c) ? c : '';
    };

    const findAllowedCodeInRow = (cellsText) => {
      if ('school' in headerIndex) {
        const v = cellsText[headerIndex.school];
        const c = looksLikeCode(v);
        if (c && allowedCodes.has(c)) return c;
      }
      if ('team' in headerIndex) {
        const v = cellsText[headerIndex.team];
        const c = looksLikeCode(v);
        if (c && allowedCodes.has(c)) return c;
      }
      for (const v of cellsText) {
        const c = looksLikeCode(v);
        if (c && allowedCodes.has(c)) return c;
      }
      return '';
    };

    const findTimeInRow = (cellsText) => {
      if ('time' in headerIndex) {
        const v = cellsText[headerIndex.time];
        if (timeLike(v)) return normalizeTime(v);
      }
      for (const v of cellsText) {
        if (timeLike(v)) return normalizeTime(v);
      }
      return '';
    };

    const findNameInRow = (cellsText) => {
      if ('name' in headerIndex) {
        const v = cellsText[headerIndex.name]?.trim();
        if (v) return v;
      }
      const rankedIdx = 'rank' in headerIndex ? headerIndex.rank : 0;
      let best = '';
      cellsText.forEach((v, idx) => {
        const val = (v || '').trim();
        if (!val) return;
        if (idx === rankedIdx) return;
        if (timeLike(val)) return;
        const asCode = looksLikeCode(val);
        if (asCode && allowedCodes.has(asCode)) return;
        if (val.length > best.length) best = val;
      });
      return best;
    };

    let results = [];

    const rows = $(table).find('tbody tr').length
      ? $(table).find('tbody tr')
      : $(table).find('tr').slice(1);

    // Determine if this is really a relay
    const eventLower = (event || '').toLowerCase();
    const headerHasTeam = headerCells.includes('team');
    const headerHasName = headerCells.includes('name');

    const cleanedHeaders = headerCells.map(h =>
  h.toLowerCase().replace(/\s+/g, '').replace(/\(.*?\)/g, '')
);
    
    const isRelay =
    headerHasTeam &&
    !headerHasName &&
    (eventLower.includes('relay') ||
     eventLower.includes('medley') ||
     eventLower.includes('free relay'));

    console.log('Relay detection:', isRelay);

    rows.each((i, row) => {
      const tds = $(row).find('td');
      if (!tds.length) return;

      const cellsText = tds
        .map((ci, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();

      if (!cellsText.some(v => v && v.length)) return;

      if (isRelay) {
        // Relay: use team and time, skip allowedCodes filtering
        const team = cellsText[headerIndex.team] || cellsText[1];
        const time =
          ('time' in headerIndex && cellsText[headerIndex.time]) ||
          cellsText.find(timeLike);

        if (team && time) {
          results.push({
            name: team,
            schoolCode: null,
            time: normalizeTime(time)
          });
        }
        return; // skip individual parsing
      }

      const time = findTimeInRow(cellsText);
      const schoolCode = findAllowedCodeInRow(cellsText);
      const name = findNameInRow(cellsText);

      if (name && time && schoolCode && allowedCodes.has(schoolCode)) {
        results.push({ name, schoolCode, time });
      } else {
        console.log('ROW SKIPPED DEBUG:', { cellsText, name, schoolCode, time });
      }
    });

    results = Array.from(
      new Map(results.map(r => [`${r.name}-${r.time}`, r])).values()
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
