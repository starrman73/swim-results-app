function showSpinner() {
  const sp = document.getElementById('spinner');
  if (sp) sp.style.display = 'block';
}

function hideSpinner() {
  const sp = document.getElementById('spinner');
  if (sp) sp.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM fully loaded');

  const genderSelect = document.getElementById('genderDropdown');
  const eventSelect = document.getElementById('eventDropdown');
  const courseSelect = document.getElementById('courseDropdown');
  const showBtn = document.getElementById('showResultsBtn');

  // Preload the school code key on page load
  try {
    const schoolCodes = await loadSchoolCodes('division2.csv');
    console.log('Preloaded school codes:', schoolCodes);
    renderSchoolKey(schoolCodes);
  } catch (err) {
    console.error('Error preloading school codes:', err);
  }

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

      const apiUrl = `/api/results?org=1&gender=${genderVal}&event=${eventVal}&course=${courseVal}`;
      console.log('Fetching from:', apiUrl);

      // ⬇️ Show spinner before loading
      showSpinner();

      const results = await loadResults(apiUrl);

      const unique = Array.from(
        new Map(results.map(item => [`${item.name}-${item.time}`, item])).values()
      );
      renderTable(unique);

    } catch (err) {
      console.error('Error on Show Results click:', err);
    } finally {
      // ⬇️ Always hide spinner after loading (success or error)
      hideSpinner();
    }
  });

  console.log('Click listener attached');
});
