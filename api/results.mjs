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
      (str || '').toUpperCase().replace(/[^\w]/g, '');

    const isPlaceholder = s => {
      const v = (s || '').trim();
      if (!v) return true;
      const up = v.toUpperCase();
      return up === 'NULL' || up === 'N/A' || up === 'NA' || up === '-' || up === '—';
    };

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

    // Find first table with header cells
    const tables = $('table');
    let table = null;
    let headerCells = [];
    tables.each((ti, t) => {
      const ths = $(t).find('tr').first().find('th');
      if (ths.length) {
        table = t;
        headerCells = ths.map((i, el) => $(el).text().trim()).get();
        return false;
      }
    });

    if (!table) {
      console.warn('No table with headers found.');
      return res.status(200).json([]);
    }

    // Header normalization and indexing
    const normalizeHeader = h =>
      (h || '').toLowerCase().trim().replace(/\s+/g, '').replace(/\(.*?\)/g, '');

    function buildHeaderIndex(cells) {
      const cleaned = cells.map(normalizeHeader);
      const idx = {};
      cleaned.forEach((h, i) => {
        if (idx.rank == null && (h === '#' || h === 'rank')) idx.rank = i;
        if (idx.name == null && (h === 'name' || h === 'swimmer')) idx.name = i;
        if (idx.school == null && (h === 'school' || h === 'highschool' || h === 'hs')) idx.school = i;
        if (idx.team == null && h === 'team') idx.team = i;
        if (idx.time == null && (h === 'time' || h.startsWith('time'))) idx.time = i;
      });
      return { idx, cleaned };
    }

    const { idx: headerIndex, cleaned: cleanedHeaders } = buildHeaderIndex(headerCells);

    const detectRelay = idx => idx.team != null && idx.name == null;
    const isRelay = detectRelay(headerIndex);

    console.log('DEBUG headerCells:', headerCells);
    console.log('DEBUG cleanedHeaders:', cleanedHeaders);
    console.log('DEBUG headerIndex:', headerIndex);
    console.log('Relay table:', isRelay);

    // Helpers
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

    const looksLikeCode = s => {
      if (isPlaceholder(s)) return '';
      const c = normalizeCode(s);
      return /^[A-Z0-9]{2,6}$/.test(c) ? c : '';
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

    // Prefer explicit School; if placeholder/empty, fall back to Name (if code) or Team (if available)
    const findSchoolCodeInRow = cellsText => {
      // 1) School column
      if (headerIndex.school != null) {
        const v = cellsText[headerIndex.school];
        const c = looksLikeCode(v);
        if (c) return c; // only accept non-placeholder codes
      }
      // 2) Name column as code (privacy-masked tables often use team code in Name)
      if (headerIndex.name != null) {
        const v = cellsText[headerIndex.name];
        const c = looksLikeCode(v);
        if (c) return c;
      }
      // 3) Team column as fallback
      if (headerIndex.team != null) {
        const v = cellsText[headerIndex.team];
        const c = looksLikeCode(v);
        if (c) return c;
      }
      // 4) Any other cell containing a plausible code
      for (const v of cellsText) {
        const c = looksLikeCode(v);
        if (c) return c;
      }
      return '';
    };

    const findNameInRow = cellsText => {
      if (headerIndex.name != null) {
        const v = (cellsText[headerIndex.name] || '').trim();
        if (v) return v;
      }
      // Fallback heuristic: choose the longest non-time, non-rank, non-code cell
      const rankedIdx = headerIndex.rank ?? 0;
      let best = '';
      cellsText.forEach((v, idx) => {
        const val = (v || '').trim();
        if (!val) return;
        if (idx === rankedIdx) return;
        if (timeLike(val)) return;
        if (looksLikeCode(val)) return;
        if (val.length > best.length) best = val;
      });
      return best;
    };

    let results = [];

    const rows = $(table).find('tbody tr').length
      ? $(table).find('tbody tr')
      : $(table).find('tr').slice(1);

    rows.each((i, row) => {
      const cellsText = $(row)
        .find('td')
        .map((ci, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();

      if (!cellsText.some(v => v && v.length)) return;

      if (isRelay) {
        // Relay: use team and time, do not enforce allowedCodes
        const team =
          (headerIndex.team != null ? cellsText[headerIndex.team] : cellsText[1]) || '';
        const timeCell =
          (headerIndex.time != null ? cellsText[headerIndex.time] : '') ||
          cellsText.find(timeLike) ||
          '';

        if (team && timeCell) {
          results.push({
            name: team.trim(),
            schoolCode: null,
            time: normalizeTime(timeCell)
          });
        } else {
          console.log('ROW SKIPPED RELAY DEBUG:', { cellsText, team, timeCell });
        }
        return;
      }

      // Individuals
      const time = findTimeInRow(cellsText);
      const inferredSchool = findSchoolCodeInRow(cellsText);
      const name = findNameInRow(cellsText);

      if (name && time) {
        results.push({
          name,
          schoolCode: inferredSchool || null,
          time
        });
      } else {
        console.log('ROW SKIPPED INDIV DEBUG:', { cellsText, name, inferredSchool, time });
      }
    });

    // Deduplicate by name-time combo
    results = Array.from(new Map(results.map(r => [`${r.name}-${r.time}`, r])).values());

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
