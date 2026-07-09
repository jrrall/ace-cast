// Feedback dashboard (F3/F4): retire/unretire one-click actions + pack filter.
// No framework here — just enough to make the dashboard usable.
(function () {
    const adminToken = document.body.dataset.adminToken || '';

    function withToken(url) {
        if (!adminToken) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}token=${encodeURIComponent(adminToken)}`;
    }

    document.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-action="retire"], [data-action="unretire"]');
        if (!btn) return;

        const cardId = btn.dataset.cardId;
        const action = btn.dataset.action;
        btn.disabled = true;

        try {
            const res = await fetch(withToken(`/api/admin/cards/${cardId}/${action}`), {
                method: 'POST',
            });
            if (!res.ok) throw new Error(`Request failed: ${res.status}`);
            // Simplest correct refresh: reload so every table (suggestions, all-cards)
            // reflects the new state.
            window.location.reload();
        } catch (error) {
            console.error(`Failed to ${action} card ${cardId}:`, error);
            btn.disabled = false;
        }
    });

    const packFilter = document.getElementById('pack-filter');
    if (packFilter) {
        packFilter.addEventListener('change', () => {
            const slug = packFilter.value;
            document.querySelectorAll('#all-cards-table tbody tr').forEach((row) => {
                row.style.display = (!slug || row.dataset.pack === slug) ? '' : 'none';
            });
        });
    }
}());
