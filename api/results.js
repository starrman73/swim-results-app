import fetch from 'node-fetch';
import cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export default async (req, res) => {
  try {
    const { gender, event, course } = req.query;
    const org = 1; // South Carolina High School League

    if (!gender || !event || !course) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    // Load allowed school codes from CSV (in /public/division2.csv)
    const csvPath = path.join(process.cwd(), 'public', 'division2.csv');
    const allowedCodes = new Set(
      fs.readFileSync(csvPath, 'utf8')
        .trim()
        .split('\n')
        .slice(1)
        .map(line => line.split(',')[0].trim())
    );

    // Build their native query URL
    const targetUrl = `https://toptimesbuild.sportstiming.com/reports/report_rankings.php?org=${org}&gender=${encodeURIComponent(gender)}&event=${encodeURIComponent(eventCode)}&lc=${encodeURIComponent(course)}&100course=0`;

    const html = await fetch(targetUrl).then(r => r.text());
    const $ = cheerio.load(html);

    let results = [];

    // Adjust selectors depending on their markup — most likely table rows
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

    // Deduplicate by name+time
    results = Array.from(
      new Map(results.map(r => [`${r.name}-${r.time}`, r])).values()
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
