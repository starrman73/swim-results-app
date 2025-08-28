// ----- Spinner helpers -----
function showSpinner() {
  const tbody = document.getElementById('resultsBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr id="spinnerRow">
        <td colspan="4" style="text-align:center;">
          <div class="spinner"></div>
        </td>
      </tr>
    `;
  }
}

function hideSpinner() {
  const row = document.getElementById('spinnerRow');
  if (row) row.remove();
}

// ----- Data loaders -----
async function loadResults(apiUrl) {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${apiUrl} (${res.status})`);
  }
  return await res.json();
}

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
   console.log('renderTable incoming data length:', data.length);
  console.table(data);
  const table = document.getElementById('resultsTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  // Detect relay mode
  console.log('type of data:', typeof data);
console.log('isArray?', Array.isArray(data));
console.log('data length:', data.length);
console.log('data contents:', data);

  //const isRelay = data.every(s => !s.name);
  //const isRelay = data.every(s => !s.name || /^[A-Z]?\s*Relay$/i.test(s.name));
  const isRelay = data.every(s => {
  console.log('name value:', JSON.stringify(s.name));
  return !s.name || /^[A-Z]?\s*Relay$/i.test(s.name);
});

console.log('Final isRelay result:', isRelay);
  


  // Build header
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      ${!isRelay ? '<th>Name</th>' : ''}
      <th>School</th>
      <th>Time</th>
    </tr>
  `;

  // Build body
  tbody.innerHTML = data.map((s, idx) => `
    <tr>
      <td>${idx + 1}</td>
      ${!isRelay ? `<td>${s.name || ''}</td>` : ''}
      <td>${s.schoolCode || ''}</td>
      <td>${s.time || ''}</td>
    </tr>
  `).join('');
}

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

// ----- Boot -----
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM fully loaded');

  const genderSelect = document.getElementById('genderDropdown');
  const eventSelect = document.getElementById('eventDropdown');
  const courseSelect = document.getElementById('courseDropdown');
  const showBtn = document.getElementById('showResultsBtn');

  // Preload the school code key on page load
  try {
    showSpinner();
    const schoolCodes = await loadSchoolCodes('division2.csv');
    console.log('Preloaded school codes:', schoolCodes);
    renderSchoolKey(schoolCodes);
  } catch (err) {
    console.error('Error preloading school codes:', err);
  } finally {
    hideSpinner();
  }

  if (!showBtn) {
    console.error('Show Results button not found.');
    return;
  }

  // --- Click handler for "Show Results" ---
  showBtn.addEventListener('click', async () => {
     console.log('Show Results click handler START');
    const genderVal = genderSelect?.value;
    const eventVal = eventSelect?.value;
    const courseVal = courseSelect?.value;

    const warnMissing = () => {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please select gender, event, and course.',
        width: 'min(90vw, 420px)',
        customClass: {
          popup: 'swal-compact',
          title: 'swal-compact-title',
          confirmButton: 'swal-compact-btn',
        },
      });
    };

    if (!genderVal || !eventVal || !courseVal) {
      warnMissing();
      return;
    }

    console.log({ genderVal, eventVal, courseVal });
    console.log('Raw event value from dropdown:', eventVal);

    // Build a safe, correctly delimited query string
    const params = new URLSearchParams({
      org: '1',
      gender: genderVal,
      event: eventVal,
      course: courseVal,
    });
    const apiUrl = `/api/results?${params.toString()}`;
    console.log('Fetching from:', apiUrl);

    try {
      showSpinner();
      showBtn.disabled = true;

      const results = await loadResults(apiUrl);
      console.log(results)
const unique = Array.from(
  new Map(
    results
      .filter(item => item && typeof item === 'object') // Guard against undefined/null items
      .map(item => [
        `${item.name === null ? '' : item.name}-${item.time ?? ''}`, // Key: null name -> '', null time -> ''
        { ...item, name: item.name === null ? '' : item.name } // Value: null name -> ''
      ])
  ).values()
);
console.log('About to call renderTable', unique.length, unique);
renderTable(unique);
    } catch (err) {
      console.error('Error on Show Results click:', err);
    } finally {
      hideSpinner();
      showBtn.disabled = false;
    }
  });

  console.log('Click listener attached');
});





















