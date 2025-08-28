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

    // Normalization function — use for BOTH CSV + scraped values
    const normalizeCode = str =>
      (str || '')
        .toUpperCase()
        .replace(/[^\w]/g, ''); // keep only A–Z / 0–9

    // Load allowed school codes from CSV
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const allowedCodes = new Set(
      fs.readFileSync(csvPath, 'utf8')
        .replace(/^\uFEFF/, '') // strip BOM if present
        .trim()
        .split('\n')
        .slice(1)
        .map(line => normalizeCode(line.split(',')[0]))
        .filter(Boolean)
    );

    console.log('DEBUG allowedCodes sample:', [...allowedCodes].slice(0, 15));

    // Build native query URL
    const targetUrl = `https://toptimesbuild.sportstiming.com/reports/report_rankings.php?org=${org}&gender=${encodeURIComponent(
      gender
    )}&event=${encodeURIComponent(event)}&lc=${encodeURIComponent(
      course
    )}&100course=0`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // ===== Combined debug block =====
    console.log('================ ENTERED TABLE DEBUG BLOCK ================');
    console.log(
      'DEBUG: HTML START >>>',
      html.substring(0, 500),
      '<<< HTML END SNIPPET'
    );

    const tables = $('table');
    console.log(`DEBUG: Found ${tables.length} <table> element(s)`);

    // Inspect first table header (used only to detect relays safely)
    const headerCells = tables.first().find('tr').first().find('th')
      .map((i, el) => $(el).text().trim().toLowerCase())
      .get();

    // Only treat as relay if the header clearly shows team and NOT name
    const isRelay = headerCells.includes('team') && !headerCells.includes('name');

    console.log('Detected event type (conservative):', isRelay ? 'relay' : 'individual');

    tables.each((ti, table) => {
      const rowCount = $(table).find('tr').length;
      console.log(`DEBUG: Table[${ti}] has ${rowCount} <tr> row(s)`);
      $(table)
        .find('tr')
        .slice(0, 3)
        .each((ri, row) => {
          const cells = $(row)
            .find('th, td')
            .map((ci, cell) => $(cell).text().trim())
            .get();
          console.log(`DEBUG: Table[${ti}] Row[${ri}]:`, cells);
        });
    });
    // ===== End debug block =====

    console.log('Target URL:', targetUrl);
    console.log('Status:', resp.status);
    console.log('HTML length:', html.length);
    console.log('Snippet:', html.substring(0, 300));

    let results = [];

    // Important: keep your original individual parsing intact
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;

      if (isRelay) {
        // Relay table typically: Rank | Team | Time (sometimes more cols)
        // Map conservatively to avoid breaking single-swimmer flow
        const team = cells.eq(1).text().trim();
        const time = cells.eq(2).text().trim();
        if (team && time) {
          // Preserve original schema keys to avoid downstream breakage
          results.push({ name: team, schoolCode: null, time });
        }
        return;
      }

      // Original logic for individuals (unchanged)
      if (cells.length >= 4) {
        const name = $(cells[1]).text().trim();
        const schoolCode = normalizeCode($(cells[2]).text());
        const time = $(cells[3]).text().trim();

        if (name && time && allowedCodes.has(schoolCode)) {
          results.push({ name, schoolCode, time });
        }
      }
    });

    // Deduplicate by name + time (unchanged)
    results = Array.from(
      new Map(results.map(r => [`${r.name}-${r.time}`, r])).values()
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
