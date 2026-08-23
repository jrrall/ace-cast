// F3 (Card Forge) — content review dashboard: approve/deny a pending candidate,
// plus optional bulk approve/deny for the whole visible queue. Mirrors
// admin-feedback.js's token-carrying fetch pattern.
(function () {
    const adminToken = document.body.dataset.adminToken || '';

    function withToken(url) {
        if (!adminToken) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}token=${encodeURIComponent(adminToken)}`;
    }

    async function reviewCard(id, status, deniedReason) {
        const body = { status };
        if (status === 'denied' && deniedReason) body.denied_reason = deniedReason;
        const res = await fetch(withToken(`/api/content/cards/${id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
    }

    document.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-action="approve"], [data-action="deny"]');
        if (!btn) return;

        const cardId = btn.dataset.cardId;
        const status = btn.dataset.action === 'approve' ? 'approved' : 'denied';
        const deniedReason = status === 'denied'
            ? window.prompt('Reason for denial (optional):') || undefined
            : undefined;

        btn.disabled = true;
        try {
            await reviewCard(cardId, status, deniedReason);
            // Simplest correct refresh: reload so the queue and daily counts
            // both reflect the new state.
            window.location.reload();
        } catch (error) {
            console.error(`Failed to ${status} card ${cardId}:`, error);
            btn.disabled = false;
        }
    });

    document.addEventListener('click', async (event) => {
        const bulkBtn = event.target.closest('[data-bulk-action]');
        if (!bulkBtn) return;

        const status = bulkBtn.dataset.bulkAction === 'approve-all' ? 'approved' : 'denied';
        const rows = [...document.querySelectorAll('[data-card-row]')];
        if (rows.length === 0) return;
        const verb = status === 'approved' ? 'Approve' : 'Deny';
        if (!window.confirm(`${verb} all ${rows.length} pending cards?`)) return;

        bulkBtn.disabled = true;
        // eslint-disable-next-line no-restricted-syntax
        for (const row of rows) {
            const cardId = row.dataset.cardRow;
            try {
                // eslint-disable-next-line no-await-in-loop
                await reviewCard(cardId, status);
            } catch (error) {
                console.error(`Bulk ${status} failed for card ${cardId}:`, error);
            }
        }
        window.location.reload();
    });
}());
