async function loadCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  return text.trim().split('\n').slice(1).map(line => line.split(',')[0]);
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
    tr.innerHTML = `<td>${swimmer.name}</td>
                    <td>${swimmer.schoolCode}</td>
                    <td>${swimmer.event}</td>
                    <td>${swimmer.time}</td>`;
    tbody.appendChild(tr);
  });
}

(async function init() {
  const allowedCodes = new Set(await loadCSV('division2.csv'));
  const results = await loadResults('/api/results');

  const filtered = results.filter(r => allowedCodes.has(r.schoolCode));
  const unique = Array.from(new Map(filtered.map(item => [item.id, item])).values());

  const schoolSelect = document.getElementById('schoolSelect');
  const eventSelect = document.getElementById('eventSelect');

  const schools = [...new Set(unique.map(r => r.schoolCode))].sort();
  const events = [...new Set(unique.map(r => r.event))].sort();

  populateDropdown(schoolSelect, schools);
  populateDropdown(eventSelect, events);

  function applyFilters() {
    const schoolVal = schoolSelect.value;
    const eventVal = eventSelect.value;
    const filteredData = unique.filter(r =>
      (schoolVal ? r.schoolCode === schoolVal : true) &&
      (eventVal ? r.event === eventVal : true)
    );
    renderTable(filteredData);
  }

  schoolSelect.addEventListener('change', applyFilters);
  eventSelect.addEventListener('change', applyFilters);

  renderTable(unique);
})();
