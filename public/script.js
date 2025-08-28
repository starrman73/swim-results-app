async function loadResults(apiUrl) {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${apiUrl} (${res.status})`);
  }
  return await res.json();
}


function renderTable(data) {
  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = '';
  data.forEach((swimmer, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td> <!-- rank -->
      <td>${swimmer.name}</td>
      <td>${swimmer.schoolCode}</td>
      <td>${swimmer.time}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');

  const genderSelect = document.getElementById('genderDropdown');
  const eventSelect = document.getElementById('eventDropdown');
  const courseSelect = document.getElementById('courseDropdown');
  const showBtn = document.getElementById('showResultsBtn');

  fetch('schools.csv')
  .then(response => response.text())
  .then(csv => {
    const rows = csv.trim().split('\n').slice(1); // skip header row
    const tbody = document.querySelector('#schoolKey tbody');

    rows.forEach(row => {
      const [code, name] = row.split(',');
      const tr = document.createElement('tr');

      const tdCode = document.createElement('td');
      tdCode.textContent = code;
      const tdName = document.createElement('td');
      tdName.textContent = name;

      tr.appendChild(tdCode);
      tr.appendChild(tdName);
      tbody.appendChild(tr);
    });
  })
  .catch(err => console.error('Error loading school codes:', err));

  

  if (!showBtn) {
    console.error('Show Results button not found.');
    return;
  }

  // --- Click handler for "Show Results" ---
  showBtn.addEventListener('click', async () => {
    try {
      const genderVal = genderSelect.value;
      const eventVal = eventSelect.value;
      const courseVal = courseSelect.value;

      if (!genderVal || !eventVal || !courseVal) {
        alert('Please select gender, event, and course.');
        return;
      }

      console.log({ genderVal, eventVal, courseVal });
      console.log('Raw event value from dropdown:', eventVal);

      const apiUrl = `/api/results?org=1&gender=${genderVal}&event=${eventVal}&course=${courseVal}`;
      console.log('Fetching from:', apiUrl);

      // API already returns only allowed schools, no extra filtering needed
      const results = await loadResults(apiUrl);

      // Deduplicate on name + time just in case
      const unique = Array.from(
        new Map(results.map(item => [`${item.name}-${item.time}`, item])).values()
      );

      renderTable(unique);

    } catch (err) {
      console.error('Error on Show Results click:', err);
    }
  });

  console.log('Click listener attached');
});


