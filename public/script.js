async function loadResults(apiUrl) {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${apiUrl} (${res.status})`);
  }
  return await res.json();
}

// NEW: load and parse school codes CSV
async function loadSchoolCodes(csvPath) {
  const res = await fetch(csvPath);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${csvPath} (${res.status})`);
  }
  const csvText = await res.text();
  const rows = csvText.trim().split('\n').slice(1); // skip header row
  return rows.map(row => {
    const [code, name] = row.split(',');
    return { code: code.trim(), name: name.trim() };
  });
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

// NEW: render school key table
function renderSchoolKey(schoolData) {
  const tbody = document.querySelector('#schoolKey tbody');
  if (!tbody) {
    console.warn('School key table body not found.');
    return;
  }
  tbody.innerHTML = '';
  schoolData.forEach(({ code, name }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${code}</td><td>${name}</td>`;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');

  const genderSelect = document.getElementById('genderDropdown');
  const eventSelect = document.getElementById('eventDropdown');
  const courseSelect = document.getElementById('courseDropdown');
  const showBtn = document.getElementById('showResultsBtn');

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

      // Results
      const results = await loadResults(apiUrl);
      const unique = Array.from(
        new Map(results.map(item => [`${item.name}-${item.time}`, item])).values()
      );
      renderTable(unique);

      // School key from CSV (update path if needed)
      const schoolCodes = await loadSchoolCodes('division2.csv');
      renderSchoolKey(schoolCodes);

    } catch (err) {
      console.error('Error on Show Results click:', err);
    }
  });

  console.log('Click listener attached');
});

