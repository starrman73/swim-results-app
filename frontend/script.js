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
document.getElementById('showResultsBtn').addEventListener('click', async () => {
  try {
    const genderVal = document.getElementById('genderDropdown').value;
    const eventVal  = document.getElementById('eventDropdown').value;
    const courseVal = document.getElementById('courseDropdown').value;

    if (!genderVal || !eventVal || !courseVal) {
      alert('Please select gender, event, and course.');
      return;
    }

    const params = new URLSearchParams({
      org: 1,                // default to 1
      gender: genderVal,
      event: eventVal,       // pulled directly from dropdown value
      course: courseVal
    });

    const apiUrl = `/api/results?${params.toString()}`;
    console.log('Fetching from:', apiUrl);

    const results = await loadResults(apiUrl);

    const filtered = results.filter(r => allowedCodes.has(r.schoolCode));
    const unique = Array.from(new Map(
      filtered.map(item => [`${item.name}-${item.time}`, item])
    ).values());

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









