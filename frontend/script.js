async function loadCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map(line => line.split(',')[0]); // grab schoolCode from first column
}

async function loadResults(apiUrl) {
  const res = await fetch(apiUrl);
  return await res.json();
}

function populateDropdown(selectElem, items) {
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

    console.log('Loading results…');
    const results = await loadResults('/api/results.json');
    console.log('Results loaded', results.length);

    const filtered = results.filter(r => allowedCodes.has(r.schoolCode));
    const unique = Array.from(new Map(filtered.map(item => [item.id, item])).values());
    console.log('Filtered & deduped', unique.length);

    const genderSelect = document.getElementById('genderDropdown');
    const eventSelect = document.getElementById('eventDropdown');
    const courseSelect = document.getElementById('courseDropdown');
    const showBtn = document.getElementById('showResultsBtn');

    if (!showBtn) {
      console.error('Show Results button not found.');
      return;
    }

    const events = [...new Set(unique.map(r => r.event))].sort();
    populateDropdown(eventSelect, events);

    function applyFilters() {
      console.log('Show Results clicked');
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
    }

    showBtn.addEventListener('click', applyFilters);
    console.log('Click listener attached');

    renderTable(unique);
    console.log('Initial table rendered');

  } catch (err) {
    console.error('Initialization error:', err);
  }
});


