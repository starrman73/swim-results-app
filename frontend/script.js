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

    // --- Click handler for "Show Results" ---
// --- Click handler for "Show Results" ---
showBtn.addEventListener('click', async () => {
  try {
    const genderVal = genderSelect.value;  // "M" or "F"
    const eventVal  = eventSelect.value;   // e.g. "I:C:100"
    const courseVal = courseSelect.value;  // e.g. "3" for SC Yards

    if (!genderVal || !eventVal || !courseVal) {
      alert('Please select gender, event, and course.');
      return;
    }

    // Build API URL with correct param name for event
    const apiUrl = `/api/results?gender=${encodeURIComponent(genderVal)}&event=${encodeURIComponent(eventVal)}&course=${encodeURIComponent(courseVal)}`;
    console.log('Fetching from:', apiUrl);

    const results = await loadResults(apiUrl);

    // Filter to allowed school codes from CSV
    const filtered = results.filter(r => allowedCodes.has(r.schoolCode));

    // Deduplicate by name + time
    const unique = Array.from(
      new Map(filtered.map(item => [`${item.name}-${item.time}`, item])).values()
    );

    renderTable(unique);

  } catch (err) {
    console.error('Error on Show Results click:', err);
  }
});


    console.log('Click listener attached');

  } catch (err) {
    console.error('Initialization error:', err);
  }
});






