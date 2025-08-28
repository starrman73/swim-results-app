import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  try {
    const { gender, event, course } = req.query;
    const org = 1;

    if (!gender || !event || !course) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    const normalizeCode = str => (str || '').toUpperCase().replace(/[^\w]/g, '');
    const normalizeSchoolName = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isPlaceholder = s => {
      const v = (s || '').trim();
      if (!v) return true;
      const up = v.toUpperCase();
      return ['NULL','N/A','NA','-','—'].includes(up);
    };

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

    const targetUrl = `https://toptimesbuild.sportstiming.com/reports/report_rankings.php?org=${org}&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}&lc=${encodeURIComponent(course)}&100course=0`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    let headerCells = [];
    let table = null;

    $('table').each((ti, t) => {
      const theadThs = $(t).find('thead tr:last-child th');
      const ths = theadThs.length ? theadThs : $(t).find('tr').first().find('th');
      if (ths.length >= 2) {
        table = t;
        headerCells = ths.map((i, el) => $(el).text().trim()).get();
        return false;
      }
    });

    if (!table) {
      console.warn('No table with headers found.');
      return res.status(200).json([]);
    }

    const normalizeHeader = h =>
      (h || '').toLowerCase().trim().replace(/\s+/g, '').replace(/\(.*?\)/g, '');

    function buildHeaderIndex(cells) {
      const cleaned = cells.map(normalizeHeader);
      const idx = {};
      cleaned.forEach((h, i) => {
        if (idx.rank == null && (h === '#' || h === 'rank')) idx.rank = i;
        if (idx.name == null && (h === 'name' || h === 'swimmer' || h === 'athlete')) idx.name = i;
        if (idx.school == null && (h === 'school' || h === 'highschool' || h === 'hs')) idx.school = i;
        if (idx.team == null && h === 'team') idx.team = i;
        if (idx.time == null && (h === 'time' || h.startsWith('time'))) idx.time = i;
      });
      return { idx, cleaned };
    }

    const { idx: headerIndex } = buildHeaderIndex(headerCells);

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
        const rawTeam = cellsText[headerIndex.team];
        if (isCodeToken(rawTeam)) return normalizeCode(rawTeam);
      }
      return '';
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

      const time = findTimeInRow(cellsText);
      if (!time) return;

      let name = null;
      let schoolCode = null;

      if (headerIndex.name != null) {
        // Individual swimmer
        const rawNameCell = cellsText[headerIndex.name] || '';
        name = rawNameCell.trim();
        schoolCode = findSchoolCodeInRow(cellsText) || null;
      } else if (headerIndex.team != null) {
        // Relay
        const rawTeamCell = cellsText[headerIndex.team] || '';
        schoolCode = normalizeCode(rawTeamCell);
        name = ''; // <-- empty string instead of null
      }

      if (!schoolCode || !allowedCodes.has(schoolCode)) return;

      results.push({ name: name, schoolCode, time });
    });

    // Deduplicate
    results = Array.from(
      new Map(
        results.map(r => [
          //`${(r.name && r.name.trim()) || r.schoolCode || 'UNKNOWN'}-${r.time}`,
          `${(r.name !== null && r.name !== undefined ? r.name.trim() : '') || r.schoolCode || 'UNKNOWN'}-${r.time}`,
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
