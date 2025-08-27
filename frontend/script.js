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
    const allowedCodes = new Set(await loadCSV('division2.csv'));
    console.log('Allowed school codes:', allowedCodes.size);

    const genderSelect = document.getElementById('genderDropdown');
    const eventSelect = document.getElementById('eventDropdown');
    const courseSelect = document.getElementById('courseDropdown');
    const showBtn = document.getElementById('showResultsBtn');

    if (!showBtn) {
      console.error('Show Results button not found.');
      return;
    }

    // --- STEP 1: load all events ONCE and populate the dropdown ---
    console.log('Fetching all events for initial dropdown…');
    const allEventsData = await loadResults('/api/results?eventName=Girls 100m Freestyle'); 
    // ^ You might want to change this to a special backend route that lists all events instead of scraping one

    const uniqueEvents = [...new Set(allEventsData.map(r => r.event))].sort();
    populateDropdown(eventSelect, uniqueEvents, 'Select event');

    // --- STEP 2: click handler ---
    showBtn.addEventListener('click', async () => {
      try {
        const eventVal = eventSelect.value;
        const genderVal = genderSelect.value;
        const courseVal = courseSelect.value;

        if (!eventVal) {
          alert('Please select an event first.');
          return;
        }

        const apiUrl = `/api/results?eventName=${encodeURIComponent(eventVal)}`;
        console.log('Fetching results from', apiUrl);

        const results = await loadResults(apiUrl);

        // Filter by allowed codes
        const filtered = results.filter(r => allowedCodes.has(r.schoolCode));

        // Deduplicate (name + time key)
        const unique = Array.from(
          new Map(filtered.map(item => [`${item.name}-${item.time}`, item])).values()
        );

        // Apply gender + course filters (if present)
        const filteredData = unique.filter(r =>
          (genderVal ? r.gender === genderVal : true) &&
          (eventVal ? r.event === eventVal : true) &&
          (courseVal ? r.course === courseVal : true)
        );

        renderTable(filteredData);

      } catch (err) {
        console.error('Error fetching filtered results:', err);
      }
    });

    console.log('Click listener attached');

  } catch (err) {
    console.error('Initialization error:', err);
  }
});
