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

    // Load allowed school codes from CSV
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const allowedCodes = new Set(
      fs.readFileSync(csvPath, 'utf8')
        .trim()
        .split('\n')
        .slice(1)
        .map(line => line.split(',')[0].trim())
    );

    // Build native query URL
    const targetUrl = `https://toptimesbuild.sportstiming.com/reports/report_rankings.php?org=${org}&gender=${encodeURIComponent(gender)}&event=${encodeURIComponent(event)}&lc=${encodeURIComponent(course)}&100course=0`;

    const resp = await fetch(targetUrl);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Debug: table & row inspection
const tables = $('table');
console.log(`DEBUG: Found ${tables.length} <table> element(s)`);

tables.each((ti, table) => {
  const rowCount = $(table).find('tr').length;
  console.log(`DEBUG: Table[${ti}] has ${rowCount} <tr> row(s)`);

  // Show first 3 parsed rows from this table
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


    console.log('Target URL:', targetUrl);
    console.log('Status:', resp.status);
    console.log('HTML length:', html.length);
    console.log('Snippet:', html.substring(0, 300));


    let results = [];

    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 3) {
        const name = $(cells[0]).text().trim();
        const schoolCode = $(cells[1]).text().trim();
        const time = $(cells[2]).text().trim();

        if (name && time && allowedCodes.has(schoolCode)) {
          results.push({ name, schoolCode, time });
        }
      }
    });

    // Deduplicate by name + time
    results = Array.from(
      new Map(results.map(r => [`${r.name}-${r.time}`, r])).values()
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
