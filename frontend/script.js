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

(async function init() {
  // Load whitelist from CSV
  const allowedCodes = new Set(await loadCSV('division2.csv'));
  
  // Load all results from API
  const results = await loadResults('/api/results');

  // Filter + dedupe
  const filtered = results.filter(r => allowedCodes.has(r.schoolCode));
  const unique = Array.from(
    new Map(filtered.map(item => [item.id, item])).values()
  );

  // Grab dropdown elements from HTML
  const genderSelect = document.getElementById('genderDropdown');
  const eventSelect = document.getElementById('eventDropdown');
  const courseSelect = document.getElementById('courseDropdown');
  const showBtn = document.getElementById('showResultsBtn');

  // Populate event dropdown dynamically (others already have static options in HTML)
  const events = [...new Set(unique.map(r => r.event))].sort();
  populateDropdown(eventSelect, events);

  // Filtering function triggered by Show Results button
  function applyFilters() {
    const genderVal = genderSelect.value;
    const eventVal = eventSelect.value;
    const courseVal = courseSelect.value;

    const filteredData = unique.filter(r =>
      (genderVal ? r.gender === genderVal : true) &&
      (eventVal ? r.event === eventVal : true) &&
      (courseVal ? r.course === courseVal : true)
    );

    renderTable(filteredData);
  }

  // Bind button click
  showBtn.addEventListener('click', applyFilters);

  // Initial render of all allowed swimmers
  renderTable(unique);
})();
