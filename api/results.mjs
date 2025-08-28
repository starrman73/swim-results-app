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

    const normalizeSchoolName = s =>
      (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const isPlaceholder = s => {
      const v = (s || '').trim();
      if (!v) return true;
      const up = v.toUpperCase();
      return up === 'NULL' || up === 'N/A' || up === 'NA' || up === '-' || up === '—';
    };

    // Load CSV: expect first column=code, second column=school name
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const csvLines = fs
      .readFileSync(csvPath, 'utf8')
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
      const name = parts[1] ? parts.slice(1).join(',').trim() : ''; // tolerate commas in name
      if (name) {
        const key = normalizeSchoolName(name);
        if (key && code) schoolNameToCode.set(key, code);
      }
    }

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

    // Grab first table with header cells
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

    const looksLikeHumanName = s => {
      const v = (s || '').trim();
      if (!v) return false;
      if (/[a-z]/.test(v)) return true;        // has lowercase
      if (/\s/.test(v)) return true;           // has space (first last)
      if (/[,'-]\s?/.test(v)) return true;     // has punctuation typical of names
      // Reject short all-caps tokens that are likely codes
      if (/^[A-Z0-9]{2,6}$/.test(v)) return false;
      // Longer strings without spaces are probably not names either
      return v.length > 8;
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

    // Individuals: derive school code from School col, or map school name -> code, or Name col if it's a code
    const findSchoolCodeInRow = cellsText => {
      // Explicit School column
      if (headerIndex.school != null) {
        const rawSchool = cellsText[headerIndex.school];
        if (!isPlaceholder(rawSchool)) {
          const asCode = looksLikeCode(rawSchool);
          if (asCode) return asCode;
          const mapped = mapSchoolNameToCode(rawSchool);
          if (mapped) return mapped;
        }
      }
      // Name column might be a code (privacy-masked tables)
      if (headerIndex.name != null) {
        const rawName = cellsText[headerIndex.name];
        const asCode = looksLikeCode(rawName);
        if (asCode) return asCode;
      }
      // Team column fallback
      if (headerIndex.team != null) {
        const rawTeam = cellsText[headerIndex.team];
        const asCode = looksLikeCode(rawTeam);
        if (asCode) return asCode;
      }
      // Any cell
      for (const v of cellsText) {
        const c = looksLikeCode(v);
        if (c) return c;
      }
      return '';
    };

    const findNameInRow = cellsText => {
      if (headerIndex.name != null) {
        const raw = (cellsText[headerIndex.name] || '').trim();
        // If the "Name" cell is actually a school code, don't use it as a person name
        if (looksLikeCode(raw) && !looksLikeHumanName(raw)) return '';
        if (looksLikeHumanName(raw)) return raw;
      }
      // Heuristic fallback: pick longest non-time, non-code, non-rank cell
      const rankedIdx = headerIndex.rank ?? -1;
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
        const team =
          (headerIndex.team != null ? cellsText[headerIndex.team] : cellsText[1]) || '';
        const timeCell =
          (headerIndex.time != null ? cellsText[headerIndex.time] : '') ||
          cellsText.find(timeLike) ||
          '';

        if (team && timeCell) {
          results.push({
            name: team.trim(),      // UI expects 'name'
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
      const schoolCode = findSchoolCodeInRow(cellsText) || null;

      // If Name cell is a code and School is empty, treat it as schoolCode and leave name blank
      let name = findNameInRow(cellsText);
      if (!schoolCode && headerIndex.name != null) {
        const raw = (cellsText[headerIndex.name] || '').trim();
        if (looksLikeCode(raw) && !looksLikeHumanName(raw)) {
          // use the code from Name as schoolCode
          const codeFromName = looksLikeCode(raw);
          if (codeFromName) {
            name = ''; // no person name available
          }
        }
      }

      if (time) {
        results.push({
          name: name || null,
          schoolCode: schoolCode,
          time
        });
      } else {
        console.log('ROW SKIPPED INDIV DEBUG:', { cellsText, name, schoolCode, time });
      }
    });

    // Deduplicate: prefer schoolCode when name is missing
    results = Array.from(
      new Map(
        results.map(r => [
          `${(r.name && r.name.trim()) || r.schoolCode}-${r.time}`,
          r
        ])
      ).values()
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
