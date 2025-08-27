import fetch from 'node-fetch';
import cheerio from 'cheerio';

function timeToSeconds(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0];
}

export default async (req, res) => {
  try {
    const { eventName } = req.query; // e.g. "?eventName=Girls 100m Freestyle"
    if (!eventName) {
      return res.status(400).json({ error: 'Missing eventName query param' });
    }

    const html = await fetch(
      'https://sportstiming.com/south-carolina-high-school-swimming-top-times'
    ).then(r => r.text());

    const $ = cheerio.load(html);
    let results = [];

    $('h3').each((_, header) => {
      if ($(header).text().trim() === eventName) {
        $(header).next('table').find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length === 3) {
            const name = $(cells[0]).text().trim();
            const schoolCode = $(cells[1]).text().trim();
            const time = $(cells[2]).text().trim();

            if (time) {
              results.push({
                event: eventName,
                name,
                schoolCode,
                time,
                timeSeconds: timeToSeconds(time)
              });
            }
          }
        });
      }
    });

    results.sort((a, b) => a.timeSeconds - b.timeSeconds);
    results.forEach((item, idx) => {
      item.rank = idx + 1;
      delete item.timeSeconds;
    });

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event results' });
  }
};
