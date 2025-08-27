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

function populateDropdown(selectElem, items) {
  selectElem.innerHTML = ''; // clear existing
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = `Select ${selectElem.id.replace('Dropdown','')}`;
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
    console.log('Loading CSV…');
    const allowedCodes = new Set(await loadCSV('division2.csv'));
    console.log('CSV loaded', allowedCodes.size);

    const genderSelect = document.getElementById('genderDropdown');
    const eventSelect = document.getElementById('eventDropdown');
    const courseSelect = document.getElementById('courseDropdown');
    const showBtn = document.getElementById('showResultsBtn');

    if (!showBtn) {
      console.error('Show Results button not found.');
      return;
    }

    // We'll populate events after we have data
    showBtn.addEventListener('click', async () => {
      try {
        console.log('Show Results clicked');

        console.log('Loading results…');
        const results = await loadResults('/api/results.js');
        console.log('Results loaded', results.length);

        // Filter + dedupe
        const filtered = results.filter(r => allowedCodes.has(r.schoolCode));
        const unique = Array.from(new Map(filtered.map(item => [item.id, item])).values());
        console.log('Filtered & deduped', unique.length);

        // Populate events dynamically now that we have data
        const events = [...new Set(unique.map(r => r.event))].sort();
        populateDropdown(eventSelect, events);

        // Get current filter values
        const genderVal = genderSelect.value;
        const eventVal = eventSelect.value;
        const courseVal = courseSelect.value;
        console.log('Filters:', { genderVal, eventVal, courseVal });

        const filteredData = unique.filter(r =>
          (genderVal ? r.gender === genderVal : true) &&
          (eventVal ? r.event === eventVal : true) &&
          (courseVal ? r.course === courseVal : true)
        );

        console.log('Filtered count:', filteredData.length);
        renderTable(filteredData);

      } catch (err) {
        console.error('Error on Show Results click:', err);
      }
    });

    console.log('Click listener attached');
    // No render here — waits for button click

  } catch (err) {
    console.error('Initialization error:', err);
  }
});

