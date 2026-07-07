/**
 * Shared card renderer used by both the TV and phone clients.
 *
 * Single source of truth for how a "card" (prompt or answer) is turned into
 * DOM. This replaces the duplicated `gameType === 'madlad'` inline-HTML card
 * branches that used to live separately in tv.js and player.js.
 *
 * Wire format reminder: cards are text-only on the client. `card.text` is
 * either a prompt string (which may contain a `____` blank run) or an answer
 * string. No card ids are assumed here.
 */
(function (global) {
    'use strict';

    /**
     * Escape arbitrary text for safe insertion as HTML.
     * @param {*} text
     * @returns {string}
     */
    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    /**
     * Format a prompt string, turning `__` (2+ underscores) blank runs into a
     * styled blank span.
     * @param {string} text
     * @returns {string} escaped, blank-formatted HTML
     */
    function formatPrompt(text) {
        return esc(text).replace(/_{2,}/g, '<span class="card__blank"></span>');
    }

    /**
     * Render a single card face (prompt/black or answer/white) as a DOM
     * element. Returns a DOM node (not an HTML string) so callers can attach
     * click handlers directly, or read `.outerHTML` when they need to splice
     * the markup into a larger innerHTML template.
     *
     * @param {Object} card
     * @param {'prompt'|'answer'} card.kind - 'prompt' renders a black card,
     *   'answer' renders a white card.
     * @param {string} card.text - card face text (prompt or answer text).
     * @param {Object} [opts]
     * @param {'tv'|'phone'|'hand'} [opts.variant='phone'] - sizing/context.
     * @param {boolean} [opts.winner=false] - apply the winner highlight.
     * @param {boolean} [opts.onClick] - if provided, renders a clickable
     *   <button> and wires up the click handler.
     * @param {'div'|'button'} [opts.as] - force the element tag; defaults to
     *   'button' when onClick is provided, otherwise 'div'.
     * @param {string} [opts.className] - extra space-separated class names.
     * @returns {HTMLElement}
     */
    function renderCard(card, opts) {
        card = card || {};
        opts = opts || {};

        const kind = card.kind === 'prompt' ? 'prompt' : 'answer';
        const variant = opts.variant || 'phone';
        const tag = opts.as || (opts.onClick ? 'button' : 'div');

        const el = document.createElement(tag);
        el.classList.add('card', `card--${kind}`, `card--${variant}`);
        if (opts.winner) {
            el.classList.add('card--winner');
        }
        if (opts.className) {
            opts.className.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
        }
        if (tag === 'button') {
            el.type = 'button';
        }

        const inner = document.createElement('div');
        inner.className = 'card__inner';

        // Reserved slot for future per-card sprite art (E3). Empty/hidden
        // until that lands so the card face stays clean today.
        const sprite = document.createElement('div');
        sprite.className = 'card__sprite-slot';
        sprite.setAttribute('aria-hidden', 'true');
        inner.appendChild(sprite);

        const textEl = document.createElement('div');
        textEl.className = 'card__text';
        if (kind === 'prompt') {
            textEl.innerHTML = formatPrompt(card.text);
        } else {
            textEl.textContent = card.text == null ? '' : String(card.text);
        }
        inner.appendChild(textEl);

        el.appendChild(inner);

        if (typeof opts.onClick === 'function') {
            el.addEventListener('click', opts.onClick);
        }

        return el;
    }

    global.CardRender = {
        renderCard,
        formatPrompt,
        esc,
    };
})(window);
