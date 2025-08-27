async function loadCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map(line => line.split(',')[0]); // schoolCode from first column
}

async function loadResults(apiUrl) {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${apiUrl} (${res.status})`);
  }
  return await res.json();
}

function populateDropdown(selectElem, items, defaultLabel) {
  selectElem.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = defaultLabel;
  selectElem.appendChild(defaultOpt);

  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    selectElem.appendChild(opt);
  });
}

function renderTable(data) {
  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = '';
  data.forEach(swimmer => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${swimmer.name}</td>
      <td>${swimmer.schoolCode}</td>
      <td>${swimmer.event}</td>
      <td>${swimmer.time}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM fully loaded');

  try {
    // --- Load CSV of allowed school codes ---
    const allowedCodes = new Set(await loadCSV('division2.csv'));
    console.log('Loaded school codes:', allowedCodes.size);

    const genderSelect = document.getElementById('genderDropdown');
    const eventSelect = document.getElementById('eventDropdown');
    const courseSelect = document.getElementById('courseDropdown');
    const showBtn = document.getElementById('showResultsBtn');

    if (!showBtn) {
      console.error('Show Results button not found.');
      return;
    }

    // --- Populate event dropdown from a known source ---
    // Ideally, replace this with a backend route that returns all event names
    // For now, we'll populate it manually or from a known list
    const initialEvents = [
      "Girls 100m Freestyle",
      "Boys 100m Freestyle",
      "Girls 200m Medley Relay"
      // ...add more here or fetch from backend if available
    ];
    populateDropdown(eventSelect, initialEvents, 'Select event');

    // --- Click handler for "Show Results" ---
    showBtn.addEventListener('click', async () => {
      try {
        let eventVal = eventSelect.value;
        const genderVal = genderSelect.value;
        const courseVal = courseSelect.value;

        if (!eventVal) {
          alert('Please select an event first.');
          return;
        }

        // Strip " (number)" and trim extra spaces
        const cleanEvent = eventVal.replace(/\s*\(\d+\)\s*$/, '').trim();

        const apiUrl = `/api/results?eventName=${encodeURIComponent(cleanEvent)}`;
        console.log('Fetching from:', apiUrl);

        const results = await loadResults(apiUrl);

        // Filter to allowed school codes
        const filtered = results.filter(r => allowedCodes.has(r.schoolCode));

        // Deduplicate by name + time
        const unique = Array.from(
          new Map(filtered.map(item => [`${item.name}-${item.time}`, item])).values()
        );

        // Apply dropdown filters
        const filteredData = unique.filter(r =>
          (genderVal ? r.gender === genderVal : true) &&
          (eventVal ? r.event === eventVal : true) &&
          (courseVal ? r.course === courseVal : true)
        );

        renderTable(filteredData);

      } catch (err) {
        console.error('Error on Show Results click:', err);
      }
    });

    console.log('Click listener attached');

  } catch (err) {
    console.error('Initialization error:', err);
  }
});


