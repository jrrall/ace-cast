(function adminCards() {
  const form = document.getElementById('add-card-form');
  const message = document.getElementById('add-card-status');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const body = Object.fromEntries(new FormData(form));
    body.maturity_rating = Number(body.maturity_rating);
    button.disabled = true;
    message.textContent = 'Saving…';
    try {
      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': document.body.dataset.adminToken || '' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not save card');
      message.textContent = `Card #${result.id} added (${result.status}).`;
      form.elements.text.value = '';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}());
